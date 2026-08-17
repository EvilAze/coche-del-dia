// src/components/MyStats.jsx
// TU CARNET — identidad, tus cifras y las puertas a tus secciones.
//
// El modal hace cuatro trabajos (identidad, cifras, navegación, ajustes) y los
// ordena en tres planos con una jerarquía explícita:
//
//   1. EL CARNET (fijo arriba, hace de cabecera del modal): cabecera con doble
//      filete, nombre con el sello del tier al margen, renglón de acreditación
//      («Lector desde mayo de 2026») y la banda de cuatro datos.
//   2. TUS SECCIONES (scrollable): podios y portadillas al Archivo y a la
//      Clasificación.
//   3. AJUSTES (fijo abajo): idioma, sesión y borrado de cuenta.
//
// QUÉ CAMBIÓ EN EL REDISEÑO DE PERFILES (y por qué):
//
//   · LAS PUERTAS ERAN UN MENÚ DE AJUSTES DE ANDROID. Icono a la izquierda,
//     texto, dato gris, chevron a la derecha, repetido cuatro veces dentro de
//     una caja. Es el patrón de lista de sistema, el único lenguaje que el
//     resto del juego evita a propósito, y convivía con el papel y los filetes
//     como si vinieran de dos aplicaciones distintas. Ahora son PORTADILLAS —
//     la misma rejilla que estrena el sumario (components/Portadilla.jsx)—, así
//     que «elegir sección» se ve igual en las dos pantallas donde se hace.
//   · LAS CIFRAS ESTABAN REPARTIDAS EN TRES SITIOS: los puntos como titular
//     suelto, el puesto debajo en pequeño y racha/máxima como dos renglones con
//     icono y valor al otro extremo. Comparar dos números pedía leer dos
//     frases. Ahora las cuatro viven en la banda del carnet, en fila, que es
//     como un documento imprime lo que acredita.
//   · EL EMAIL SE QUEDA EN AJUSTES, junto a «cerrar sesión»: nadie abre su
//     perfil para descubrir su propio correo, pero al cerrar sesión sí importa
//     saber cuál se cierra.
//
// Dos cosas que NO cambian y conviene no romper:
//   · El panel lleva `max-h` y una zona con scroll. Sin ella, con medallas de
//     podio el contenido pasa de 600px y en pantallas cortas «Cerrar sesión»
//     queda inalcanzable (useScrollLock bloquea el body).
//   · El modal de borrado se monta como HERMANO de ModalShell, no como hijo
//     (ver el comentario al final del archivo).

import { useEffect, useState } from "react";
import { getProfileSummary } from "../lib/statsService";
import { signOut } from "../lib/auth";
import { useEscape } from "../hooks/useEscape";
import { useHistoryChain } from "../hooks/useHistoryClose";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import DeleteAccountModal from "./DeleteAccountModal";
import LanguageStrip from "./LanguageStrip";
import PodiumMedals from "./PodiumMedals";
import Portadilla from "./Portadilla";
import Carnet, {
  CarnetCabecera,
  CarnetNombre,
  CarnetCifras,
  SelloTier,
} from "./carnet/Carnet";
import { PhoneIcon } from "./carnet/icons";
import { Icon, I } from "./configurator/icons";
import { ordinal } from "./PuestoCifra";
import { debeOfrecerApp, urlPlay } from "../lib/edicionApp";
import { track } from "../lib/analytics";

