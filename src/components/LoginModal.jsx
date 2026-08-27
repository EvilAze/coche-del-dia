// src/components/LoginModal.jsx
// La puerta de entrada. Dos caminos y dos pasos.
//
// JERARQUÍA: Google primero y con peso (un solo toque, y es lo que usa la
// mayoría), el correo debajo tras un filete. No al revés: ofrecer primero el
// camino de dos pasos sería empujar al jugador al más lento.
//
// POR QUÉ UN CÓDIGO Y NO UN ENLACE. El enlace obligaba a salir de la pantalla e
// ir a la bandeja de correo, que es donde se desangran los embudos en móvil, y
// en la app no se podía ofrecer siquiera: la sesión habría nacido en el
// navegador del sistema, fuera del WebView. Un código de seis cifras se teclea
// donde estás. Es además el gesto que todo el mundo reconoce de su banco y de
// WhatsApp, así que no hay nada que aprender.
//
// POR QUÉ NO CONTRASEÑA. Con confirmación de correo, darse de alta con
// contraseña son cinco pasos (correo, inventar contraseña, ir a la bandeja,
// confirmar, volver): el viaje del código MÁS inventar algo que recordar. Solo
// compensaría en el segundo login, que en un juego diario con sesión
// persistente prácticamente no ocurre. Y deja cola para siempre: recuperación,
// fuerza mínima, contraseñas filtradas, soporte.
//
// El correo se pinta SOLO si `emailLoginDisponible()` (ver lib/auth.js): el
// email integrado de Supabase va limitado a 2 correos/hora en todo el proyecto,
// así que la opción está apagada hasta que haya SMTP propio.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  signInWithGoogle,
  pedirCodigo,
  verificarCodigo,
  emailLoginDisponible,
} from "../lib/auth";
import { track } from "../lib/analytics";
import { useToast } from "./Toast";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";
import LanguageStrip from "./LanguageStrip";

// Validación deliberadamente laxa: "algo@algo.algo". La de verdad la hace el
// servidor al enviar, y un regex estricto de RFC rechaza correos válidos raros.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CIFRAS = 6;

