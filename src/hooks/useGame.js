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
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ¡CLAVE! Ahora guardamos también el carId
function saveState(state, carId) {
  try {
    localStorage.setItem("cocheDia_state", JSON.stringify({ 
      ...state, 
      date: getTodayKey(),
      carId: carId 
    }));
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

    fetch('/api/get-daily-car')
      .then((res) => res.json())
      .then((data) => {
        // EL CORTAFUEGOS: Solo cargamos la partida si la fecha coincide Y el ID del coche es el mismo
        if (saved && saved.date === getTodayKey() && saved.carId === data.id) {
          setGuesses(saved.guesses || []);
          setStatus(saved.status || "playing");
          setCar(saved.carData || data);
        } else {
          // Si es un coche nuevo (o si ha cambiado a mitad de día), reseteamos todo
          setGuesses([]);
          setStatus("playing");
          setCar(data);
          localStorage.removeItem("cocheDia_state"); 
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
      if (carData) setCar(carData);

      // Guardamos la partida pasando el ID del coche
      saveState({ 
        guesses: newGuesses, 
        status: newStatus, 
        carData: carData || null 
      }, car.id);
      
      if (result.win) recordWin().catch(console.error);

    } catch (error) {
      console.error("Error al comprobar:", error);
      alert("Hubo un error de conexión.");
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