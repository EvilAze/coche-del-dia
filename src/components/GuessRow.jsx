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
  wrong: {
    cell: "bg-[#2a1a1a] border-[#5a2d2d]",
    icon: "text-red-400",
    symbol: "✕",
  },
};

function Cell({ label, value, status }) {
  const s = STATUS_STYLES[status];

  return (
    <div
      className={`flex min-h-[38px] min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-sm animate-pop ${s.cell}`}
    >
      <span className={`shrink-0 text-base font-bold ${s.icon}`}>{s.symbol}</span>

      <div className="min-w-0 overflow-hidden">
        <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-muted">
          {label}
        </span>
        <span className="block truncate text-xs font-medium text-white">
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
        grid w-full min-w-0 grid-cols-1 gap-1.5 animate-slide-up
        sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_76px]
      "
      style={{
        animationDelay: `${index * 60}ms`,
        animationFillMode: "both",
      }}
    >
      <Cell label="Marca" value={guess.marca.val} status={guess.marca.status} />
      <Cell label="Modelo" value={guess.modelo.val} status={guess.modelo.status} />
      <Cell label="Año" value={guess.anio.val} status={guess.anio.status} />
    </div>
  );
}