// Espera antes de poder pedir otro código. Sesenta segundos y no treinta porque
// un correo puede tardar: un botón disponible antes de que llegue el primero
// invita a pedir un segundo, y el segundo INVALIDA al primero — el jugador
// acabaría escribiendo un código recién caducado por culpa nuestra.
const SEGUNDOS_REENVIO = 60;

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// `aviso`: null en el caso normal; "identidad-ocupada" cuando la vinculación
// falló porque esa cuenta de Google ya es de otro usuario; cualquier otra
// cadena para un fallo genérico de OAuth. Lo decide App.jsx leyendo la URL de
// retorno (lib/authCallback.js).
export default function LoginModal({ open, onClose, aviso = null }) {
  const { t } = useT();
  const toast = useToast();
  const conEmail = emailLoginDisponible();

  const [paso, setPaso] = useState("correo");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  // El tipo de token que devolvió pedirCodigo. Se ARRASTRA hasta la
  // verificación en vez de recalcularlo: ver el porqué en lib/auth.js.
  const [tipoOtp, setTipoOtp] = useState(null);
  // El correo tecleado ya tiene cuenta, así que entrar descartará el progreso
  // anónimo de este dispositivo. Se avisa en el paso del código —cuando aún se
  // puede cambiar de correo sin gastarlo— porque este es el mismo caso que con
  // Google enseña `loginLinkTakenBody`, y por correo se resolvía en silencio.
  const [correoOcupado, setCorreoOcupado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // "codeInvalid" | "codeExpired" | "codeNetwork" | null. Son tres mensajes y
  // no uno porque la acción que los resuelve es distinta: uno se reescribe,
  // otro se repide y el tercero no depende del jugador. Decirle «ese código no
  // es correcto» a quien se ha quedado sin cobertura es culparle de algo que
  // hizo bien (regla 21: degradar no es inventarse el estado).
  const [errorCodigo, setErrorCodigo] = useState(null);
  const [reenvioEn, setReenvioEn] = useState(0);

  // Doble toque en el botón de Google. En web da igual (redirige y la página se
  // va), pero en la app el plugin nativo tarda un instante en presentar la hoja
  // de cuentas — y ahí cabe un segundo toque, que `lib/nativeAuth` detecta y
  // devuelve como error: un aviso rojo por algo que no has hecho mal.
  const [entrando, setEntrando] = useState(false);

  // Al cerrarse, el modal vuelve al paso 1. Sin esto, quien cierra a medias y
  // reabre se encuentra pidiéndole un código que ya no va a llegar. El correo
  // SÍ se conserva: no hay ninguna razón para hacérselo teclear otra vez.
  useEffect(() => {
    if (open) return;
    setPaso("correo");
    setCodigo("");
    setTipoOtp(null);
    setCorreoOcupado(false);
    setErrorCodigo(null);
    setReenvioEn(0);
  }, [open]);

  // Cuenta atrás del reenvío. Un setTimeout por segundo y no un intervalo: así
  // el desmontaje lo limpia solo y no hay que acordarse de pararlo.
  useEffect(() => {
    if (reenvioEn <= 0) return undefined;
    const id = setTimeout(() => setReenvioEn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [reenvioEn]);

  async function entrarConGoogle(vincular = true) {
    if (entrando) return;
    setEntrando(true);
    track("login_method", { method: "google" });
    // En nativo (app) el login va por plugin; si falla (p.ej. falta
    // VITE_GOOGLE_WEB_CLIENT_ID o el usuario cancela con error), damos
    // feedback visible en vez de "no pasa nada". En web redirige, y el error
    // que importa vuelve en la URL — lo recoge lib/authCallback.js.
    try {
      const { error } = (await signInWithGoogle({ vincular })) || {};
      if (error) toast.push(t("app.loginError"), { type: "error" });
    } finally {
      setEntrando(false);
    }
  }

  async function enviarCodigo(e) {
    e?.preventDefault();
    const limpio = email.trim();
    if (!EMAIL_RE.test(limpio)) {
      toast.push(t("app.emailInvalid"), { type: "error" });
      return;
    }
    setEnviando(true);
    // Solo en el PRIMER envío. Este evento mide qué camino elige el jugador, y
    // reenviar no es volver a elegirlo: contarlo otra vez inflaría los métodos
    // por encima de las aperturas y el embudo dejaría de cuadrar. El envío en
    // sí sí se cuenta las veces que ocurra, abajo, con login_code_sent.
    if (paso === "correo") track("login_method", { method: "email" });
    try {
      const { error, tipo, correoOcupado: ocupado } = await pedirCodigo(limpio);
      if (error) {
        // El error más probable en producción es el rate limit del proveedor de
        // correo. Merece su propio mensaje: «inténtalo de nuevo» no le dice al
        // jugador que lo que tiene que hacer es ESPERAR.
        const esRate =
          error.status === 429 || /rate limit|too many/i.test(error.message || "");
        toast.push(esRate ? t("app.emailRateLimited") : t("app.emailError"), { type: "error" });
        return;
      }
      setTipoOtp(tipo);
      setCorreoOcupado(Boolean(ocupado));
      setCodigo("");
      setErrorCodigo(null);
      setPaso("codigo");
      setReenvioEn(SEGUNDOS_REENVIO);
      track("login_code_sent", { vinculando: tipo === "email_change" });
    } catch {
      toast.push(t("app.emailError"), { type: "error" });
    } finally {
      setEnviando(false);
    }
  }

  async function verificar(valor) {
    const cifras = valor ?? codigo;
    if (verificando || cifras.length !== CIFRAS) return;
    setVerificando(true);
    try {
      const { error } = (await verificarCodigo(email.trim(), cifras, tipoOtp)) || {};
      if (error) {
        const caducado = /expired/i.test(error.message || "");
        setErrorCodigo(caducado ? "codeExpired" : "codeInvalid");
        // Vaciar el campo: reescribir sobre seis cifras que ya se rechazaron es
        // más trabajo que empezar de nuevo.
        setCodigo("");
        track("login_verified", { result: caducado ? "expired" : "bad_code" });
        return;
      }
      track("login_verified", { result: "ok" });
      // La sesión ya existe. Quien se entera es onAuthStateChange
      // (useAuthSession); aquí solo hay que quitarse de en medio.
      //
      // Con bandera: este cierre es un ÉXITO, no un abandono. Sin ella, cada
      // registro conseguido se contaría también como `login_dismiss`.
      onClose?.({ exito: true });
    } catch {
      // Aquí NO se ha rechazado el código: no hemos llegado a preguntarlo. El
      // campo se conserva —lo tecleado sigue siendo válido— y el mensaje habla
      // de la conexión, no del jugador.
      setErrorCodigo("codeNetwork");
      track("login_verified", { result: "error" });
    } finally {
      setVerificando(false);
    }
  }

  // Solo cifras y como mucho seis. Se verifica sola al llegar a la sexta —el
  // botón sigue ahí porque pegar desde el gestor de contraseñas no siempre
  // dispara los mismos eventos que teclear.
  function cambiarCodigo(e) {
    const limpio = e.target.value.replace(/\D/g, "").slice(0, CIFRAS);
    setCodigo(limpio);
    if (errorCodigo) setErrorCodigo(null);
    if (limpio.length === CIFRAS) verificar(limpio);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("app.loginModalTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[100] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} />
      </div>

      {paso === "codigo" ? (
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.codeTitle")}
          </h2>
          <p className="pm-body">{t("app.codeBody", { email: email.trim() })}</p>

          {/* Mismo filete discontinuo que el aviso de Google: es el mismo hecho
              contado en el otro camino, y merece la misma cara. */}
          {correoOcupado && (
            <p className="mt-4 border border-dashed border-tinta px-3 py-2 text-left text-sm text-muted">
              {t("app.codeEmailTakenBody")}
            </p>
          )}

          <div className="mt-5 text-left">
            <label htmlFor="login-codigo" className="prensa-label">
              {t("app.codeLabel")}
            </label>
            <input
              id="login-codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              // El teclado del sistema aparece aquí, dentro de un role="dialog".
              // lib/teclado.js ignora a propósito los campos de un diálogo: la
              // hoja se ajusta sola y el pliego de detrás no tiene que
              // recomponerse (ver su cabecera).
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={CIFRAS}
              className="prensa-input text-center font-mono text-2xl tracking-[0.4em]"
              placeholder={t("app.codePlaceholder")}
              value={codigo}
              onChange={cambiarCodigo}
              disabled={verificando}
              autoFocus
            />
            {errorCodigo && (
              <p className="mt-2 text-sm text-rojo">{t(`app.${errorCodigo}`)}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => verificar()}
            className="pm-btn mt-4"
            disabled={verificando || codigo.length !== CIFRAS}
          >
            {verificando ? t("app.codeVerifying") : t("app.codeCta")}
          </button>

          {/* El correo lleva las dos cosas y el modal solo pedía una. Sin este
              renglón, quien lo lee en el ordenador teclea seis cifras sin
              enterarse de que había un botón: el enlace existiría sin que nadie
              lo usara, que es lo mismo que no tenerlo. */}
          <p className="pm-body mt-3 text-center text-xs">{t("app.codeLinkHint")}</p>
          <p className="pm-body mt-2 text-center text-xs">{t("app.codeSpamHint")}</p>

          <div className="mt-4 flex flex-col gap-2">
            {reenvioEn > 0 ? (
              <span className="pm-label !text-[10px]">
                {t("app.codeResendWait", { seconds: reenvioEn })}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => enviarCodigo()}
                className="pm-btn pm-btn--ghost !py-2 !text-xs"
                disabled={enviando}
              >
                {enviando ? t("app.emailSending") : t("app.codeResend")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPaso("correo");
                setCodigo("");
                setCorreoOcupado(false);
                setErrorCodigo(null);
                setReenvioEn(0);
              }}
              className="pm-label !text-[10px] underline"
            >
              {t("app.codeChangeEmail")}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.loginModalTitle")}
          </h2>

          {/* Vuelta de un intento fallido. Antes de esto, ese caso era una
              pantalla idéntica a la normal: el jugador volvía de Google sin
              sesión y sin ninguna explicación, y solo podía volver a pulsar el
              mismo botón para repetir el mismo fallo. */}
          {aviso === "identidad-ocupada" ? (
            <p className="mb-6 border border-dashed border-tinta px-3 py-2 text-left text-sm text-muted">
              {t("app.loginLinkTakenBody")}
            </p>
          ) : aviso ? (
            <p className="mb-6 border border-dashed border-tinta px-3 py-2 text-left text-sm text-muted">
              {t("app.loginFailedBody")}
            </p>
          ) : (
            <p className="mb-8 text-sm text-muted">{t("app.loginModalDescription")}</p>
          )}

          <button
            // Tras un fallo de vinculación entramos SIN vincular: ya sabemos
            // que esa cuenta es de otro usuario, y reintentar vinculando sería
            // mandarle a Google para volver con el mismo error.
            onClick={() => entrarConGoogle(aviso !== "identidad-ocupada")}
            disabled={entrando}
            aria-busy={entrando}
            // Blanco sobre negro es la CHAPA DE MARCA de Google (su logo va sobre
            // fondo blanco por sus propias directrices), así que ese par se queda
            // aunque no sea del tema; es el único sitio de la web donde el color
            // no lo elegimos nosotros. La forma sí es nuestra: esquina viva y el
            // papel se hunde 1px al pulsar.
            className="flex w-full items-center justify-center gap-3 rounded-none bg-white px-4 py-3 font-semibold text-black transition-transform active:translate-y-px disabled:opacity-60"
          >
            <GoogleGlyph />
            {t("common.continueWithGoogle")}
          </button>

          {conEmail && (
            <>
              {/* Filete con la conjunción centrada: el separador del sistema
                  prensa, no una línea suelta. */}
              <div className="my-5 flex items-center gap-3">
                <i className="h-px flex-1 bg-border" aria-hidden="true" />
                <span className="pm-label !text-[10px]">{t("app.orSeparator")}</span>
                <i className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>

              {/* `type="email"` SE QUEDA —es lo que saca el teclado con la @ a
                  mano, y eso no tiene nada que ver con validar—, pero la
                  validación del navegador se apaga. Su globo sale en el idioma
                  del SISTEMA y no en el que el jugador eligió aquí: un inglés
                  con el móvil en español lo leería en español, teniendo nosotros
                  `app.emailInvalid` traducida en los dos justo para esto. Y la
                  comprobación nativa es además MÁS LAXA que EMAIL_RE (`a@b` la
                  pasa y aquí no), así que dejarla puesta parte el mismo error en
                  dos avisos distintos según lo equivocado que esté lo tecleado.
                  Una sola puerta y un solo mensaje, que encima es el nuestro. */}
              <form onSubmit={enviarCodigo} noValidate className="text-left">
                <label htmlFor="login-email" className="prensa-label">
                  {t("app.emailLabel")}
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  className="prensa-input"
                  placeholder={t("app.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={enviando}
                />
                <button type="submit" className="pm-btn mt-4" disabled={enviando}>
                  {enviando ? t("app.emailSending") : t("app.emailCta")}
                </button>
                <p className="pm-body mt-2 text-center text-xs">{t("app.emailNoPassword")}</p>
              </form>
            </>
          )}

          {/* Selector de idioma para usuarios anónimos. Antes vivía en el
              popover del header; al quitarlo, este modal (al que llega el
              anónimo desde el icono de perfil) es su nuevo hogar. */}
          <div className="mt-6 border-t border-border pt-4 text-left">
            <LanguageStrip />
          </div>
        </>
      )}
    </ModalShell>
  );
}
