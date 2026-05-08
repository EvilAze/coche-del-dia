// src/hooks/useGame.js
import { useState, useEffect } from "react";
import { getCarOfDay } from "../data/cars";

const MAX_ATTEMPTS = 5;
const ZOOM_LEVELS = [2.8, 2.2, 1.7, 1.3, 1.0];
const ZOOM_LABELS = [
  "🔍 Muy cerca",
  "🔍 Cerca",
  "🔎 Alejándose",
  "🔭 Más lejos",
  "🖼 Vista completa",
];

// Tolerancias del año
const ANIO_CORRECT_MARGIN = 2; // ±2 años → verde (acierto total)
const ANIO_PARTIAL_MARGIN = 5; // ±3–5 años → amarillo (cerca)

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  try {
    const raw = localStorage.getItem("cocheDia_state");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.date !== getTodayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem("cocheDia_state", JSON.stringify({ ...state, date: getTodayKey() }));
  } catch {}
}

export function useGame() {
  const car = getCarOfDay();

  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing"); // 'playing' | 'won' | 'lost'

  // Restore from localStorage on mount
  useEffect(() => {
    const saved = loadState();
    if (saved) {
      setGuesses(saved.guesses || []);
      setStatus(saved.status || "playing");
    }
  }, []);

  const attempts = guesses.length;
  const zoomIndex =
    status === "won" ? ZOOM_LEVELS.length - 1 : Math.min(attempts, ZOOM_LEVELS.length - 1);
  const zoom = status === "won" ? 1 : ZOOM_LEVELS[zoomIndex];
  const zoomLabel = ZOOM_LABELS[zoomIndex];

  function checkGuess(marca, modelo, anio) {
    const anioNum = parseInt(anio);
    const diff = Math.abs(anioNum - car.anio);
    const marcaOk = marca.trim().toLowerCase() === car.marca.toLowerCase();
    const modeloOk = modelo.trim().toLowerCase() === car.modelo.toLowerCase();
    const anioCorrect = diff <= ANIO_CORRECT_MARGIN; // ±2 → verde
    const anioPartial = diff <= ANIO_PARTIAL_MARGIN; // ±3–5 → amarillo

    return {
      marca: { val: marca, status: marcaOk ? "correct" : "wrong" },
      modelo: { val: modelo, status: modeloOk ? "correct" : "wrong" },
      anio: {
        val: anio,
        status: anioCorrect ? "correct" : anioPartial ? "partial" : "wrong",
      },
      win: marcaOk && modeloOk && anioCorrect,
    };
  }

  function submitGuess(marca, modelo, anio) {
    if (status !== "playing") return;
    const result = checkGuess(marca, modelo, anio);
    const newGuesses = [...guesses, result];
    let newStatus = "playing";
    if (result.win) newStatus = "won";
    else if (newGuesses.length >= MAX_ATTEMPTS) newStatus = "lost";

    setGuesses(newGuesses);
    setStatus(newStatus);
    saveState({ guesses: newGuesses, status: newStatus });
    return result;
  }

  function buildShareText() {
    const webUrl = "https://carguessr.org";

  const lines = guesses.map((g) => {
    const m = g.marca.status === "correct" ? "✅" : "❌";
    const mo = g.modelo.status === "correct" ? "✅" : "❌";
    const a = g.anio.status === "correct" ? "✅" : "❌";
    return m + mo + a;
  });

  const baseText = `🚗 Coche del Día\n${getTodayKey()}\n${attempts}/${MAX_ATTEMPTS}\n\n${lines.join("\n")}`;

  if (status === "won") {
    return `${baseText}\n\nJuega tú también: ${webUrl}`;
  }

  return baseText;
}

  return {
    car,
    guesses,
    attempts,
    status,
    zoom,
    zoomLabel,
    maxAttempts: MAX_ATTEMPTS,
    submitGuess,
    buildShareText,
  };
}
