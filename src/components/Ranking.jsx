// src/components/Ranking.jsx
// LA CLASIFICACIÓN (sistema «Asfalto») — la tabla de la temporada, el salón de
// campeones y las leyendas.
//
// LO QUE CAMBIÓ CON «ASFALTO», y por qué. La prensa la componía como el
// recuadro de resultados de un periódico: versalitas, dobles filetes y un
// ordinal en Fraunces por fila. Funcionaba como tabla, pero no contaba nada —
// el primero y el decimoctavo pesaban lo mismo, y para saber dónde estabas
// había que buscarte. Ahora se lee de arriba abajo como lo que es, una carrera:
//
//   · LA TEMPORADA ES UNA TARJETA CON SU RELOJ. Número, tema, «cierra en N
//     días» y una regla de segmentos con el día de hoy en rojo (`progresoPeriodo`):
//     cuánto queda es lo que decide si merece la pena apretar.
//   · EL PODIO SE VE. Los tres primeros suben a sus peanas con oro, plata y
//     bronce — los únicos colores de medalla del sistema, y aquí están ganados.
//     En el DOM van en orden (1, 2, 3) para el lector de pantalla; el 2-1-3 de
//     la foto lo pone el CSS.
//   · TÚ VAS SIEMPRE A LA VISTA. Tu fila es `sticky` arriba y abajo: si estás
//     fuera de la pantalla se queda pegada al borde, y al llegar a tu sitio se
//     posa en él. Una sola fila, sin duplicarla en un aparte, y debajo de tu
//     nombre lo que te importa: cuánto te has movido y a cuántos puntos tienes
//     al de delante.
//
// Lo que NO cambia: la carga perezosa de las dos pestañas históricas, el
// reintento con salida, la cadena del «atrás» (useHistoryChain) y que el
// anónimo vea la cabeza de la tabla y el resto velado, que es la razón de ser
// de su invitación a entrar.

import { useEffect, useState } from "react";
import {
  getSeasonLeaderboard,
  getCurrentSeason,
  getChampions,
  getLeaderboard,
  getWeekRange,
} from "../lib/statsService";
import { daysUntilClose, progresoPeriodo } from "../lib/season";
import { rankMovement } from "../lib/rankMovement";
import { useEscape } from "../hooks/useEscape";
import { useHistoryChain } from "../hooks/useHistoryClose";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import Superficie from "./Superficie";
import { Renglon } from "./Esqueleto";
import ScoringHelpModal from "./ScoringHelpModal";
import PublicProfile from "./PublicProfile";
import { ordinal } from "./PuestoCifra";
import { Icon, I } from "./configurator/icons";
import { track } from "../lib/analytics";

// El bonus que la racha suma cada día (ver ScoringHelpModal): +1 con dos días,
// +2 con tres, +3 a partir de cuatro. Por debajo de dos no hay racha que contar.
function bonusDeRacha(streak) {
  if (!streak || streak < 2) return null;
  return streak >= 4 ? 3 : streak - 1;
}

// La racha de una fila: la llama y los días. En oro solo cuando ya da el bonus
// máximo — el oro es «esto vale algo», y una racha de dos días todavía es una
// promesa. Quieta: aquí nada late.
function Racha({ streak }) {
  const { t } = useT();
  const bonus = bonusDeRacha(streak);
  if (!bonus) return null;
  return (
    <span
      className={"clas-racha" + (bonus === 3 ? " oro" : "")}
      role="img"
      title={t("ranking.streakTitle", { count: streak })}
      aria-label={t("ranking.streakAria", { count: streak, bonus: `+${bonus}` })}
    >
      <Icon d={I.flame} size={13} />
      <span aria-hidden="true">{streak}</span>
    </span>
  );
}

// La inicial del monograma. `Array.from` y no `[0]`: un nombre que empiece por
// un carácter fuera del plano básico partiría el par sustituto por la mitad.
function inicial(nombre) {
  const c = Array.from((nombre || "").trim())[0];
  return c ? c.toLocaleUpperCase() : "·";
}

