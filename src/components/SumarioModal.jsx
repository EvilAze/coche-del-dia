// src/components/SumarioModal.jsx
// EL SUMARIO: el índice del ejemplar, en un diálogo centrado.
//
// DE DÓNDE VIENE. Antes esto era un desplegable colgado de la esquina superior
// izquierda (.prensa-menu): cinco renglones idénticos —Archivo, Perfil, Cómo se
// juega, el tema y la privacidad— dentro de una caja de 234px. Tres problemas
// que no se arreglaban moviendo píxeles:
//
//   1. MEZCLABA DOS COSAS. Navegar a una sección (el Archivo, tu perfil) y
//      cambiar un ajuste del ejemplar (la tinta) son gestos distintos, y ahí se
//      leían iguales. Peor: elegir el tema CERRABA el menú, así que el jugador
//      no veía el resultado de lo que acababa de elegir.
//   2. EL ANCLAJE ERA DE ESCRITORIO. Un popover pegado arriba a la izquierda
//      cae justo donde el pulgar no llega, y en móvil se abría ENCIMA de la
//      fotografía, que es el juego.
//   3. NO DECÍA NADA DE TI. Cinco palabras sueltas: ni tu puesto, ni tu racha,
//      ni si habías iniciado sesión.
//
// QUÉ ES AHORA. Un sumario de periódico de verdad, en dos bloques:
//   · LAS SECCIONES, como cuatro portadillas en rejilla (icono + nombre +
//     apunte). Bloques grandes, con sitio para decir qué hay dentro y para que
//     el dedo no falle — y con el dato del jugador en el apunte (tu ordinal en
//     oro, tu racha), que es lo que convierte una lista en un panel.
//   · EL EJEMPLAR: los ajustes que NO navegan a ningún sitio (la tinta y el
//     idioma) con su control al lado. Se cambian aquí dentro, viendo el efecto,
//     sin que el sumario se cierre.
//
// UNA SOLA PIEZA PARA WEB Y APP, a propósito: el catálogo de opciones es el
// mismo en las dos y un menú que se comporta distinto en cada una es un menú que
// hay que aprender dos veces. Va sobre ModalShell —el mismo chasis que el resto
// de modales del juego, también dentro del APK— así que hereda foco, trampa de
// tabulador, bloqueo de scroll y, en la app, el «atrás» de Android (lo cubre el
// useHistoryClose único de App.jsx, porque esto es un modal más del slot).
//
// La privacidad vive aquí por lo que pasa en la app: allí el pliego no scrollea
// (shell fijo) y el pie queda fuera de la pantalla, así que un enlace que solo
// existiera abajo sería inalcanzable — y Play exige que la política se alcance
// desde dentro. En web sigue además en el pie, igual que «Cómo se juega».

import { useT } from "../i18n";
import { useTheme } from "../lib/theme";
import { useEscape } from "../hooks/useEscape";
import { haptic } from "../lib/haptics";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";
import LanguageStrip from "./LanguageStrip";
import { Icon, I } from "./configurator/icons";
import { ordinal } from "./PuestoCifra";

// Una portadilla del sumario: icono de línea, nombre de la sección en
// versalitas y el apunte que dice qué hay dentro (o qué llevas tú dentro).
// SIN `aria-label` propio a propósito: el nombre accesible del botón sale de lo
// que se lee dentro («Clasificación, 12º de la temporada»), así que coincide con
// lo que el jugador ve y con lo que diría en voz alta al pedirlo por voz. Un
// aria-label a mano lo habría sustituido por otra frase.
function Portadilla({ icono, nombre, apunte, aviso = false, onClick }) {
  return (
    <button
      type="button"
      className="prensa-portadilla focus-ring"
      onClick={() => {
        haptic.impactLight();
        onClick?.();
      }}
    >
      <span className="marca">
        <Icon d={icono} size={20} />
      </span>
      <span className="nombre">
        {nombre}
        {/* La corrección al margen, igual que en la barra: "(1)" en rojo. */}
        {aviso && <span className="aviso" aria-hidden="true">(1)</span>}
      </span>
      <span className="apunte">{apunte}</span>
    </button>
  );
}

