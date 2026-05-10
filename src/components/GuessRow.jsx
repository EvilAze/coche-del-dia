const COUNTRY_FLAGS = {
  Japón: "🇯🇵",
  Alemania: "🇩🇪",
  Italia: "🇮🇹",
  "EE.UU.": "🇺🇸",
  Francia: "🇫🇷",
  "Reino Unido": "🇬🇧",
  "Corea del Sur": "🇰🇷",
  Suecia: "🇸🇪",
  España: "🇪🇸",
  Austria: "🇦🇹",
  Croacia: "🇭🇷",
  Rumanía: "🇷🇴",
  Rusia: "🇷🇺",
  "República Checa": "🇨🇿",
  "Países Bajos": "🇳🇱",
};

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

function Cell({ label, value, status, pais }) {
  const isCountryPartial = label === "Marca" && status === "partial";
  const s = isCountryPartial ? STATUS_STYLES.country : STATUS_STYLES[status];
  const flag = isCountryPartial ? COUNTRY_FLAGS[pais] || s.symbol : s.symbol;

  return (
    <div
      className={`
        flex min-w-0 items-center gap-1 rounded-md border
        px-1.5 py-1.5 min-h-[34px]
        sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-2 sm:min-h-[38px]
        animate-pop ${s.cell}
      `}
    >
      <span
        className={`
          shrink-0 text-xs font-bold leading-none
          sm:text-base
          ${s.icon}
        `}
        title={isCountryPartial && pais ? `País correcto: ${pais}` : undefined}
      >
        {flag}
      </span>

      <div className="min-w-0 overflow-hidden">
        <span
          className="
            mb-0.5 block truncate text-[8px] uppercase tracking-[0.08em] text-muted
            sm:text-[10px] sm:tracking-widest
          "
        >
          {isCountryPartial ? "País ok" : label}
        </span>

        <span
          className="
            block truncate text-[10px] font-medium leading-tight text-white
            sm:text-xs
          "
        >
          {value}
        </span>
      </div>
    </div>
  );
}

export default function GuessRow({ guess, index }) {
  return (
    <div
      className="
        grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_64px]
        gap-1 animate-slide-up
        sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_76px] sm:gap-1.5
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
      <Cell label="Año" value={guess.anio.val} status={guess.anio.status} />
    </div>
  );
}



