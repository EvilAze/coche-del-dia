import { COUNTRY_FLAGS } from "../data/countries";

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

function YearDirection({ direction }) {
  if (!direction) return null;

  const isUp = direction === "up";

  return (
    <span
      className={`
        inline-flex h-6 w-6 shrink-0 items-center justify-center
        rounded-full border bg-yellow-500/15 text-yellow-300
        border-yellow-500/40
        sm:h-7 sm:w-7
      `}
      title={isUp ? "El año correcto es mayor" : "El año correcto es menor"}
      aria-label={isUp ? "El año correcto es mayor" : "El año correcto es menor"}
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

function Cell({ label, value, status, pais, direction }) {
  const isYear = label === "Año";
  const isCountryPartial = label === "Marca" && status === "partial";
  const s = isCountryPartial ? STATUS_STYLES.country : STATUS_STYLES[status];
  const flag = isCountryPartial ? COUNTRY_FLAGS[pais] || s.symbol : s.symbol;
  const showYearDirection = isYear && status !== "correct";

  return (
    <div
      className={`
        flex min-w-0 items-center justify-between gap-2
        rounded-md border px-2 py-1.5 min-h-[36px]
        sm:rounded-lg sm:px-2.5 sm:py-2 sm:min-h-[42px]
        animate-pop ${s.cell}
      `}
    >
      {/* Bloque de texto a la izquierda: label arriba, valor justo debajo. */}
      <div className="min-w-0 overflow-hidden">
        <span
          className="
            mb-0.5 block truncate text-[10px] uppercase tracking-[0.08em] text-muted
            sm:text-[11px] sm:tracking-widest
          "
        >
          {isCountryPartial ? "País ok" : label}
        </span>

        <span
          className={`
            block truncate font-medium leading-tight text-white
            text-xs sm:text-sm
            ${isYear ? "tabular-nums" : ""}
          `}
        >
          {value}
        </span>
      </div>

      {/* Indicador a la derecha. items-center del padre lo centra verticalmente. */}
      {isYear ? (
        showYearDirection && <YearDirection direction={direction} />
      ) : (
        <span
          className={`
            shrink-0 text-sm font-bold leading-none sm:text-base
            ${s.icon}
          `}
          title={isCountryPartial && pais ? `País correcto: ${pais}` : undefined}
          aria-hidden="true"
        >
          {flag}
        </span>
      )}
    </div>
  );
}

export default function GuessRow({ guess, index }) {
  return (
    <div
      className="
        grid w-full min-w-0 grid-cols-[0.85fr_minmax(0,1fr)_82px]
        gap-1 animate-slide-up
        sm:grid-cols-[0.9fr_minmax(0,1fr)_96px] sm:gap-1.5
      "
      style={{
        animationDelay: `${index * 60}ms`,
        animationFillMode: "both",
      }}
    >
      <Cell
        label="Marca"
        value={guess.marca.val}
        status={guess.marca.status}
        pais={guess.marca.pais}
      />
      <Cell label="Modelo" value={guess.modelo.val} status={guess.modelo.status} />
      <Cell
        label="Año"
        value={guess.anio.val}
        status={guess.anio.status}
        direction={guess.anio.direction}
      />
    </div>
  );
}