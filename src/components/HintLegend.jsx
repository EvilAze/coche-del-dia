// src/components/HintLegend.jsx

const items = [
  { color: "bg-green-400", label: "Correcto" },
  { color: "bg-red-400", label: "Incorrecto" },
  { color: "bg-yellow-400", label: "Año cerca (±3)" },
];

export default function HintLegend() {
  return (
    <div className="flex justify-center gap-5 py-2">
      {items.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${color}`} />
          <span className="text-[10px] tracking-widest uppercase text-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}
