// src/components/Ranking.jsx
// LA CLASIFICACIÓN — la tabla de la temporada y el salón de campeones.
//
// Este modal era la última superficie grande de la web pública que seguía
// montada sobre el chasis anterior: tarjetas redondeadas, píldoras, pestañas
// segmentadas sobre gris, halo pulsante en la racha y —lo que más daño hacía—
// el puesto pintado como un `7` gris en Franklin. La faja de portada prometía
// una cifra dorada de 38px en Fraunces y al tocarla aparecía otra cosa: el
// reconocimiento no se rompía al salir, se rompía al LLEGAR.
//
// Ahora es un recuadro de resultados de periódico: ladillo con filete, doble
// filete de cierre, cifras en Fraunces tabulares, sellos en vez de píldoras y
// el mismo marcador de puesto (PuestoCifra) que la faja, la faja fina y el
// parte del final de partida.
//
// LA CONTINUIDAD la da el propio glifo: el ordinal que el jugador toca en la
// barra (Header) es el mismo que le señala su fila aquí. La cabecera «Tu puesto»
// que hubo bajo el ladillo se retiró al simplificar el modal — repetía en grande
// lo que la fila destacada ya dice, y empujaba la tabla fuera de pantalla.

import { useEffect, useState } from "react";
import {
  getSeasonLeaderboard,
  getCurrentSeason,
  getChampions,
  getLeaderboard,
} from "../lib/statsService";
import { daysUntilClose } from "../lib/season";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";
import ScoringHelpModal from "./ScoringHelpModal";
import PublicProfile from "./PublicProfile";
import PuestoCifra, { tonoPorPuesto } from "./PuestoCifra";
import { track } from "../lib/analytics";

function getStreakDisplay(streak) {
  if (!streak || streak < 2) return null;
  if (streak >= 4) return { icon: "blaze", bonus: "+3" };
  if (streak === 3) return { icon: "spark_double", bonus: "+2" };
  return { icon: "spark", bonus: "+1" };
}

// La racha, en oro viejo y quieta. Antes latía (`animate-pulse`) y venía en el
// menta del tema anterior: sobre papel, un halo que respira no existe — y el
// bonus de racha es justo lo que el oro significa, «esto vale algo».
function StreakBadge({ streak }) {
  const { t } = useT();
  const display = getStreakDisplay(streak);
  if (!display) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 leading-none"
      title={t("ranking.streakTitle", { count: streak })}
      aria-label={t("ranking.streakAria", { count: streak, bonus: display.bonus })}
    >
      <AchievementIcon name={display.icon} size="h-4 w-4" color="text-oro-viejo" />
      <span className="font-body text-[11px] font-bold text-oro-viejo">{display.bonus}</span>
    </span>
  );
}

// El sello «TÚ» de una fila: doble filete y Courier, sin rotación (en una fila
// de tabla el sello estampado a mano se comería la línea de al lado).
function SelloYo() {
  const { t } = useT();
  return <span className="pm-sello pm-sello--plano rank-yo">{t("ranking.you")}</span>;
}

// El bloque de puntos de una fila: cifra en Fraunces tabular + su etiqueta.
function Puntos({ value, destacado = false }) {
  return (
    <div className="text-right">
      <div
        className={
          "font-display text-xl font-black leading-none tabular-nums " +
          (destacado ? "text-oro-viejo" : "text-tinta")
        }
      >
        {value}
      </div>
    </div>
  );
}

// Una fila de la tabla — la misma en la temporada y en el salón de campeones.
// Vive FUERA del componente a propósito: definida dentro, React la trataría como
// un tipo nuevo en cada render y desmontaría/remontaría la tabla entera cada vez
// que cambia cualquier estado del modal (abrir un perfil, cambiar de pestaña).
function Fila({
  pos, userId, nombre, puntos, sub, streak,
  currentUserId, clicable, source, onAbrirPerfil,
}) {
  const isSelf = currentUserId && currentUserId === userId;
  // Tu propia fila nunca es clicable (para verte a ti ya tienes MyStats), y los
  // visitantes anónimos ven la tabla pero no abren perfiles ajenos.
  const isClickable = clicable && !isSelf;
  const RowTag = isClickable ? "button" : "div";
  return (
    <RowTag
      type={RowTag === "button" ? "button" : undefined}
      onClick={
        RowTag === "button"
          ? () => {
              track("profile_view", { source });
              onAbrirPerfil(userId);
            }
          : undefined
      }
      className={
        "grid w-full grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-2.5 text-left " +
        (isSelf ? "bg-tinta/[0.05] " : "") +
        (RowTag === "button" ? "transition-colors hover:bg-tinta/[0.04]" : "")
      }
    >
      <PuestoCifra pos={pos} size="s" tono={tonoPorPuesto(pos)} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-display text-sm font-semibold text-tinta">{nombre}</p>
          {isSelf && <SelloYo />}
          <StreakBadge streak={streak} />
        </div>
        {sub && <p className="mt-0.5 font-display text-[11px] italic text-tinta-2">{sub}</p>}
      </div>

      <Puntos value={puntos} destacado={pos === 1} />
    </RowTag>
  );
}

