import { flagImagePath } from "../data/countries";
import { useT, getLocalizedCountry } from "../i18n";

const STATUS_STYLES = {
  correct: {
    cell: "bg-[#1a2f1a] border-[#2d5a2d]",
    icon: "text-green-400",
    symbol: "✓",
  },
  // "Misma nacionalidad" = tercer estado del juego (ni acierto ni fallo).
  // Cobre cálido: distinto del rojo de fallo, distinto del amarillo de las
  // flechas de año, semánticamente "casi" (warmth = "estuviste cerca").
  // El indicador derecho es la BANDERA (imagen real, JPG en /public/flags),
  // no un glifo de texto — por eso symbol/icon van como null.
  partial: {
    cell: "bg-[#2d1f15] border-[#6a4128]",
    icon: null,
    symbol: null,
  },
  wrong: {
    cell: "bg-[#2a1a1a] border-[#5a2d2d]",
    icon: "text-red-400",
    symbol: "✕",
  },
};

// Mientras esperamos respuesta del servidor pintamos una celda "pending"
// con shimmer diagonal: misma silueta que una celda real (mismo padding,
// mismo borde) pero en gris neutro y sin icono de estado. Da feedback
// instantáneo de que el intento se ha registrado, en lugar de dejar al
// usuario mirando un spinner en el botón sin saber qué está pasando.
const PENDING_STYLE = {
  cell: "bg-bg-tertiary border-border-strong/70 relative overflow-hidden",
};

function YearDirection({ direction }) {
  const { t } = useT();
  if (!direction) return null;

  const isUp = direction === "up";
  const label = isUp ? t("guessRow.yearHigherTitle") : t("guessRow.yearLowerTitle");

  return (
    <span
      className={`
        inline-flex h-6 w-6 shrink-0 items-center justify-center
        rounded-full border bg-[#2d1f15] text-orange-300
        border-[#6a4128]
        sm:h-7 sm:w-7
      `}
      title={label}
      aria-label={label}
    >
      {/* Flecha completa (tallo + cabeza triangular) en vez del chevron
          escueto. La proporción tallo:cabeza ~2:1 + strokeWidth alto le
          da peso visual y la hace inconfundible incluso a 14 px. Colores
          cobre cálido para alinearse con el estado "misma nacionalidad"
          (ambos son hints/pistas, no estados de acierto/fallo). */}
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 sm:h-4 sm:w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isUp ? (
          <path d="M12 20V4m-7 7l7-7 7 7" />
        ) : (
          <path d="M12 4v16m-7-7l7 7 7-7" />
        )}
      </svg>
    </span>
  );
}