// El tono de medalla de un puesto: lo comparten el podio y el palmarés.
function tonoDe(pos) {
  return pos === 1 ? " oro" : pos === 2 ? " plata" : pos === 3 ? " bronce" : "";
}

// UN FALLO CON SALIDA. Una clasificación que no carga merece el mismo trato que
// el juego y el cupón: el motivo escrito y un botón para reintentar, sin tener
// que adivinar que cerrar y abrir el panel también recarga.
function ErrorConSalida({ texto, onReintentar }) {
  const { t } = useT();
  return (
    <div className="clas-aviso">
      <p className="clas-aviso-texto rojo">{texto}</p>
      <button type="button" onClick={onReintentar} className="pm-btn pm-btn--ghost">
        {t("offline.retry")}
      </button>
    </div>
  );
}

// Una fila de la tabla — la misma en la temporada, el palmarés y las leyendas.
// Vive FUERA del componente a propósito: definida dentro, React la trataría como
// un tipo nuevo en cada render y desmontaría la tabla entera cada vez que cambia
// cualquier estado del panel (abrir un perfil, cambiar de pestaña).
function Fila({
  pos, userId, nombre, puntos, sub, streak, apunte,
  currentUserId, clicable, source, onAbrirPerfil,
}) {
  const { t } = useT();
  const isSelf = !!currentUserId && currentUserId === userId;
  // Tu propia fila nunca es clicable (para verte a ti ya tienes el perfil), y
  // los visitantes anónimos ven la tabla pero no abren perfiles ajenos.
  const isClickable = clicable && !isSelf;
  const Tag = isClickable ? "button" : "div";
  return (
    <Tag
      type={isClickable ? "button" : undefined}
      onClick={
        isClickable
          ? () => {
              track("profile_view", { source });
              onAbrirPerfil(userId);
            }
          : undefined
      }
      className={"clas-fila" + (isSelf ? " yo" : "") + (isClickable ? " clic" : "")}
    >
      <span className={"clas-pos" + tonoDe(pos)}>{pos}</span>
      <span className="clas-mono" aria-hidden="true">{inicial(nombre)}</span>
      <span className="clas-nombre">
        <span className="clas-nombre-linea">
          <b>{nombre}</b>
          {isSelf && <span className="clas-tu">{t("ranking.you")}</span>}
        </span>
        {apunte ? (
          <span className={"clas-apunte" + (apunte.tono ? ` ${apunte.tono}` : "")}>
            {apunte.icono && <Icon d={apunte.icono} size={12} strokeWidth="2.4" />}
            {apunte.texto}
          </span>
        ) : sub ? (
          <span className="clas-apunte">{sub}</span>
        ) : null}
      </span>
      <Racha streak={streak} />
      <span className="clas-puntos">{puntos}</span>
    </Tag>
  );
}