export default function MyStats({
  open,
  onClose,
  onSignedOut,
  onOpenGarage,
  onOpenRanking,
  onOpenNickname,
}) {
  const { t, locale, dateLocale } = useT();
  // El modal de borrado se monta DENTRO de este (z-index por encima) en vez de
  // subir al slot `activeModal` de App: es un sub-paso de los ajustes, y sacarlo
  // al slot obligaría a cerrar el carnet para abrirlo — el jugador perdería el
  // contexto justo en la pantalla donde más falta le hace.
  const [borrarAbierto, setBorrarAbierto] = useState(false);
  // Reintento manual de la carga. Contador y no callback: `t` cambia de
  // identidad en cada render y meterlo en un `useCallback` refrescaría el efecto
  // sin parar.
  const [reintento, setReintento] = useState(0);
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    stats: null,
    points: 0,
    rank: null,
    collection: null,
    tier: null,
    error: "",
  });

  useEffect(() => {
    if (!open) return;

    setState((current) => ({ ...current, loading: true, error: "" }));

    getProfileSummary()
      .then((data) => setState({ loading: false, error: "", ...data }))
      .catch((err) => {
        // El error se registraba en NINGÚN sitio: el `catch` lo recibía y lo
        // tiraba. Cuando el carnet no cargaba no quedaba ni rastro de por qué,
        // ni en la consola del que depura. El resto de superficies con datos
        // (la clasificación, el Archivo, el perfil ajeno) sí lo escriben, y con
        // el motivo puesto al lado: un fallo del propio perfil no lleva PII del
        // coche ni tokens (CLAUDE.md #8), así que no había razón para el
        // silencio.
        console.error("[MyStats] fallo cargando el perfil", err);
        setState((current) => ({
          ...current,
          loading: false,
          error: t("myStats.errorLoad"),
        }));
      });
  }, [open, reintento]);

  async function handleSignOut() {
    const { error } = await signOut();

    if (error) {
      setState((current) => ({ ...current, error: t("myStats.errorSignOut") }));
      return;
    }

    onSignedOut?.();
    onClose?.();
  }

  // Con el borrado abierto, este modal SUELTA la escucha de Escape: dos diálogos
  // suscritos a la misma tecla se cierran a la vez, y aquí eso significaría
  // sacar al jugador de los ajustes por intentar cancelar un borrado.
  useEscape(open && !borrarAbierto, onClose);

  // La «atrás» de Android, encadenada igual que el Escape de la línea de arriba.
  // Antes la cubría el trap global de App.jsx, que cierra el slot de una
  // pulsación: cancelar un borrado de cuenta con la atrás —el gesto natural para
  // decir «no, déjalo»— echaba del carnet entero. La tecla hacía lo correcto y el
  // gesto no, y en la app la tecla no existe.
  // Por eso `profile` sale del trap global (ver App.jsx): una sola capa por
  // overlay. true = retrocedido un nivel; false = cerrado del todo.
  useHistoryChain(open, () => {
    if (borrarAbierto) {
      setBorrarAbierto(false);
      return true;
    }
    onClose?.();
    return false;
  });

  // Si el carnet se cierra por cualquier otra vía (la X, el scrim, la «atrás»
  // de Android, que cierra el slot entero de App), el sub-modal se va con él:
  // es hermano en el DOM, así que sin esto se quedaría flotando SOLO sobre el
  // juego, pidiendo confirmar un borrado desde una pantalla que ya no existe.
  useEffect(() => {
    if (!open) setBorrarAbierto(false);
  }, [open]);

  const cargando = state.loading;
  const stats = state.stats;
  const nickname = state.profile?.display_name || t("myStats.noNickname");
  const email = state.user?.email || "";

  // Etiqueta del tier (Bronce/Plata/Oro) localizada; null hasta el primer coche.
  const tierLabel = state.tier?.tier
    ? state.tier.label?.[locale] || state.tier.label?.es
    : null;

  const rachaViva = stats?.current_streak ?? 0;
  const maxStreak = stats?.max_streak ?? 0;
  // Primer día: cero partidas ganadas y cero racha histórica. Sin esta línea, un
  // recién llegado abre su perfil y solo ve ceros y «Sin clasificar», sin una
  // sola pista de qué hacer.
  const primerDia = !cargando && !stats?.total_wins && !maxStreak;

  // El renglón de acreditación del carnet. `created_at` lo trae la sesión de
  // Supabase, así que no cuesta una consulta: es la fecha de alta y da al
  // documento lo único que le faltaba para leerse como tal — una antigüedad.
  const alta = state.user?.created_at ? new Date(state.user.created_at) : null;
  const desde =
    alta && !Number.isNaN(alta.getTime())
      ? t("myStats.readerSince", {
          date: alta.toLocaleDateString(dateLocale, { month: "long", year: "numeric" }),
        })
      : null;

  // Cierra el perfil y abre el destino de la puerta.
  // `source` viaja al opener (openRanking lo usa para saber de dónde nacen las
  // aperturas del ranking). Los demás openers ignoran el argumento.
  function go(opener, source) {
    onClose?.();
    opener?.(source);
  }

  // Apuntes de las portadillas (cada uno cae con elegancia si su fuente falló).
  const archivoApunte = state.collection
    ? t("myStats.archivoApunte", {
        unlocked: state.collection.unlocked,
        total: state.collection.total || "—",
      })
    : t("sumario.garajeApunte");

  // La puerta a Play solo existe donde el enlace instala algo: Android en
  // navegador y sin tenerla ya instalada. Dentro del APK y en iOS/escritorio, ni
  // se monta. Sin días mínimos, al revés que el faldón: quien abre su perfil y
  // baja hasta aquí ya está buscando, y a ese no hay que ponerle una cuota de
  // partidas.
  const ofreceApp = debeOfrecerApp();

  return (
    <>
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("myStats.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-5"
    >
      {state.error && !state.user ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="pm-kicker">{t("myStats.carnetKicker")}</p>
            <CloseButton onClick={onClose} className="-mr-2 -mt-2" />
          </div>
          {/* Con salida, como la edición no disponible y el cupón sin catálogo:
              un fallo que solo se diagnostica y no se puede reintentar se lee
              como una app rota. */}
          <p className="text-sm text-rojo">{state.error}</p>
          <button
            type="button"
            onClick={() => setReintento((n) => n + 1)}
            className="pm-btn pm-btn--ghost mt-3 !w-auto px-6 !py-2 !text-[11px]"
          >
            {t("offline.retry")}
          </button>
        </>
      ) : !cargando && !state.user ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="pm-kicker">{t("myStats.carnetKicker")}</p>
            <CloseButton onClick={onClose} className="-mr-2 -mt-2" />
          </div>
          <p className="text-sm text-muted-foreground">{t("myStats.promoLogin")}</p>
        </>
      ) : (
        <>
          {/* ── 1. El carnet: cabecera del modal e identidad, fijo ───────── */}
          <Carnet className="shrink-0" aria-busy={cargando}>
            <CarnetCabecera
              kicker={t("myStats.carnetKicker")}
              trailing={<CloseButton onClick={onClose} />}
            />

            <CarnetNombre
              nombre={nickname}
              apunte={desde}
              cargando={cargando}
              onEdit={() => go(onOpenNickname)}
              editLabel={t("myStats.changeNick")}
              sello={
                <SelloTier
                  tier={state.tier?.tier}
                  label={tierLabel}
                  title={t("myStats.tierLabel")}
                />
              }
            />

            {/* La banda: puntos · puesto · racha · máxima. El oro solo donde se
                gana — el puesto y la racha VIVA; una máxima de 0 en oro
                devaluaría el oro en el resto del juego. */}
            <CarnetCifras
              items={[
                {
                  label: t("myStats.points"),
                  value: cargando ? "—" : state.points,
                },
                {
                  label: t("myStats.rankShort"),
                  value: cargando
                    ? "—"
                    : state.rank?.rank
                    ? ordinal(state.rank.rank, locale)
                    : "—",
                  tono: !cargando && state.rank?.rank ? "oro" : "apagada",
                },
                {
                  label: t("myStats.statStreak"),
                  value: cargando ? "—" : rachaViva,
                  tono: rachaViva > 0 ? "oro" : "",
                },
                {
                  label: t("myStats.statMaxStreak"),
                  value: cargando ? "—" : maxStreak,
                },
              ]}
            />
          </Carnet>

          {/* ── 2. Tus secciones: podios y portadillas (con scroll) ──────── */}
          <div className="scrollbar-premium -mx-5 min-h-0 flex-1 overflow-y-auto px-5">
            {/* Podios de temporada y de mes (solo si tiene alguno). */}
            <div className="mt-4 empty:hidden">
              <PodiumMedals userId={state.user?.id} />
            </div>

            {primerDia && (
              <p className="mt-4 border border-border-strong p-3 font-display text-[13px] italic leading-snug text-muted-foreground">
                {t("myStats.firstDay")}
              </p>
            )}

            <h3 className="pm-label mb-2 mt-4">{t("myStats.destinations")}</h3>
            <div className="prensa-rejilla">
              <Portadilla
                icono={<Icon d={I.garage} size={20} />}
                nombre={t("garage.headerTitle")}
                apunte={archivoApunte}
                onClick={() => go(onOpenGarage)}
              />
              <Portadilla
                icono={<Icon d={I.trophy} size={20} />}
                nombre={t("ranking.title")}
                apunte={t("sumario.clasificacionApunte")}
                onClick={() => go(onOpenRanking, "perfil")}
              />
              {/* La edición Android como una portadilla más, permanente y sin
                  caducidad: aquí no molesta a nadie (hay que abrir el perfil
                  para verla) y recoge al que la busca a propósito, que es el
                  caso que el faldón del resultado no cubre — ese solo aparece
                  una vez y se puede rechazar. Última a propósito: las de arriba
                  llevan a secciones del juego, esta se sale de la web.
                  Con ella son tres —y la última ocupa el ancho entero, ver
                  .prensa-rejilla—; sin ella, dos y la fila cierra sola. Fueron
                  cuatro mientras existió la puerta de los Logros. */}
              {ofreceApp && (
                <Portadilla
                  icono={<PhoneIcon className="h-5 w-5" />}
                  nombre={t("app.promoDoor")}
                  apunte={t("myStats.appApunte")}
                  onClick={() => {
                    track("app_promo_click", { surface: "perfil" });
                    window.open(urlPlay("perfil"), "_blank", "noopener,noreferrer");
                  }}
                />
              )}
            </div>
          </div>

          {/* ── 3. Ajustes: idioma, sesión y borrado ─────────────────────── */}
          <h3 className="pm-label mb-2 mt-4 shrink-0">{t("myStats.settings")}</h3>

          <div className="prensa-ajustes shrink-0">
            <LanguageStrip />

            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="et block">{t("myStats.session")}</span>
                <span
                  className="mt-0.5 block truncate font-display text-[12px] italic text-muted-foreground"
                  title={email}
                >
                  {email || t("myStats.sessionAnon")}
                </span>
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                // Geometría del chip del sistema (pm-chip), el mismo del idioma
                // y de la tinta: es una acción, no un caption gris. Rojo al
                // pasar, que es la única acción con consecuencia del modal.
                className="focus-ring pm-chip pm-chip--rojo shrink-0"
              >
                {t("common.signOut")}
              </button>
            </div>

            {/* Borrado de cuenta. Solo con cuenta de verdad (`email` vacío =
                sesión anónima, que no tiene nada que borrar en servidor).

                DELIBERADAMENTE en su propio renglón y en tinta apagada, no como
                un chip al lado de «Cerrar sesión»: son dos acciones que empiezan
                igual («salir de aquí») y acaban en sitios opuestos, y la
                distancia visual es lo que evita el clic equivocado. Play exige
                que exista y que se encuentre; no exige que compita. */}
            {email && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setBorrarAbierto(true)}
                  className="focus-ring font-body text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-rojo hover:decoration-rojo"
                >
                  {t("deleteAccount.entry")}
                </button>
              </div>
            )}
          </div>

          {state.error && (
            <p className="mt-3 shrink-0 text-center text-sm text-rojo">{state.error}</p>
          )}
        </>
      )}
    </ModalShell>

    {/* HERMANO del carnet, no hijo: el panel de ModalShell lleva `transform`
        (la animación de entrada), y un `position: fixed` dentro de un ancestro
        con transform se posiciona contra ESE ancestro, no contra la ventana —
        anidarlo lo dejaría recortado dentro del carnet en vez de centrado en la
        pantalla. */}
    <DeleteAccountModal open={borrarAbierto} onClose={() => setBorrarAbierto(false)} />
    </>
  );
}