function Cell({ label, value, status, pais, direction, isYear, isMarca, pending, revealDelayMs }) {
  const { t } = useT();
  // Marca con status="partial" = misma nacionalidad pero marca incorrecta.
  // El backend SOLO emite "partial" en la celda marca y solo cuando el país
  // coincide (ver api/validate-guess.js).
  //
  // Decisión UX final (post-iteraciones): este es un TERCER ESTADO de juego
  // ("casi"), no un fallo decorado. Patrón Wordle-style:
  //   verde + ✓      = correcto
  //   cobre + bandera = misma nacionalidad
  //   rojo  + ✕      = fallo
  // Una sola señal visual por celda (color + icono), sin chips adicionales.
  const isCountryPartial = isMarca && status === "partial";
  const s = pending ? PENDING_STYLE : STATUS_STYLES[status];
  const flag = pending ? null : s.symbol;
  const showYearDirection = !pending && isYear && status !== "correct";

  // Si revealDelayMs viene definido, esta celda se está revelando ahora:
  // arranca invisible y entra con flip stagger. Si no, animación pop
  // estándar (carga inicial / filas previas).
  const isRevealing = typeof revealDelayMs === "number";
  const animClass = isRevealing ? "animate-flip-reveal" : "animate-pop";
  const animStyle = isRevealing
    ? { animationDelay: `${revealDelayMs}ms`, animationFillMode: "both" }
    : undefined;

  return (
    <div
      className={`
        flex min-w-0 items-center justify-between gap-2
        rounded-md border px-2 py-1 min-h-[30px]
        sm:rounded-lg sm:px-2.5 sm:min-h-[34px]
        ${animClass} ${s.cell}
      `}
      style={{ ...animStyle, transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
      aria-busy={pending || undefined}
      // Etiqueta accesible: al quitar el label VISIBLE de cada celda (para
      // compactar las filas), conservamos el contexto para lectores de
      // pantalla aquí. p.ej. "Marca: Acura".
      aria-label={pending ? undefined : `${label}: ${value || "—"}`}
    >
      {/* Capa de shimmer solo en modo pending: barrido diagonal de luz sobre
          el fondo gris. inset-0 para cubrir la celda, pointer-events-none
          para no robar interacciones. */}
      {pending && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-shimmer"
          style={{
            backgroundImage:
              "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.07) 50%, transparent 65%)",
            backgroundSize: "200% 100%",
          }}
        />
      )}

      {/* Una sola línea: el valor. La etiqueta (MARCA/MODELO/AÑO) ya no se
          repite por fila — vive una vez en la cabecera de columnas, lo que
          recorta ~35-40% de altura por fila. */}
      <span
        className={`
          relative min-w-0 flex-1 truncate font-medium leading-tight
          text-xs sm:text-sm
          ${pending ? "text-muted/80" : "text-white"}
          ${isYear ? "tabular-nums" : ""}
        `}
      >
        {value || "—"}
      </span>

      {/* Indicador a la derecha. items-center del padre lo centra verticalmente. */}
      {pending ? (
        // Tres puntitos pulsando: señal compacta de "esperando" alineada a
        // la derecha donde luego aparecerá el icono real (✓ / ✕).
        <span className="relative flex shrink-0 items-end gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-pulse rounded-full bg-muted/70 [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-muted/70 [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-pulse rounded-full bg-muted/70 [animation-delay:300ms]" />
        </span>
      ) : isYear ? (
        showYearDirection && <YearDirection direction={direction} />
      ) : isCountryPartial && pais ? (
        // Bandera real (JPG en /public/flags) — misma fuente que el Garage.
        // ES el icono del estado (no un add-on), por eso ocupa el mismo slot
        // que ✓/✕ y se voltea con el mismo flip-reveal de la celda. Funciona
        // cross-platform: en Windows los emojis de bandera renderizan como
        // texto "SE/DE" y rompían la lectura — la imagen sí se ve bien
        // siempre. Tooltip explicita "País correcto: Suecia".
        <span
          className="inline-flex shrink-0 overflow-hidden rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
          title={t("guessRow.countryOkTitle", { pais: getLocalizedCountry(pais) })}
        >
          <img
            src={flagImagePath(pais)}
            alt={t("guessRow.countryOkTitle", { pais: getLocalizedCountry(pais) })}
            width={22}
            height={14}
            loading="lazy"
            decoding="async"
            className="block h-3.5 w-[22px] object-cover sm:h-4 sm:w-[26px]"
          />
        </span>
      ) : (
        <span
          className={`
            relative shrink-0 text-sm font-bold leading-none sm:text-base
            ${s.icon}
          `}
          aria-hidden="true"
        >
          {flag}
        </span>
      )}
    </div>
  );
}

// Plantilla de columnas compartida por la cabecera y por cada fila, para que
// las tres columnas (marca / modelo / año) queden perfectamente alineadas.
const GRID_COLS =
  "grid w-full min-w-0 grid-cols-[0.85fr_minmax(0,1fr)_82px] gap-1 sm:grid-cols-[0.9fr_minmax(0,1fr)_96px] sm:gap-1.5";

// Cabecera de columnas: se renderiza UNA vez sobre las filas (no por fila).
// Aquí viven ahora las etiquetas MARCA / MODELO / AÑO que antes se repetían
// en cada celda.
export function GuessRowHeader() {
  const { t } = useT();
  const cls =
    "truncate px-2 text-[10px] uppercase tracking-[0.08em] text-muted sm:text-[11px] sm:tracking-widest";
  return (
    <div className={GRID_COLS} aria-hidden="true">
      <span className={cls}>{t("guess.labelMarca")}</span>
      <span className={cls}>{t("guess.labelModelo")}</span>
      <span className={cls}>{t("guess.labelAnio")}</span>
    </div>
  );
}

export default function GuessRow({ guess, index, pending = false, justRevealed = false }) {
  const { t } = useT();

  // Stagger entre celdas al revelar: marca primero, luego modelo, luego
  // año. 160 ms da una cadencia legible y pausada sin alargar en exceso la
  // espera percibida (en sync con el FLIP_STAGGER_MS del layout configurator).
  const REVEAL_STAGGER_MS = 160;
  const cellDelay = (i) => (justRevealed ? i * REVEAL_STAGGER_MS : undefined);

  // Filas previas siguen entrando con slide-up. Al revelar, no animamos
  // el contenedor (la animación per-celda ya da el efecto) para que las
  // celdas no entren "movidas" además de "volteadas".
  const containerAnim = pending || justRevealed ? "" : "animate-slide-up";
  const containerStyle =
    pending || justRevealed
      ? undefined
      : { animationDelay: `${index * 60}ms`, animationFillMode: "both" };

  return (
    <div
      className={`${GRID_COLS} ${containerAnim}`}
      style={{ ...containerStyle, perspective: "600px" }}
    >
      <Cell
        label={t("guess.labelMarca")}
        value={guess.marca?.val}
        status={guess.marca?.status}
        pais={guess.marca?.pais}
        isMarca
        pending={pending}
        revealDelayMs={cellDelay(0)}
      />
      <Cell
        label={t("guess.labelModelo")}
        value={guess.modelo?.val}
        status={guess.modelo?.status}
        pending={pending}
        revealDelayMs={cellDelay(1)}
      />
      <Cell
        isYear
        label={t("guess.labelAnio")}
        value={guess.anio?.val}
        status={guess.anio?.status}
        direction={guess.anio?.direction}
        pending={pending}
        revealDelayMs={cellDelay(2)}
      />
    </div>
  );
}