export default function SumarioModal({
  open,
  onClose,
  user,
  rank = null,
  rankCargando = false,
  streak = 0,
  repescaAlert = false,
  onOpenGarage,
  onOpenRanking,
  onOpenProfile,
  onOpenLogin,
  onOpenHowTo,
}) {
  const { t, tn, locale } = useT();
  const { tema, setTheme } = useTheme();
  useEscape(open, onClose);

  // El puesto solo existe con cuenta real: un anónimo no tiene fila en la tabla.
  // Mientras `rankCargando`, el apunte se queda en el genérico: preferimos no
  // decir nada a prometer «únete a la tabla» a quien ya está en ella.
  const puesto = user && rank ? rank.rank : null;

  function elegirTinta(destino) {
    haptic.selection();
    setTheme(destino);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("sumario.titulo")}
      // z POR DEBAJO de los modales a los que lleva (80 el ranking y el perfil,
      // 85 el Archivo): el sumario es el lanzador, así que cuando el jugador
      // elige una sección tiene que salir POR DEBAJO de la que entra. Con un z
      // mayor, su velo al 72% se quedaba 220 ms encima del panel nuevo — un
      // fogonazo oscuro justo al aterrizar.
      backdropClassName="modal-scrim fixed inset-0 z-[78] flex items-center justify-center px-4 py-4"
      panelClassName="modal-panel-flat w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pm-kicker">{t("sumario.kicker")}</p>
          <h2 className="pm-title mt-1">{t("sumario.titulo")}</h2>
        </div>
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      {/* LAS SECCIONES. Cuatro y solo cuatro: la rejilla de 2×2 es lo que hace
          que se lean de un vistazo, y la quinta entrada obligaría a una fila
          coja. Los Logros se llegan desde el perfil y el Archivo, que es donde
          significan algo. */}
      <div className="prensa-sumario-rejilla">
        <Portadilla
          icono={I.garage}
          nombre={t("prensa.garaje")}
          aviso={repescaAlert}
          apunte={repescaAlert ? t("sumario.garajeRepesca") : t("sumario.garajeApunte")}
          onClick={onOpenGarage}
        />

        <Portadilla
          icono={I.trophy}
          nombre={t("prensa.clasificacion")}
          apunte={
            puesto != null && !rankCargando ? (
              <>
                <span className="oro">{ordinal(puesto, locale)}</span>{" "}
                {t("sumario.clasificacionPuesto")}
              </>
            ) : (
              t("sumario.clasificacionApunte")
            )
          }
          // "sumario" como origen: el panel de analítica necesita distinguir
          // esta puerta de la de la barra ("cabecera") y la del final de partida.
          onClick={() => onOpenRanking?.("sumario")}
        />

        <Portadilla
          icono={I.user}
          nombre={user ? t("prensa.perfil") : t("prensa.entrar")}
          apunte={
            user
              ? streak > 0
                ? tn("sumario.perfilRacha", streak, { count: streak })
                : t("sumario.perfilApunte")
              : t("sumario.entrarApunte")
          }
          onClick={user ? onOpenProfile : onOpenLogin}
        />

        <Portadilla
          icono={I.help}
          nombre={t("cdd.helpAria")}
          apunte={t("sumario.comoApunte")}
          onClick={onOpenHowTo}
        />
      </div>

      {/* EL EJEMPLAR: lo que se ajusta, no lo que se visita. Ninguno de estos
          dos controles cierra el sumario — se eligen viendo el efecto. */}
      <p className="prensa-ladillo mb-2.5 mt-5">{t("sumario.ejemplar")}</p>

      <div className="prensa-sumario-ajustes">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[9px] uppercase tracking-widest text-muted">
            {t("sumario.tinta")}
          </span>
          {/* Conmutador de DOS estados explícitos en vez del botón «cambiar a
              edición de noche» de antes: con un solo botón, el jugador tenía que
              deducir en qué tinta estaba leyendo a partir del nombre de la otra.
              El chip del sistema (pm-chip), el mismo del idioma y de los filtros
              del Archivo. */}
          <div className="flex gap-1">
            <button
              type="button"
              className={`focus-ring pm-chip ${tema === "dia" ? "on" : ""}`}
              aria-pressed={tema === "dia"}
              onClick={() => elegirTinta("dia")}
            >
              {t("sumario.tintaDia")}
            </button>
            <button
              type="button"
              className={`focus-ring pm-chip ${tema === "noche" ? "on" : ""}`}
              aria-pressed={tema === "noche"}
              onClick={() => elegirTinta("noche")}
            >
              {t("sumario.tintaNoche")}
            </button>
          </div>
        </div>

        {/* La ÚNICA superficie de idioma del juego, reutilizada tal cual (vive
            también en el perfil y en el login). Aquí es donde la busca quien no
            ha iniciado sesión. */}
        <LanguageStrip />
      </div>

      <div className="prensa-sumario-pie">
        <a href="/privacidad" onClick={() => haptic.impactLight()}>
          {t("app.footerPrivacy")}
        </a>
      </div>
    </ModalShell>
  );
}
