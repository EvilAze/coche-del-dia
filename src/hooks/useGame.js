import { useState, useEffect } from "react";
import { recordWin } from "./useStats";

const MAX_ATTEMPTS = 5;
const ZOOM_LEVELS = [3.0, 2.7, 2.2, 1.5, 1.0];
const ZOOM_LABELS = [
  "🔍 Muy cerca",
  "🔍 Cerca",
  "🔎 Alejándose",
  "🔭 Más lejos",
  "🖼 Vista completa",
];

function getTodayKey() {
  const options = { timeZone: "Europe/Madrid", year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); 
  return formatter.format(new Date()); 
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
  const [car, setCar] = useState(null); 
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");

  useEffect(() => {
    const saved = loadState();

    // 1. Pedir la foto de hoy a la API invisible
    fetch('/api/get-daily-car')
      .then((res) => res.json())
      .then((data) => {
        if (saved) {
          setGuesses(saved.guesses || []);
          setStatus(saved.status || "playing");
          // Si ya había terminado, guardamos el coche completo. Si no, solo el ID y la foto.
          setCar(saved.carData || data);
        } else {
          setCar(data);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error cargando el coche:", err);
        setIsLoading(false);
      });
  }, []);

  const attempts = guesses.length;
  const zoomIndex = status === "won" ? ZOOM_LEVELS.length - 1 : Math.min(attempts, ZOOM_LEVELS.length - 1);
  const zoom = status === "won" ? 1 : ZOOM_LEVELS[zoomIndex];
  const zoomLabel = ZOOM_LABELS[zoomIndex];

  // 2. Comprobar la respuesta en el servidor (Asíncrono)
  async function submitGuess(marca, modelo, anio) {
    if (status !== "playing" || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/check-guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guess: { marca, modelo, anio },
          carId: car.id,
          attemptNumber: attempts + 1
        })
      });

      const data = await response.json();
      const { result, carData } = data;

      const newGuesses = [...guesses, result];
      let newStatus = "playing";

      if (result.win) newStatus = "won";
      else if (newGuesses.length >= MAX_ATTEMPTS) newStatus = "lost";

      setGuesses(newGuesses);
      setStatus(newStatus);

      // Si ha ganado o perdido, guardamos la info real para mostrarla en ResultPanel
      if (carData) {
        setCar(carData);
      }

      saveState({ 
        guesses: newGuesses, 
        status: newStatus, 
        carData: carData || null 
      });
      
      if (result.win) recordWin().catch(console.error);

    } catch (error) {
      console.error("Error al comprobar:", error);
      alert("Hubo un error de conexión, inténtalo de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildShareText() {
    const webUrl = "https://carguessr.org";
    const [year, month, day] = getTodayKey().split("-");
    const shareDate = `${day}/${month}/${year}`;

    const lines = guesses.map((g) => {
      const m = g.marca.status === "correct" ? "✅" : "❌";
      const mo = g.modelo.status === "correct" ? "✅" : "❌";
      const a = g.anio.status === "correct" ? "✅" : "❌";
      return m + mo + a;
    });

    const finalAttempts = status === 'won' ? attempts : 'X';
    const baseText = `🚗 Coche del Día\n${shareDate}\n${finalAttempts}/${MAX_ATTEMPTS}\n\n${lines.join("\n")}`;

    if (status === "won") return `${baseText}\n\nJuega tú también: ${webUrl}`;
    return baseText;
  }

  return { car, isLoading, isSubmitting, guesses, attempts, status, zoom, zoomLabel, maxAttempts: MAX_ATTEMPTS, submitGuess, buildShareText };
}