import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { recordWin } from "./useStats";

const MAX_ATTEMPTS = 5;
const ZOOM_LEVELS = [3.2, 2.9, 2.5, 2.1, 1.8]; // El zoom va disminuyendo a medida que se acercan al coche, hasta llegar a 1x en la victoria
const ZOOM_LABELS = [
  "🔍 x3",
  "🔍 x2.5",
  "🔎 x2",
  "🔭 x2.5",
];

function getTodayKey() {
  const options = { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" };
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  return formatter.format(new Date());
}

function buildShareText(guesses, attempts, status) {
  const webUrl = "https://carguessr.org";
  const lines = guesses.map((g) => {
    const m  = g.marca.status  === "correct" ? "✅" : "❌";
    const mo = g.modelo.status === "correct" ? "✅" : "❌";
    const a  = g.anio.status   === "correct" ? "✅" : g.anio.status === "partial" ? "🟨" : "❌";
    return m + mo + a;
  });
  const base = `🚗 Coche del Día\n${getTodayKey()}\n${attempts}/${MAX_ATTEMPTS}\n\n${lines.join("\n")}`;
  return status === "won" ? `${base}\n\nJuega tú también: ${webUrl}` : base;
}

export function useGame() {
  const [car, setCar]               = useState(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses]       = useState([]);
  const [status, setStatus]         = useState("playing");
  const [user, setUser]             = useState(null);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  // ── Inicializar juego ─────────────────────────────────────────────────────
  useEffect(() => {
    async function initGame() {
      setIsLoading(true);
      const today = getTodayKey();
      try {
        const res = await fetch("/api/get-daily-car");
        const dailyCar = await res.json();

        let initialGuesses = [];
        let initialStatus  = "playing";
        let initialCarData = dailyCar;

        if (user) {
          const { data: dbState } = await supabase
            .from("user_guesses")
            .select("*")
            .eq("user_id", user.id)
            .eq("car_id", dailyCar.id)
            .eq("date", today)
            .single();

          if (dbState) {
            initialGuesses = dbState.guesses;
            initialStatus  = dbState.status;
            initialCarData = dbState.car_data || dailyCar;
          }
        } else {
          const raw = localStorage.getItem("cocheDia_state");
          if (raw) {
            const saved = JSON.parse(raw);
            if (saved.date === today && saved.carId === dailyCar.id) {
              initialGuesses = saved.guesses;
              initialStatus  = saved.status;
              initialCarData = saved.carData || dailyCar;
            }
          }
        }

        setGuesses(initialGuesses);
        setStatus(initialStatus);
        setCar(initialCarData);
      } catch (err) {
        console.error("Error al inicializar:", err);
      } finally {
        setIsLoading(false);
      }
    }

    initGame();
  }, [user]);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const attempts = guesses.length;
  const zoomIndex = Math.min(attempts, ZOOM_LEVELS.length - 1);
  
  // Si el juego ha terminado (status !== "playing"), el zoom es 1.0 y la etiqueta es null
  const zoom = status === "playing" ? ZOOM_LEVELS[zoomIndex] : 1.0;
  const zoomLabel = status === "playing" ? ZOOM_LABELS[zoomIndex] : null;

  // ── Enviar intento ────────────────────────────────────────────────────────
  async function submitGuess(marca, modelo, anio) {
    if (status !== "playing" || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/check-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guess: { marca, modelo, anio },
          carId: car.id,
          attemptNumber: guesses.length + 1,
        }),
      });

      const data = await response.json();
      const { result, carData } = data;

      const newGuesses = [...guesses, result];
      let newStatus = "playing";
      if (result.win)                          newStatus = "won";
      else if (newGuesses.length >= MAX_ATTEMPTS) newStatus = "lost";

      setGuesses(newGuesses);
      setStatus(newStatus);
      if (carData) setCar(carData);

      const stateToSave = {
        guesses:  newGuesses,
        status:   newStatus,
        carData:  carData || null,
        date:     getTodayKey(),
        carId:    car.id,
      };

      if (user) {
        await supabase.from("user_guesses").upsert({
          user_id:  user.id,
          car_id:   car.id,
          date:     stateToSave.date,
          guesses:  newGuesses,
          status:   newStatus,
          car_data: stateToSave.carData,
        });
      } else {
        localStorage.setItem("cocheDia_state", JSON.stringify(stateToSave));
      }

      if (result.win) recordWin().catch(console.error);
    } catch (error) {
      alert("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Return COMPLETO ───────────────────────────────────────────────────────
  return {
    car,
    isLoading,
    isSubmitting,
    guesses,
    attempts,                          // número de intentos usados
    status,
    zoom,
    zoomLabel,
    maxAttempts: MAX_ATTEMPTS,         // ← esto es lo que faltaba y causaba NaN
    submitGuess,
    buildShareText: () => buildShareText(guesses, attempts, status),
  };
}