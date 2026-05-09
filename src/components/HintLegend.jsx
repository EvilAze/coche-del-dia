export default function HintLegend() {
  return (
    <div className="my-3 flex w-full min-w-0 flex-wrap justify-center gap-x-3 gap-y-2 px-1 text-[10px] uppercase tracking-wider text-muted sm:text-[11px]">
      <span className="whitespace-nowrap">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-green-400" />
        Correcto
      </span>

      <span className="whitespace-nowrap">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-400" />
        Incorrecto
      </span>

      <span className="whitespace-nowrap">
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-400" />
        País correcto
      </span>
    </div>
  );
}

