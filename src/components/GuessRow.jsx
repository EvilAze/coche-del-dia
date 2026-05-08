// src/components/GuessRow.jsx

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
    symbol: "✗",
  },
};

function Cell({ label, value, status }) {
  const s = STATUS_STYLES[status];
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 border text-sm min-h-[38px] animate-pop ${s.cell}`}
    >
      <span className={`text-base flex-shrink-0 font-bold ${s.icon}`}>{s.symbol}</span>
      <div className="overflow-hidden">
        <span className="block text-[10px] tracking-widest uppercase text-muted mb-0.5">
          {label}
        </span>
        <span className="block text-white font-medium text-xs truncate">{value}</span>
      </div>
    </div>
  );
}

export default function GuessRow({ guess, index }) {
  return (
    <div
      className="grid gap-1.5 animate-slide-up"
      style={{
        gridTemplateColumns: "1fr 1fr 76px",
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
