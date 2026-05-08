// src/App.jsx
import CarImage from "./components/CarImage";
import AttemptDots from "./components/AttemptDots";
import HintLegend from "./components/HintLegend";
import GuessRow from "./components/GuessRow";
import GuessForm from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import { useGame } from "./hooks/useGame";
import Login from "./components/Login";

export default function App() {
  const {
    car,
    guesses,
    attempts,
    status,
    zoom,
    zoomLabel,
    maxAttempts,
    submitGuess,
    buildShareText,
  } = useGame();

  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <><Login />
    <div className="min-h-screen bg-bg-primary text-white font-body flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-md border-b border-border px-4 py-4 flex justify-between items-end">
        <div>
          <h1 className="font-display text-4xl text-accent tracking-widest leading-none">
            Coche del día
          </h1>
          <p className="text-[10px] tracking-[0.22em] uppercase text-muted mt-1">{today}</p>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl text-accent leading-none">
            {maxAttempts - attempts}
          </div>
          <div className="text-[10px] tracking-widest uppercase text-muted">intentos</div>
        </div>
      </header>

      {/* Main */}
      <main className="w-full max-w-md px-4 pb-10">
        {/* Car image */}
        <CarImage src={car.img} zoom={zoom} zoomLabel={zoomLabel} />

        {/* Attempt dots */}
        <AttemptDots attempts={attempts} max={maxAttempts} />

        {/* Legend */}
        <HintLegend />

        {/* Guess history */}
        {guesses.length > 0 && (
          <div className="flex flex-col gap-2 mt-3 mb-4">
            {guesses.map((g, i) => (
              <GuessRow key={i} guess={g} index={i} />
            ))}
          </div>
        )}

        {/* Divider */}
        {guesses.length > 0 && <div className="h-px bg-border my-4" />}

        {/* Form or Result */}
        {status === "playing" ? (
          <GuessForm onSubmit={submitGuess} disabled={status !== "playing"} />
        ) : (
          <ResultPanel
            status={status}
            car={car}
            attempts={attempts}
            maxAttempts={maxAttempts}
            shareText={buildShareText()} />
        )}
      </main>
    </div></>
  );
}
