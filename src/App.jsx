import CarImage from "./components/CarImage";
import AttemptDots from "./components/AttemptDots";
import HintLegend from "./components/HintLegend";
import GuessRow from "./components/GuessRow";
import GuessForm from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import Header from "./components/Header";
import { useGame } from "./hooks/useGame";

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
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-bg-primary text-white font-body">
      <Header />

      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-3 pb-10 sm:px-4">
        <div className="w-full min-w-0 py-2">
        </div>

        <header className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b border-border py-4">
          <div className="min-w-0">
            <h1 className="font-display text-[1.8rem] leading-none tracking-[0.12em] text-accent min-[380px]:text-4xl min-[380px]:tracking-widest">
              Coche del Día
            </h1>
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-muted">
              {today}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-display text-2xl leading-none text-accent">
              {maxAttempts - attempts}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted">
              intentos
            </div>
          </div>
        </header>

        <main className="w-full min-w-0">
          <CarImage src={car.img} zoom={zoom} zoomLabel={zoomLabel} />

          <AttemptDots attempts={attempts} max={maxAttempts} />

          <HintLegend />

          {guesses.length > 0 && (
            <div className="mt-3 mb-4 flex w-full min-w-0 flex-col gap-2">
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} index={i} />
              ))}
            </div>
          )}

          {guesses.length > 0 && <div className="my-4 h-px bg-border" />}

          {status === "playing" ? (
            <GuessForm onSubmit={submitGuess} disabled={status !== "playing"} />
          ) : (
            <ResultPanel
              status={status}
              car={car}
              attempts={attempts}
              maxAttempts={maxAttempts}
              shareText={buildShareText()}
            />
          )}
        </main>
      </div>
    </div>
  );
}