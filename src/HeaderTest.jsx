// src/HeaderTest.jsx
// Sala de pruebas SOLO para iterar visualmente el nuevo header.
// Acceso: /?header-test  o  /header-test
// Renderiza HeaderSandwich en varios estados sin depender del catálogo.

import { useState } from "react";
import HeaderSandwich from "./components/HeaderSandwich";
import GuessRow from "./components/GuessRow";

const STATES = [
  { label: "Logueado · racha 7 · repesca activa", user: { id: "1" }, streak: 7, repescaAlert: true },
  { label: "Logueado · racha 1", user: { id: "1" }, streak: 1, repescaAlert: false },
  { label: "Logueado · sin racha", user: { id: "1" }, streak: 0, repescaAlert: false },
  { label: "Logueado · racha 42 · repesca", user: { id: "1" }, streak: 42, repescaAlert: true },
  { label: "Anónimo (sin sesión)", user: null, streak: 0, repescaAlert: false },
];

function noop(name) {
  return () => alert(`[mock] ${name}`);
}

// Mocks de guesses para verificar visualmente YearDirection en sus dos
// estados (mayor / menor). Si está acertado, no se pinta flecha.
const GUESS_MOCKS = [
  {
    marca: { val: "Ford", status: "correct" },
    modelo: { val: "Focus", status: "correct" },
    anio: { val: "1995", status: "wrong", direction: "up" },
  },
  {
    marca: { val: "Ford", status: "correct" },
    modelo: { val: "Focus", status: "correct" },
    anio: { val: "2020", status: "wrong", direction: "down" },
  },
  {
    marca: { val: "Ford", status: "correct" },
    modelo: { val: "Focus", status: "correct" },
    anio: { val: "2010", status: "partial", direction: "up" },
  },
];

function GuessRowPreview() {
  return (
    <div className="mt-8 space-y-2">
      <p className="mb-2 text-xs uppercase tracking-widest text-muted">
        Preview · flechas de año en resultados
      </p>
      {GUESS_MOCKS.map((g, i) => (
        <GuessRow key={i} guess={g} index={i} />
      ))}
    </div>
  );
}

export default function HeaderTest() {
  const [idx, setIdx] = useState(0);
  const s = STATES[idx];

  return (
    <div className="min-h-screen bg-bg-primary font-body text-white">
      <HeaderSandwich
        user={s.user}
        streak={s.streak}
        repescaAlert={s.repescaAlert}
        onOpenRanking={noop("Ranking")}
        onOpenGarage={noop("Garaje")}
        onOpenProfile={noop("Perfil")}
        onOpenLogin={noop("Login")}
      />

      <main className="mx-auto max-w-md px-4 py-10">
        <h2 className="mb-3 font-display text-2xl tracking-widest text-accent">
          HEADER TEST
        </h2>
        <p className="mb-6 text-sm text-muted">
          Escenarios para iterar el nuevo header. Cambia entre estados y
          prueba el sandwich. Los botones internos hacen alert().
        </p>

        <div className="flex flex-col gap-2">
          {STATES.map((st, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                i === idx
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.05]"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="mt-8 h-40 rounded-lg border border-white/5 bg-white/[0.02] p-4 text-xs text-muted">
          Espacio para comprobar que el dropdown se monta encima del
          contenido inferior con z-index suficiente.
        </div>

        <GuessRowPreview />
      </main>
    </div>
  );
}
