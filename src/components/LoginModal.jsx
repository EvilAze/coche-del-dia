// src/components/LoginModal.jsx
// La puerta de entrada. Vivía inline en App.jsx cuando solo tenía un botón de
// Google; al añadir la entrada por correo se muda aquí para que App.jsx siga
// siendo el orquestador de overlays y no un formulario.
//
// JERARQUÍA: Google primero y con peso (es lo que usa la mayoría y es un solo
// toque), el correo debajo tras un filete. No al revés: ofrecer primero el
// camino de dos pasos —teclear correo, salir de la web, abrir el enlace— sería
// empujar al jugador al más lento.
//
// El correo se pinta SOLO si `emailLoginDisponible()` (ver lib/auth.js): el
// email integrado de Supabase va limitado a 2 correos/hora en todo el proyecto,
// así que la opción está apagada hasta que haya SMTP propio.

import { useState } from "react";
import { useT } from "../i18n";
import { signInWithGoogle, signInWithEmail, emailLoginDisponible } from "../lib/auth";
import { useToast } from "./Toast";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";
import LanguageStrip from "./LanguageStrip";

// Validación deliberadamente laxa: "algo@algo.algo". La de verdad la hace el
// servidor al enviar, y un regex estricto de RFC rechaza correos válidos raros.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function LoginModal({ open, onClose }) {
  const { t } = useT();
  const toast = useToast();
  const conEmail = emailLoginDisponible();

  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Enlace ya enviado: el modal cambia de cara entera. Volver a enseñar el
  // formulario invitaría a pedir otro correo, que con el rate limit de Supabase
  // es justo lo que no queremos.
  const [enviadoA, setEnviadoA] = useState(null);

  async function entrarConGoogle() {
    // En nativo (app) el login va por plugin; si falla (p.ej. falta
    // VITE_GOOGLE_WEB_CLIENT_ID o el usuario cancela con error), damos
    // feedback visible en vez de "no pasa nada". En web, signInWithOAuth
    // redirige y el error path no se alcanza normalmente.
    const { error } = (await signInWithGoogle()) || {};
    if (error) toast.push(t("app.loginError"), { type: "error" });
  }

  async function pedirEnlace(e) {
    e.preventDefault();
    const limpio = email.trim();
    if (!EMAIL_RE.test(limpio)) {
      toast.push(t("app.emailInvalid"), { type: "error" });
      return;
    }
    setEnviando(true);
    try {
      const { error } = await signInWithEmail(limpio);
      if (error) {
        // El error más probable en producción es el rate limit del proveedor de
        // correo. Merece su propio mensaje: «inténtalo de nuevo» no le dice al
        // jugador que lo que tiene que hacer es ESPERAR.
        const esRate =
          error.status === 429 || /rate limit|too many/i.test(error.message || "");
        toast.push(esRate ? t("app.emailRateLimited") : t("app.emailError"), { type: "error" });
        return;
      }
      setEnviadoA(limpio);
    } catch {
      toast.push(t("app.emailError"), { type: "error" });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[100] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} />
      </div>

      {enviadoA ? (
        // Acuse de recibo. Sin botón de reenviar a propósito (ver arriba).
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.emailSentTitle")}
          </h2>
          <p className="pm-body">{t("app.emailSentBody", { email: enviadoA })}</p>
          <p className="pm-body mt-3 text-xs">{t("app.emailSentHint")}</p>
          <button type="button" onClick={onClose} className="pm-btn mt-6">
            {t("common.ok")}
          </button>
        </>
      ) : (
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.loginModalTitle")}
          </h2>
          <p className="mb-8 text-sm text-muted">{t("app.loginModalDescription")}</p>

          <button
            onClick={entrarConGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-black transition-transform hover:scale-105 active:scale-95"
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

              <form onSubmit={pedirEnlace} className="text-left">
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
