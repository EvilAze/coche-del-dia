// src/components/MyStats.jsx
// TU CARNET — identidad, tus cifras y las puertas a tus secciones.
//
// El modal hacía cuatro trabajos (identidad, ficha de racha, navegación,
// ajustes) y los presentaba como cuatro cajas con filete apiladas, todas con el
// mismo peso: nada decía qué mirar primero. El rediseño los ordena en tres
// planos con una jerarquía explícita:
//
//   1. EL CARNET (fijo arriba, hace de cabecera del modal). El `<h2>Mi Perfil</h2>`
//      que había encima decía lo mismo que el carnet de debajo, así que se fue y
//      con él ~60px de alto — que es justo lo que le faltaba a este modal para
//      caber en un móvil (ver punto 3).
//   2. LO QUE HAS GANADO (scrollable): podios y puertas a Archivo, Clasificación
//      y Logros. Cada cifra vive en su sección; el perfil es solo la puerta.
//   3. AJUSTES (fijo abajo): idioma, sesión y salir, tras doble filete.
//
// Tres arreglos que venían de regalo con el rediseño:
//   · El panel no llevaba `max-h` ni zona con scroll (PublicProfile sí): con
//     medallas de podio, el contenido pasaba de 600px y en pantallas cortas se
//     cortaba SIN forma de llegar al pie — useScrollLock bloquea el body, así
//     que «Cerrar sesión» quedaba literalmente inalcanzable.
//   · La puerta «Leyendas» abría un sub-modal ENCIMA de este, y ambos escuchaban
//     Escape: una pulsación cerraba los dos. El histórico se mudó a su sitio
//     natural, la tercera pestaña de la Clasificación (Ranking.jsx), y el
//     conflicto desaparece de raíz.
//   · La ficha tenía una tercera fila, el inventario de escudos de racha: dos
//     siluetas sin una sola palabra al lado. Intentar explicarlas fue lo que
//     destapó que la mecánica entera sobraba (un seguro que el jugador no sabe
//     que tiene no le evita abandonar, y una racha que a veces perdona deja de
//     ser un contrato). Se retiró: scripts/2026-08-retirar-escudo-racha.sql.

import { useEffect, useState } from "react";
import { getProfileSummary } from "../lib/statsService";
import { signOut } from "../lib/auth";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import LanguageStrip from "./LanguageStrip";
import PodiumMedals from "./PodiumMedals";
import Carnet, { CarnetHead, CarnetCifra, FichaRow, FichaCifra } from "./carnet/Carnet";
import {
  FlameIcon,
  CrownIcon,
  CarIcon,
  MedalIcon,
  TrophyIcon,
  ChevronRightIcon,
} from "./carnet/icons";