// EL PODIO. Los tres primeros, cada uno sobre su peana: más alta la del
// primero, y el número del puesto en su color de medalla.
function Podio({ jugadores, filaBase, source }) {
  const { t, locale } = useT();
  return (
    <ol className="clas-podio" aria-label={t("ranking.podio")}>
      {jugadores.map((j, i) => {
        const isSelf = !!filaBase.currentUserId && filaBase.currentUserId === j.userId;
        const isClickable = filaBase.clicable && !isSelf;
        const Tag = isClickable ? "button" : "div";
        return (
          <li key={j.userId} className={`clas-podio-puesto p${i + 1}${tonoDe(i + 1)}`}>
            <Tag
              type={isClickable ? "button" : undefined}
              className={"clas-podio-boton" + (isClickable ? " clic" : "")}
              onClick={
                isClickable
                  ? () => {
                      track("profile_view", { source });
                      filaBase.onAbrirPerfil(j.userId);
                    }
                  : undefined
              }
            >
              <span className="sr-only">{ordinal(j.rank, locale)}</span>
              <span className={"clas-mono grande" + (isSelf ? " yo" : "")} aria-hidden="true">
                {inicial(j.displayName)}
              </span>
              <span className="clas-podio-nombre">{j.displayName}</span>
              <span className="clas-podio-pts">
                {j.totalPoints} {t("scoring.ptsSuffix")}
              </span>
              <span className="clas-podio-peana" aria-hidden="true">{j.rank}</span>
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}

// La tabla de un periodo: el podio y, debajo, el resto. Con menos de tres
// jugadores no hay podio que levantar y todo va en lista. Al anónimo se le
// enseñan el podio y tres filas veladas: lo justo para que la invitación de
// debajo tenga algo que prometer, sin pintar mil filas desenfocadas.
function Tabla({ jugadores, filaBase, source, anonimo = false, apunteYo = null, sub = null }) {
  const conPodio = jugadores.length >= 3;
  let resto = conPodio ? jugadores.slice(3) : jugadores;
  if (anonimo) resto = resto.slice(0, 3);
  return (
    <>
      {conPodio && <Podio jugadores={jugadores.slice(0, 3)} filaBase={filaBase} source={source} />}
      {resto.length > 0 && (
        <ol className={"clas-lista" + (anonimo ? " velada" : "")} aria-hidden={anonimo || undefined}>
          {resto.map((j) => {
            const yo = !!filaBase.currentUserId && j.userId === filaBase.currentUserId;
            return (
              <li key={j.userId} className={yo ? "clas-li-yo" : undefined}>
                <Fila
                  {...filaBase}
                  clicable={filaBase.clicable && !anonimo}
                  source={source}
                  pos={j.rank}
                  userId={j.userId}
                  nombre={j.displayName}
                  puntos={j.totalPoints}
                  streak={j.currentStreak}
                  sub={sub ? sub(j) : null}
                  apunte={yo ? apunteYo : null}
                />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

// La tarjeta del periodo: qué se juega (número y tema, o la semana), cuándo
// cierra y en qué día estamos. Con más de un mes de periodo los segmentos
// dejarían de leerse como días, así que pasa a ser una barra continua.
function TarjetaPeriodo({ kicker, titulo, desde, hasta }) {
  const { t, tn } = useT();
  const quedan = hasta ? daysUntilClose(hasta) : null;
  const progreso = desde && hasta ? progresoPeriodo(desde, hasta) : null;
  return (
    <section className="clas-periodo">
      <div className="clas-periodo-cab">
        <span className="clas-kicker">{kicker}</span>
        {quedan != null && (
          <span className="clas-cierre">
            <Icon d={I.reloj} size={14} strokeWidth="2" />
            {quedan <= 0 ? t("ranking.closesToday") : tn("ranking.closesIn", quedan)}
          </span>
        )}
      </div>
      {titulo && <p className="clas-periodo-titulo">{titulo}</p>}
      {progreso && (
        <div className="clas-progreso">
          {progreso.total <= 31 ? (
            <span className="clas-regla" aria-hidden="true">
              {Array.from({ length: progreso.total }, (_, i) => (
                <i
                  key={i}
                  className={i + 1 < progreso.dia ? "hecho" : i + 1 === progreso.dia ? "hoy" : undefined}
                />
              ))}
            </span>
          ) : (
            <span className="clas-regla continua" aria-hidden="true">
              <i style={{ width: `${(progreso.dia / progreso.total) * 100}%` }} />
            </span>
          )}
          <span className="clas-dia">{t("ranking.diaDe", { n: progreso.dia, total: progreso.total })}</span>
        </div>
      )}
    </section>
  );
}

// La espera con la forma de la lista: puesto, monograma, nombre y puntos en la
// MISMA fila que llegará, para que al cargar no se mueva ninguna columna.
function FilasEsperando({ n = 8, texto }) {
  return (
    <div role="status" aria-label={texto} className="clas-lista">
      <span className="sr-only">{texto}</span>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="clas-fila" aria-hidden="true">
          <span className="clas-pos"><Renglon w="w-4" h="h-3" /></span>
          <span className="clas-mono pm-esperando" />
          <span className="clas-nombre">
            {/* Tres anchos alternos: una columna de bloques idénticos se lee
                como una barra de progreso, no como una lista de nombres. */}
            <Renglon w={["w-28", "w-20", "w-24"][i % 3]} h="h-3.5" />
          </span>
          <span className="clas-puntos"><Renglon w="w-8" h="h-3.5" /></span>
        </div>
      ))}
    </div>
  );
}

// Lo que va debajo de TU nombre: cuánto te has movido (si el puesto que trae el
// juego es de este mismo periodo) y a cuántos puntos tienes al de delante. Los
// empatados comparten puesto, así que «el de delante» es el primero con MÁS
// puntos, no la fila de arriba.
function apunteDe(selfRow, jugadores, rank, { t, tn, locale }) {
  if (!selfRow) return null;
  const partes = [];
  let tono = "";
  let icono = null;
  if (rank && rank.rank === selfRow.rank) {
    const mv = rankMovement(rank);
    if (mv.kind === "up") {
      partes.push(tn("parte.up", mv.n));
      tono = "verde";
      icono = I.arrowU;
    } else if (mv.kind === "down") {
      partes.push(tn("parte.down", mv.n));
      tono = "rojo";
      icono = I.arrowD;
    }
  }
  const i = jugadores.indexOf(selfRow);
  let delante = null;
  for (let k = i - 1; k >= 0; k--) {
    if (jugadores[k].totalPoints > selfRow.totalPoints) {
      delante = jugadores[k];
      break;
    }
  }
  if (delante) {
    partes.push(
      tn("parte.distancia", delante.totalPoints - selfRow.totalPoints, {
        pos: ordinal(delante.rank, locale),
      })
    );
  } else if (selfRow.rank === 1) {
    partes.push(t("parte.lider"));
  }
  if (!partes.length) return null;
  // La segunda frase va en minúscula: se lee como una sola línea, no como dos.
  const texto = partes
    .map((p, k) => (k ? p.charAt(0).toLocaleLowerCase(locale) + p.slice(1) : p))
    .join(" · ");
  return { texto, tono, icono };
}

export default function Ranking({
  open,
  onClose,
  user,
  // El puesto del jugador con su movimiento del día (useStats), para el apunte
  // de su fila. Opcional: sin él la fila dice solo la distancia al de delante.
  rank = null,
  onOpenLogin,
  // Puntos de la partida de hoy si se ganó (0 si no). Solo los usa el
  // anónimo: «Hoy has sumado N puntos. Entra para que cuenten» dice lo que
  // pierde por no entrar, y eso convence más que una tabla velada (P27).
  puntosHoy = 0,
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
  // Temporada activa, para la tarjeta (número + tema) y el countdown de cierre.
  // null = sin temporada activa (hueco o aún no configurada) → ranking semanal.
  const [season, setSeason] = useState(null);
  // Rango de la semana actual (para la tarjeta semanal cuando no hay temporada).
  // null = aún cargando o sin datos → la tarjeta no se pinta.
  const [weekRange, setWeekRange] = useState(null);
  // Pestaña activa: la clasificación de la temporada en curso ("temporada"), el
  // SALÓN DE CAMPEONES histórico ("campeones") o LEYENDAS, el acumulado all-time
  // ("leyendas"). Las dos históricas se cargan PEREZOSAS al abrir su pestaña por
  // primera vez (no lastramos la apertura del ranking con fetches que la mayoría
  // no mira).
  const [view, setView] = useState("temporada");
  const [champions, setChampions] = useState({ loading: false, seasons: [], error: "", loaded: false });
  const [legends, setLegends] = useState({ loading: false, players: [], error: "", loaded: false });
  const [helpOpen, setHelpOpen] = useState(false);
  // Reintento manual de la tabla de la temporada. Contador y no callback: `t`
  // cambia de identidad en cada render y meter la carga en un `useCallback`
  // haría refrescar el efecto sin parar.
  const [reintento, setReintento] = useState(0);
  // Modal de perfil público al clicar una fila del ranking. Guardamos el userId
  // del jugador objetivo; null = cerrado.
  const [openProfileId, setOpenProfileId] = useState(null);
  // userId del usuario actual (logueado), si lo hay. Lo usamos para NO hacer
  // clicable su propia fila — ya tiene su perfil privado.
  const currentUserId = user?.id || null;
  // Mi fila dentro del leaderboard cargado, para su apunte (movimiento y
  // distancia al de delante).
  const selfRow = currentUserId
    ? state.players.find((p) => p.userId === currentUserId) || null
    : null;
  const legendsSelf = currentUserId
    ? legends.players.find((p) => p.userId === currentUserId) || null
    : null;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState({ loading: true, players: [], error: "" });
    // Cada apertura arranca en la pestaña de temporada/semanal y descarta el
    // palmarés cacheado (por si se cerró una temporada entre visitas).
    setView("temporada");
    setChampions({ loading: false, seasons: [], error: "", loaded: false });
    setLegends({ loading: false, players: [], error: "", loaded: false });
    setWeekRange(null);

    // El leaderboard del periodo (temporada o semana) y la temporada activa
    // (para la tarjeta) son independientes: los pedimos en paralelo.
    Promise.all([getSeasonLeaderboard(), getCurrentSeason()])
      .then(([players, s]) => {
        if (cancelled) return;
        setSeason(s);
        setState({ loading: false, players, error: "" });
        // Sin temporada activa → pedimos el rango de la semana para la tarjeta.
        // Es un fetch secundario que no bloquea la tabla (ya tiene datos).
        if (!s) {
          getWeekRange()
            .then((wr) => { if (!cancelled) setWeekRange(wr); })
            .catch(() => {});
        }
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
  }, [open, reintento]);

  // El perfil público entra en la condición junto a la ayuda: es otro sub-modal
  // que se monta ENCIMA con su propio listener de Escape, así que sin esto una
  // sola pulsación cerraba el perfil ajeno Y el ranking de debajo.
  useEscape(open && !helpOpen && !openProfileId, onClose);

  // La «atrás» de Android, con la MISMA cadena que el Escape y en el mismo
  // orden: abrir el perfil de otro jugador y pulsar atrás te devuelve a la
  // tabla, no te saca de la clasificación. `ranking` sale del trap global de
  // App.jsx por eso: dos capas empujando entradas fantasma por la misma
  // pulsación es el enredo que documenta ModalShell. Una sola capa, y es esta.
  // true = «he retrocedido un nivel, sigo abierto»; false = cerrado del todo.
  useHistoryChain(open, () => {
    if (helpOpen) {
      setHelpOpen(false);
      return true;
    }
    if (openProfileId) {
      setOpenProfileId(null);
      return true;
    }
    onClose();
    return false;
  });

  // Las dos cargas perezosas, con nombre propio: así el botón de reintento
  // puede volver a llamarlas sin pasar por `selectView`, que solo debe dispararlas
  // la PRIMERA vez que se entra en su pestaña.
  function cargarCampeones() {
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

  function cargarLeyendas() {
    track("legends_view", { source: "ranking" });
    setLegends({ loading: true, players: [], error: "", loaded: false });
    getLeaderboard()
      .then((players) => setLegends({ loading: false, players, error: "", loaded: true }))
      .catch((err) => {
        console.error("[Ranking] fallo cargando el histórico", err);
        setLegends({ loading: false, players: [], error: t("ranking.errorLoad"), loaded: true });
      });
  }

  // Cambio de pestaña. La primera vez que se abre una histórica dispara su
  // fetch (perezoso, una sola vez por apertura del panel).
  function selectView(next) {
    setView(next);
    if (next === "campeones" && !champions.loaded && !champions.loading) cargarCampeones();
    if (next === "leyendas" && !legends.loaded && !legends.loading) cargarLeyendas();
  }

  // Props comunes a todas las filas de la tabla.
  const filaBase = {
    currentUserId,
    clicable: !!user,
    onAbrirPerfil: setOpenProfileId,
  };
  const i18n = { t, tn, locale };

  const pestanas = [
    ["temporada", season ? t("ranking.tabSeason") : t("ranking.tabWeekly")],
    ["campeones", t("ranking.tabChampions")],
    // Leyendas solo para logueados: al anónimo le velamos la propia tabla de la
    // temporada, no vamos a regalarle el acumulado de años.
    ...(user ? [["leyendas", t("ranking.legends")]] : []),
  ];

  const fmtCorta = (iso) => {
    try {
      return new Date(`${iso}T00:00:00`).toLocaleDateString(
        locale === "en" ? "en-US" : "es-ES",
        { day: "numeric", month: "short" }
      );
    } catch {
      return iso;
    }
  };

  return (
    <>
    <Superficie
      open={open}
      onClose={onClose}
      label={t("prensa.clasificacion")}
      // ENCAJE DE MODAL ALTO: los insets van al velo y el panel topa contra su
      // caja con scroll propio (ver `.safe-area-pad` en index.css). Sin tope,
      // en un 360x640 el panel salía más alto que su velo y se recortaba por
      // arriba y por abajo a la vez, X de cerrar incluida.
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-hoja flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-hoja flex items-end justify-center"
      panelWeb="modal-panel-flat panel-seccion w-full max-w-md max-h-full overflow-y-auto overscroll-contain p-5"
    >
        {/* La cabecera: el nombre de la sección en grande, como el de una
            pantalla, y a su lado «cómo se puntúa» y cerrar. */}
        <div className="clas-cab">
          <h2 className="clas-titulo">{t("prensa.clasificacion")}</h2>
          <button
            type="button"
            className="clas-icono-boton"
            onClick={() => setHelpOpen(true)}
            aria-label={t("ranking.helpButtonAria")}
            title={t("ranking.helpButtonAria")}
          >
            <Icon d={I.ayuda} size={22} strokeWidth="1.7" />
          </button>
          <CloseButton onClick={onClose} label={t("common.close")} />
        </div>

        {/* Las pestañas, en segmentado. `aria-pressed` y no el patrón
            role="tablist"/"tab": ese exige paneles con aria-controls y
            navegación por flechas, y aquí son botones que reemplazan el
            contenido. Un patrón ARIA a medias confunde más que no ponerlo. */}
        <div className={`clas-tabs n${pestanas.length}`}>
          {pestanas.map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => selectView(id)}
              aria-pressed={view === id}
              className={"clas-tab" + (view === id ? " activa" : "")}
            >
              {lbl}
            </button>
          ))}
        </div>

        {view === "temporada" && (
        <>
        {season && (
          <TarjetaPeriodo
            kicker={t("ranking.seasonKicker", { n: season.number })}
            titulo={locale === "en" ? season.label_en : season.label_es}
            desde={season.starts_at}
            hasta={season.ends_at}
          />
        )}
        {!season && weekRange && (
          <TarjetaPeriodo
            kicker={t("ranking.weeklyKicker")}
            titulo={`${fmtCorta(weekRange.start)} – ${fmtCorta(weekRange.end)}`}
            desde={weekRange.start}
            hasta={weekRange.end}
          />
        )}

        {/* Logueado pero sin firma: aquí —y solo aquí— el nick significa algo,
            porque sin él no se sale en la tabla (las SQL de temporada filtran
            `display_name IS NOT NULL`). Se ofrece en el sitio donde el jugador
            entiende para qué sirve. */}
        {necesitaNick && (
          <div className="clas-aviso">
            <p className="clas-aviso-texto">{t("ranking.nickPrompt")}</p>
            <button type="button" onClick={onOpenNickname} className="pm-btn">
              {t("ranking.nickCta")}
            </button>
          </div>
        )}

        {state.loading ? (
          <FilasEsperando n={8} texto={t("ranking.loading")} />
        ) : state.error ? (
          <ErrorConSalida texto={state.error} onReintentar={() => setReintento((n) => n + 1)} />
        ) : state.players.length === 0 ? (
          <p className="clas-vacio">{t(season ? "ranking.emptySeason" : "ranking.emptyWeekly")}</p>
        ) : (
          <>
            <Tabla
              jugadores={state.players}
              filaBase={filaBase}
              source="ranking"
              anonimo={!user}
              apunteYo={apunteDe(selfRow, state.players, rank, i18n)}
            />
            {!user && (state.players.length > 3 || puntosHoy > 0) && (
              <div className="clas-aviso">
                <p className="clas-aviso-texto">
                  {puntosHoy > 0 ? tn("ranking.hoySumado", puntosHoy) : t("ranking.loginPrompt")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin?.("ranking");
                  }}
                  className="pm-btn"
                >
                  {t("ranking.loginCta")}
                </button>
              </div>
            )}
          </>
        )}
        </>
        )}

        {/* SALÓN DE CAMPEONES: temporadas cerradas con su podio, una tarjeta
            por temporada. Filas clicables al perfil igual que la temporada. */}
        {view === "campeones" &&
          (champions.loading ? (
            <FilasEsperando n={6} texto={t("ranking.loading")} />
          ) : champions.error ? (
            <ErrorConSalida texto={champions.error} onReintentar={cargarCampeones} />
          ) : champions.seasons.length === 0 ? (
            <p className="clas-vacio">{t("ranking.championsEmpty")}</p>
          ) : (
            <div className="clas-palmares">
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
                  <section key={s.number} className="clas-periodo">
                    <div className="clas-periodo-cab">
                      <span className="clas-kicker">{t("ranking.seasonKicker", { n: s.number })}</span>
                      {when && <span className="clas-cierre">{when}</span>}
                    </div>
                    {label && <p className="clas-periodo-titulo">{label}</p>}
                    <ol className="clas-lista">
                      {s.podium.map((c) => (
                        <li key={c.rank + c.userId}>
                          <Fila
                            {...filaBase}
                            source="champions"
                            pos={c.rank}
                            userId={c.userId}
                            nombre={c.displayName}
                            puntos={c.points}
                          />
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </div>
          ))}

        {/* LEYENDAS: la clasificación histórica all-time (acumulado de
            total_points, que SÍ incluye el bonus de racha), con el mismo podio y
            la misma fila que la temporada. */}
        {view === "leyendas" && (
          <>
            <TarjetaPeriodo kicker={t("ranking.legends")} titulo={t("ranking.legendsSubtitle")} />
            {legends.loading ? (
              <FilasEsperando n={8} texto={t("ranking.loading")} />
            ) : legends.error ? (
              <ErrorConSalida texto={legends.error} onReintentar={cargarLeyendas} />
            ) : legends.players.length === 0 ? (
              <p className="clas-vacio">{t("ranking.empty")}</p>
            ) : (
              <Tabla
                jugadores={legends.players}
                filaBase={filaBase}
                source="legends"
                apunteYo={apunteDe(legendsSelf, legends.players, null, i18n)}
                sub={(p) => t("ranking.bestStreak", { value: p.maxStreak })}
              />
            )}
          </>
        )}
    </Superficie>
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
