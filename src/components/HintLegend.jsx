import { useT } from "../i18n";

// Leyenda sincronizada con los símbolos reales que aparecen en GuessRow:
// ✓ correcto · 🌍 país correcto (marca distinta) · ✕ incorrecto.
export default function HintLegend() {
  const { t } = useT();
  const items = [
    { symbol: "✓", label: t("legend.correct"), color: "text-green-400", bg: "bg-[#1a2f1a] border-[#2d5a2d]" },
    { symbol: "🌍", label: t("legend.country"), color: "text-sky-300", bg: "bg-[#142532] border-[#2f6f95]" },
    { symbol: "✕", label: t("legend.wrong"), color: "text-red-400", bg: "bg-[#2a1a1a] border-[#5a2d2d]" },
  ];
  return (
    <div className="my-3 flex w-full min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-2 px-1">
      {items.map((item) => (
        <span
          key={item.label}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] uppercase tracking-wider text-muted"
        >
          <span
            className={`
              inline-flex h-5 w-5 items-center justify-center rounded
              border text-[11px] leading-none ${item.bg} ${item.color}
            `}
            aria-hidden="true"
          >
            {item.symbol}
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}