export default function Ranking({
  open,
  onClose,
  user,
  onOpenLogin,
  // Logueado sin display_name: no aparece en la tabla. Se le ofrece elegir firma
  // AQUÍ, que es donde eso se nota (ver NicknameModal.jsx).
  necesitaNick = false,
  onOpenNickname,
}) {
  const { t, tn, locale } = useT();
  const [state, setState] = useState({
    loading: true,
    players: [],
    error: "",
  });
  // Temporada activa, para el banner (número + tema) y el countdown de cierre.
  // null = sin temporada activa (hueco o aún no configurada) → no se pinta banner.
  const [season, setSeason] = useState(null);
  // Pestaña activa: la clasificación de la temporada en curso ("temporada"), el
  // SALÓN DE CAMPEONES histórico ("campeones") o LEYENDAS, el acumulado all-time
  // ("leyendas"). Las dos históricas se cargan PEREZOSAS al abrir su pestaña por
  // primera vez (no lastramos la apertura del ranking con fetches que la mayoría
  // no mira).
  //
  // Leyendas vivía como modal aparte colgando de una "puerta" del perfil, encima
  // de él y con su propio listener de Escape: una pulsación cerraba los dos. Es
  // una clasificación, no una sección del perfil, así que su sitio es esta tira
  // de pestañas, junto a las otras dos. De paso se lleva por delante la última
  // superficie con el chasis anterior (puesto en Franklin gris, tarjetas con
  // filete propio): aquí reusa la MISMA fila que la temporada y el palmarés.
  const [view, setView] = useState("temporada");
  const [champions, setChampions] = useState({ loading: false, seasons: [], error: "", loaded: false });
  const [legends, setLegends] = useState({ loading: false, players: [], error: "", loaded: false });
  const [helpOpen, setHelpOpen] = useState(false);
  // Modal de perfil público al clicar una fila del ranking. Guardamos el userId
  // del jugador objetivo; null = cerrado.
  const [openProfileId, setOpenProfileId] = useState(null);
  // userId del usuario actual (logueado), si lo hay. Lo usamos para NO hacer
  // clicable su propia fila — ya tiene su MyStats privado.
  const currentUserId = user?.id || null;
  // Mi fila dentro del leaderboard cargado. Si estoy fuera del top visible, la
  // fijamos abajo para que siempre vea dónde estoy.
  const selfRow = currentUserId
    ? state.players.find((p) => p.userId === currentUserId) || null
    : null;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState({ loading: true, players: [], error: "" });
    // Cada apertura arranca en la pestaña de temporada y descarta el palmarés
    // cacheado (por si se cerró una temporada entre visitas).
    setView("temporada");
    setChampions({ loading: false, seasons: [], error: "", loaded: false });
    setLegends({ loading: false, players: [], error: "", loaded: false });

    // El leaderboard de la temporada y la temporada activa (para el banner) son
    // independientes: los pedimos en paralelo.
    Promise.all([getSeasonLeaderboard(), getCurrentSeason()])
      .then(([players, s]) => {
        if (cancelled) return;
        setSeason(s);
        setState({ loading: false, players, error: "" });
      })
      .catch((err) => {
        // No nos tragamos el error: lo logueamos para poder diagnosticar por qué
        // falla el ranking (típicamente un error de PostgREST/Supabase: RPC
        // ausente, relación no encontrada, GRANT revocado…). Un error de
        // leaderboard no contiene PII ni pistas del coche (CLAUDE.md #8).
        console.error("[Ranking] fallo cargando la temporada", err);
        if (!cancelled)
          setState({ loading: false, players: [], error: t("ranking.errorLoad") });
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // El perfil público entra en la condición junto a la ayuda: es otro sub-modal
  // que se monta ENCIMA con su propio listener de Escape, así que sin esto una
  // sola pulsación cerraba el perfil ajeno Y el ranking de debajo. Es el mismo
  // defecto que tenía el perfil con «Leyendas», que ahora es una pestaña.
  useEscape(open && !helpOpen && !openProfileId, onClose);

  // Cambio de pestaña. La primera vez que se abre "Campeones" dispara el fetch
  // del palmarés (perezoso, una sola vez por apertura del modal).
  function selectView(next) {
    setView(next);
    if (next === "campeones" && !champions.loaded && !champions.loading) {
      track("champions_view", { source: "ranking" });
      setChampions({ loading: true, seasons: [], error: "", loaded: false });
      getChampions()
        .then((seasons) => setChampions({ loading: false, seasons, error: "", loaded: true }))
        .catch((err) => {
          // Mismo criterio que el leaderboard: logueamos (sin PII) y mostramos
          // un mensaje genérico. Típico si aún no se aplicó la migración SQL.
          console.error("[Ranking] fallo cargando el salón de campeones", err);
          setChampions({ loading: false, seasons: [], error: t("ranking.errorLoad"), loaded: true });
        });
    }
    if (next === "leyendas" && !legends.loaded && !legends.loading) {
      track("legends_view", { source: "ranking" });
      setLegends({ loading: true, players: [], error: "", loaded: false });
      getLeaderboard()
        .then((players) => setLegends({ loading: false, players, error: "", loaded: true }))
        .catch((err) => {
          console.error("[Ranking] fallo cargando el histórico", err);
          setLegends({ loading: false, players: [], error: t("ranking.errorLoad"), loaded: true });
        });
    }
  }

  // Props comunes a todas las filas de la tabla.
  const filaBase = {
    currentUserId,
    clicable: !!user,
    onAbrirPerfil: setOpenProfileId,
  };

  return (
    <>
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("ranking.tag")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat w-full max-w-md p-5"
    >
        {/* X anclada a la esquina de la tarjeta plana (el panel es relative). */}
        <div className="absolute right-2 top-2 z-10">
          <CloseButton onClick={onClose} />
        </div>

        {/* Ladillo de sección: la MISMA palabra que la faja de portada
            («La clasificación»), no un título distinto para el mismo sitio. */}
        <div className="prensa-ladillo pr-10">{t("ranking.tag")}</div>

        {/* Conmutador de pestañas: la clasificación de la temporada en curso vs
            el SALÓN DE CAMPEONES (palmarés de temporadas cerradas). Versalitas
            con filete rojo bajo la activa — el segmentado con fondo gris era
            vocabulario de app, no de periódico. */}
        <div className="rank-tabs">
          {/* `aria-pressed` y no el patrón role="tablist"/"tab": ese exige
              paneles con aria-controls y navegación por flechas, y aquí son dos
              botones que reemplazan el contenido. Un patrón ARIA a medias
              confunde más al lector de pantalla que no ponerlo. */}
          {[
            ["temporada", t("ranking.tabSeason")],
            ["campeones", t("ranking.tabChampions")],
            // Leyendas solo para logueados: es donde vivía antes (colgando del
            // perfil) y donde tiene sentido — al anónimo le velamos la propia
            // tabla de la temporada, no vamos a regalarle el acumulado de años.
            ...(user ? [["leyendas", t("ranking.legends")]] : []),
          ].map(
            ([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectView(id)}
                aria-pressed={view === id}
                className={"rank-tab" + (view === id ? " rank-tab--activa" : "")}
              >
                {lbl}
              </button>
            )
          )}
          <button type="button" className="rank-ayuda group" onClick={() => setHelpOpen(true)} aria-label={t("ranking.helpButtonAria")} title={t("ranking.helpButtonAria")}>
            <span className="flex items-center justify-center w-5 h-5 rounded-full border border-current font-serif text-sm font-medium transition-colors group-hover:bg-rojo group-hover:text-papel">?</span>
          </button>
        </div>

        {view === "temporada" && (
        <>
        {/* Banner de la temporada en curso: número + tema + countdown de cierre.
            Cabecera de sección de periódico (versalitas en oro sobre doble
            filete), no una tarjeta con esquinas redondeadas. */}
        {season &&
          (() => {
            const d = daysUntilClose(season.ends_at);
            const label = locale === "en" ? season.label_en : season.label_es;
            return (
              <div className="rank-temporada">
                <div className="min-w-0">
                  <p className="rank-temporada-kicker">
                    {t("ranking.seasonKicker", { n: season.number })}
                  </p>
                  <p className="rank-temporada-tema">{label}</p>
                </div>
                {d != null && (
                  <span className="rank-temporada-cierre">
                    {d <= 0 ? t("ranking.closesToday") : tn("ranking.closesIn", d)}
                  </span>
                )}
              </div>
            );
          })()}

        {/* Logueado pero sin firma: aquí —y solo aquí— el nick significa algo,
            porque sin él no se sale en la tabla (las SQL de temporada filtran
            `display_name IS NOT NULL`). Antes esto se cobraba por adelantado con
            un modal obligatorio nada más entrar; ahora se ofrece en el sitio
            donde el jugador entiende para qué sirve. */}
        {necesitaNick && (
          <div className="mb-3 border border-dashed border-tinta px-4 py-3 text-center">
            <p className="pm-body text-sm">{t("ranking.nickPrompt")}</p>
            <button type="button" onClick={onOpenNickname} className="pm-btn mt-3">
              {t("ranking.nickCta")}
            </button>
          </div>
        )}

        {state.loading ? (
          <p className="pm-body py-3 text-sm">{t("ranking.loading")}</p>
        ) : state.error ? (
          <p className="py-3 font-display text-sm text-rojo">{state.error}</p>
        ) : state.players.length === 0 ? (
          <p className="pm-body py-3 text-sm">{t("ranking.emptySeason")}</p>
        ) : (
          <div className="rank-tabla">
            {/* El `pr` extra cuando la tabla scrollea compensa el ancho de la
                barra: la cabecera vive FUERA del contenedor con scroll, y sin
                esto la columna de puntos quedaba 6px desalineada de sus cifras. */}
            <div
              className={
                "rank-cabecera grid grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] gap-2 px-3 py-2 " +
                (user && state.players.length > 5 ? "pr-[calc(0.75rem+6px)]" : "")
              }
            >
              <span>{t("ranking.colRank")}</span>
              <span>{t("ranking.colPlayer")}</span>
              <span className="text-right">{t("ranking.colPoints")}</span>
            </div>

            <div
              className={`
                relative divide-y divide-border
                ${user && state.players.length > 5 ? "scrollbar-premium max-h-[22rem] overflow-y-auto" : ""}
                ${!user && state.players.length > 3 ? "max-h-[17.9rem] overflow-hidden sm:max-h-[19rem]" : ""}
              `}
            >
              {state.players.map((player, index) => (
                <div
                  key={player.userId}
                  // El velo del anónimo: de la 4ª fila en adelante el dato se
                  // desenfoca. No es adorno — es la razón de existir del CTA de
                  // abajo, y por eso el desenfoque va aquí y no en el CSS de la
                  // fila (que es compartida con campeones).
                  style={
                    !user && index > 2 ? { filter: "blur(1.2px)", opacity: 0.62 } : undefined
                  }
                >
                  <Fila
                    {...filaBase}
                    source="ranking"
                    pos={player.rank}
                    userId={player.userId}
                    nombre={player.displayName}
                    puntos={player.totalPoints}
                    streak={player.currentStreak}
                  />
                </div>
              ))}

              {!user && state.players.length > 3 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-papel/80 to-papel" />
              )}
            </div>

            {/* Fuera del top visible: tu fila se fija al pie de la tabla, con
                doble filete de por medio (es un aparte, no la fila siguiente). */}
            {selfRow && selfRow.rank > 5 && (
              <div className="arch-filete">
                <p className="rank-tuposicion">{t("ranking.yourPosition")}</p>
                <Fila
                  {...filaBase}
                  clicable={false}
                  pos={selfRow.rank}
                  userId={selfRow.userId}
                  nombre={selfRow.displayName}
                  puntos={selfRow.totalPoints}
                  streak={selfRow.currentStreak}
                />
              </div>
            )}

            {!user && state.players.length > 3 && (
              <div className="border-t border-border-strong p-4">
                <p className="pm-body text-center text-sm">{t("ranking.loginPrompt")}</p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin?.();
                  }}
                  className="pm-btn mt-3"
                >
                  {t("ranking.loginCta")}
                </button>
              </div>
            )}
          </div>
        )}
        </>
        )}

        {/* SALÓN DE CAMPEONES: temporadas cerradas con su podio. Los datos ya se
            sellaban en season_podium al cerrar cada temporada; esto es la vista
            que faltaba. Filas clicables al perfil igual que la temporada. */}
        {view === "campeones" &&
          (champions.loading ? (
            <p className="pm-body py-3 text-sm">{t("ranking.loading")}</p>
          ) : champions.error ? (
            <p className="py-3 font-display text-sm text-rojo">{champions.error}</p>
          ) : champions.seasons.length === 0 ? (
            <p className="pm-body py-3 text-sm">{t("ranking.championsEmpty")}</p>
          ) : (
            <div className="scrollbar-premium max-h-[26rem] space-y-4 overflow-y-auto pr-1">
              {champions.seasons.map((s) => {
                const label = locale === "en" ? s.labelEn : s.labelEs;
                let when = "";
                try {
                  when = new Date(`${s.endsAt}T00:00:00`).toLocaleDateString(
                    locale === "en" ? "en-US" : "es-ES",
                    { day: "numeric", month: "short", year: "numeric" }
                  );
                } catch {
                  when = "";
                }
                return (
                  <div key={s.number} className="rank-tabla">
                    <div className="rank-temporada rank-temporada--palmares">
                      <div className="min-w-0">
                        <p className="rank-temporada-kicker">
                          {t("ranking.seasonKicker", { n: s.number })}
                        </p>
                        <p className="rank-temporada-tema">{label}</p>
                      </div>
                      {when && <span className="rank-temporada-fecha">{when}</span>}
                    </div>
                    <div className="divide-y divide-border">
                      {s.podium.map((c) => (
                        <Fila
                          {...filaBase}
                          key={c.rank}
                          source="champions"
                          pos={c.rank}
                          userId={c.userId}
                          nombre={c.displayName}
                          puntos={c.points}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

        {/* LEYENDAS: la clasificación histórica all-time (acumulado de
            total_points, que SÍ incluye el bonus de racha). Cabecera de sección
            como la de temporada y la MISMA fila que las otras dos vistas: el
            jugador reconoce su puesto porque es el mismo glifo en las tres. */}
        {view === "leyendas" && (
          <>
            <div className="rank-temporada">
              <div className="min-w-0">
                <p className="rank-temporada-kicker">{t("ranking.legends")}</p>
                <p className="rank-temporada-tema">{t("ranking.legendsSubtitle")}</p>
              </div>
            </div>

            {legends.loading ? (
              <p className="pm-body py-3 text-sm">{t("ranking.loading")}</p>
            ) : legends.error ? (
              <p className="py-3 font-display text-sm text-rojo">{legends.error}</p>
            ) : legends.players.length === 0 ? (
              <p className="pm-body py-3 text-sm">{t("ranking.empty")}</p>
            ) : (
              <div className="rank-tabla">
                <div
                  className={
                    "rank-cabecera grid grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] gap-2 px-3 py-2 " +
                    (legends.players.length > 5 ? "pr-[calc(0.75rem+6px)]" : "")
                  }
                >
                  <span>{t("ranking.colRank")}</span>
                  <span>{t("ranking.colPlayer")}</span>
                  <span className="text-right">{t("ranking.colPoints")}</span>
                </div>

                <div
                  className={
                    "divide-y divide-border " +
                    (legends.players.length > 5 ? "scrollbar-premium max-h-[22rem] overflow-y-auto" : "")
                  }
                >
                  {legends.players.map((player) => (
                    <Fila
                      {...filaBase}
                      key={player.userId}
                      source="legends"
                      pos={player.rank}
                      userId={player.userId}
                      nombre={player.displayName}
                      puntos={player.totalPoints}
                      sub={t("ranking.bestStreak", { value: player.maxStreak })}
                      streak={player.currentStreak}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
    </ModalShell>

    {/* Sub-modal hermano (no anidado): cada uno gestiona su propio backdrop y su
        animación de entrada/salida. */}
    <ScoringHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    <PublicProfile
      open={!!openProfileId}
      userId={openProfileId}
      onClose={() => setOpenProfileId(null)}
    />
    </>
  );
}