// Puerta a un destino (Archivo / Clasificación / Logros): icono rojo + nombre +
// dato clave + chevron. Es un botón: cierra el perfil y abre el destino real.
//
// La Clasificación es la única sin dato a la derecha, y a propósito: su cifra
// (puntos y puesto) es la CABECERA del carnet, dos bloques más arriba. Repetirla
// aquí sería decir dos veces lo mismo en la misma pantalla.
function DoorRow({ icon, label, value, onClick, last = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-rojo/[0.06] ${
        last ? "" : "border-b border-border-strong/60"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 text-rojo">{icon}</span>
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {value && (
          <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
        )}
        <span className="text-muted-foreground">
          <ChevronRightIcon />
        </span>
      </span>
    </button>
  );
}

export default function MyStats({
  open,
  onClose,
  onSignedOut,
  onOpenAchievements,
  onOpenGarage,
  onOpenRanking,
  onOpenNickname,
}) {
  const { t, locale } = useT();
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    stats: null,
    points: 0,
    rank: null,
    collection: null,
    achievements: null,
    tier: null,
    error: "",
  });

  useEffect(() => {
    if (!open) return;

    setState((current) => ({ ...current, loading: true, error: "" }));

    getProfileSummary()
      .then((data) => setState({ loading: false, error: "", ...data }))
      .catch(() =>
        setState((current) => ({
          ...current,
          loading: false,
          error: t("myStats.errorLoad"),
        }))
      );
  }, [open]);

  async function handleSignOut() {
    const { error } = await signOut();

    if (error) {
      setState((current) => ({ ...current, error: t("myStats.errorSignOut") }));
      return;
    }

    onSignedOut?.();
    onClose?.();
  }

  useEscape(open, onClose);

  const cargando = state.loading;
  const stats = state.stats;
  const nickname = state.profile?.display_name || t("myStats.noNickname");
  const email = state.user?.email || "";

  // Etiqueta del tier (Bronce/Plata/Oro) localizada; null hasta el primer coche.
  const tierLabel = state.tier?.tier
    ? state.tier.label?.[locale] || state.tier.label?.es
    : null;

  const onStreak = (stats?.current_streak ?? 0) > 0;
  const maxStreak = stats?.max_streak ?? 0;
  // Primer día: cero partidas ganadas y cero racha histórica. Sin esta línea, un
  // recién llegado abre su perfil y solo ve ceros y «Sin clasificar», sin una
  // sola pista de qué hacer.
  const primerDia = !cargando && !stats?.total_wins && !maxStreak;

  // Cierra el perfil y abre el destino de la puerta.
  // `source` viaja al opener (openRanking lo usa para saber de dónde nacen las
  // aperturas del ranking). Los demás openers ignoran el argumento.
  function go(opener, source) {
    onClose?.();
    opener?.(source);
  }

  // Datos de las puertas (cada uno cae con elegancia si su fuente falló).
  const garageValue = state.collection
    ? state.collection.total
      ? `${state.collection.unlocked} / ${state.collection.total}`
      : `${state.collection.unlocked}`
    : null;
  const logrosValue = state.achievements
    ? `${state.achievements.unlocked} / ${state.achievements.total}`
    : null;

  return (
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
          <p className="text-sm text-rojo">{state.error}</p>
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
            <CarnetHead
              kicker={t("myStats.carnetKicker")}
              nombre={nickname}
              cargando={cargando}
              onEdit={() => go(onOpenNickname)}
              editLabel={t("myStats.changeNick")}
              // La X vive DENTRO de la cabecera, no flotando sobre ella: así el
              // nombre trunca antes de llegar al botón en vez de pasarle por
              // debajo, y el carnet puede ser de verdad la primera fila.
              trailing={<CloseButton onClick={onClose} className="-mr-2 -mt-2" />}
            />

            <CarnetCifra
              puntos={cargando ? "—" : state.points}
              puntosLabel={t("myStats.points")}
              puesto={state.rank?.rank || null}
              puestoTotal={state.rank?.total || null}
              // Mientras carga, una raya en el sitio del puesto: sin ella la
              // línea nace vacía y el carnet crece de golpe al llegar el dato.
              sinPuesto={cargando ? "—" : state.rank?.rank ? null : t("myStats.rankNone")}
              sello={
                tierLabel && (
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="pm-label">{t("myStats.tierLabel")}</span>
                    <span className="pm-sello pm-sello--oro">{tierLabel}</span>
                  </span>
                )
              }
            />

            {/* Ficha de racha: en racha · mejor racha. Había una tercera fila,
                el inventario de escudos, con la mecánica retirada en agosto de
                2026 (ver scripts/2026-08-retirar-escudo-racha.sql). */}
            <div className="mt-3 border-t border-border pt-1">
              <FichaRow
                icon={
                  <span className={onStreak ? "text-gold" : "text-muted-foreground"}>
                    <FlameIcon />
                  </span>
                }
                label={t("myStats.streakCurrent")}
              >
                <FichaCifra
                  value={cargando ? "—" : (stats?.current_streak ?? 0)}
                  premium={onStreak}
                />
              </FichaRow>

              <FichaRow
                last
                icon={
                  <span className={maxStreak > 0 ? "text-gold" : "text-muted-foreground"}>
                    <CrownIcon />
                  </span>
                }
                label={t("myStats.streakBest")}
              >
                <FichaCifra value={cargando ? "—" : maxStreak} premium={maxStreak > 0} />
              </FichaRow>
            </div>

            {primerDia && (
              <p className="mt-3 border-t border-border pt-3 font-display text-[13px] italic leading-snug text-muted-foreground">
                {t("myStats.firstDay")}
              </p>
            )}
          </Carnet>

          {/* ── 2. Lo que has ganado: podios y puertas (con scroll) ──────── */}
          <div className="scrollbar-premium -mx-5 min-h-0 flex-1 overflow-y-auto px-5">
            {/* Podios de temporada y de mes (solo si tiene alguno). */}
            <div className="mt-4 empty:hidden">
              <PodiumMedals userId={state.user?.id} />
            </div>

            {/* Los dos ladillos del modal (secciones y ajustes) hablan el mismo
                idioma: versalitas del sistema (pm-label). Antes uno era un
                párrafo gris de 12px y el otro no existía. */}
            <h3 className="pm-label mb-2 mt-4">{t("myStats.destinations")}</h3>
            <div className="overflow-hidden border border-border bg-bg-tertiary">
              <DoorRow
                icon={<CarIcon />}
                label={t("garage.headerTitle")}
                value={garageValue}
                onClick={() => go(onOpenGarage)}
              />
              <DoorRow
                icon={<MedalIcon />}
                label={t("ranking.title")}
                onClick={() => go(onOpenRanking, "perfil")}
              />
              <DoorRow
                last
                icon={<TrophyIcon />}
                label={t("header.achievements")}
                value={logrosValue}
                onClick={() => go(onOpenAchievements)}
              />
            </div>
          </div>

          {/* ── 3. Ajustes: idioma, sesión y salir, tras doble filete ────── */}
          <div className="arch-filete mt-4 shrink-0 pt-4">
            <h3 className="pm-label mb-2.5">{t("myStats.settings")}</h3>

            <LanguageStrip />

            <div className="mt-3 flex items-center justify-between gap-3">
              {/* El email SALE de debajo del nick y aterriza aquí: nadie abre su
                  perfil para descubrir su propio correo, pero al cerrar sesión sí
                  importa saber cuál se cierra. De paso deja de estar en la línea
                  más visible del carnet, que es la que acaba en las capturas. */}
              <p className="min-w-0 truncate text-[11px] text-muted-foreground" title={email}>
                {email}
              </p>
              <button
                type="button"
                onClick={handleSignOut}
                // Geometría del chip del sistema (filete + versalitas), no un
                // caption gris de 12px que parecía deshabilitado. Rojo al pasar:
                // es la única acción con consecuencia de todo el modal.
                className="focus-ring shrink-0 border border-border-strong px-3 py-1.5 font-body text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-rojo hover:text-rojo"
              >
                {t("common.signOut")}
              </button>
            </div>

            {state.error && (
              <p className="mt-3 text-center text-sm text-rojo">{state.error}</p>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}
