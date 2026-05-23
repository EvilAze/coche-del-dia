import { COUNTRY_FLAGS } from "../data/countries";
import { useT, getLocalizedCountry } from "../i18n";

const STATUS_STYLES = {
  correct: {
    cell: "bg-[#1a2f1a] border-[#2d5a2d]",
    icon: "text-green-400",
    symbol: "✓",
  },
  partial: {
    cell: "bg-[#2a2318] border-[#5a4a1d]",
    icon: "text-yellow-400",
    symbol: "≈",
  },
  country: {
    cell: "bg-[#142532] border-[#2f6f95]",
    icon: "text-sky-300",
    symbol: "🌍",
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
        rounded-full border bg-yellow-500/15 text-yellow-300
        border-yellow-500/40
        sm:h-7 sm:w-7
      `}
      title={label}
      aria-label={label}
    >
      {/* SVG chevron en lugar del unicode ↑/↓ para que se vea grueso y
          nítido a cualquier tamaño. strokeWidth alto para que destaque
          incluso en la versión móvil (h-6). */}
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
        {isUp ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </span>
  );
}

function Cell({ label, value, status, pais, direction, isYear, isMarca, pending, revealDelayMs }) {
  const { t } = useT();
  const isCountryPartial = isMarca && status === "partial";
  const s = pending
    ? PENDING_STYLE
    : isCountryPartial
    ? STATUS_STYLES.country
    : STATUS_STYLES[status];
  const flag = pending
    ? null
    : isCountryPartial
    ? COUNTRY_FLAGS[pais] || s.symbol
    : s.symbol;
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
        rounded-md border px-2 py-1.5 min-h-[36px]
        sm:rounded-lg sm:px-2.5 sm:py-2 sm:min-h-[42px]
        ${animClass} ${s.cell}
      `}
      style={{ ...animStyle, transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
      aria-busy={pending || undefined}
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

      {/* Bloque de texto a la izquierda: label arriba, valor justo debajo. */}
      <div className="relative min-w-0 overflow-hidden">
        <span
          className="
            mb-0.5 block truncate text-[10px] uppercase tracking-[0.08em] text-muted
            sm:text-[11px] sm:tracking-widest
          "
        >
          {isCountryPartial ? t("guessRow.countryOk") : label}
        </span>

        <span
          className={`
            block truncate font-medium leading-tight
            text-xs sm:text-sm
            ${pending ? "text-muted/80" : "text-white"}
            ${isYear ? "tabular-nums" : ""}
          `}
        >
          {value || "—"}
        </span>
      </div>

      {/* Indicador a la derecha. items-center del padre lo centra verticalmente. */}
      {pending ? (
        // Tres puntitos pulsando: señal compacta de "esperando" alineada a
        // la derecha donde luego aparecerá el icono real (✓/≈/🌍/✕).
        <span className="relative flex shrink-0 items-end gap-0.5" aria-hidden="true">
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted/70 [animation-delay:0ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted/70 [animation-delay:150ms]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-muted/70 [animation-delay:300ms]" />
        </span>
      ) : isYear ? (
        showYearDirection && <YearDirection direction={direction} />
      ) : (
        <span
          className={`
            relative shrink-0 text-sm font-bold leading-none sm:text-base
            ${s.icon}
          `}
          title={isCountryPartial && pais ? t("guessRow.countryOkTitle", { pais: getLocalizedCountry(pais) }) : undefined}
          aria-hidden="true"
        >
          {flag}
        </span>
      )}
    </div>
  );
}

export default function GuessRow({ guess, index, pending = false, justRevealed = false }) {
  const { t } = useT();

  // Stagger entre celdas al revelar: marca primero, luego modelo, luego
  // año. 140 ms da una cadencia legible sin alargar la espera percibida.
  const REVEAL_STAGGER_MS = 140;
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
      className={`
        grid w-full min-w-0 grid-cols-[0.85fr_minmax(0,1fr)_82px]
        gap-1 ${containerAnim}
        sm:grid-cols-[0.9fr_minmax(0,1fr)_96px] sm:gap-1.5
      `}
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
