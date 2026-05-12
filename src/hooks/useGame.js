import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../components/Toast";

const MAX_ATTEMPTS = 5;
const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];

function getTodayKey() {
  const options = {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  return formatter.format(new Date());
}

function getShareDate() {
  const [year, month, day] = getTodayKey().split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}

function triggerHaptic(pattern) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

function buildShareText(guesses) {
  const webUrl = "https://carguessr.org";

  const lines = guesses.map((g) => {
    const m = g.marca.status === "correct" ? "✅" : "❌";
    const mo = g.modelo.status === "correct" ? "✅" : "❌";
    const a = g.anio.status === "correct" ? "✅" : "❌";

    return m + mo + a;
  });

  return `Carguessr 🚗 ${getShareDate()}\n${lines.join("\n")}\n${webUrl}`;
}

export function useGame() {
  const [car, setCar] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");
  const [user, setUser] = useState(null);
  const [score, setScore] = useState(null);
  const toast = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function initGame() {
      setIsLoading(true);
      const today = getTodayKey();

      try {
        const res = await fetch("/api/get-daily-car");
        const dailyCar = await res.json();

        let initialGuesses = [];
        let initialStatus = "playing";
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
            initialStatus = dbState.status;
            initialCarData = dbState.car_data || dailyCar;
          }
        } else {
          const raw = localStorage.getItem("cocheDia_state");

          if (raw) {
            const saved = JSON.parse(raw);

            if (saved.date === today && saved.carId === dailyCar.id) {
              initialGuesses = saved.guesses;
              initialStatus = saved.status;
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

  const attempts = guesses.length;
  const zoomIndex = Math.min(attempts, ZOOM_LEVELS.length - 1);
  const zoom = status === "playing" ? ZOOM_LEVELS[zoomIndex] : 1.0;
  const hintIndex = status === "playing" ? zoomIndex : null;
  const totalHints = ZOOM_LEVELS.length;

  async function submitGuess(marca, modelo, anio) {
    if (status !== "playing" || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      const headers = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const response = await fetch("/api/check-guess", {
        method: "POST",
        headers,
        body: JSON.stringify({
          guess: { marca, modelo, anio },
          carId: car.id,
          attemptNumber: guesses.length + 1,
        }),
      });

      const data = await response.json();
      const { result, carData, score: scoreBreakdown } = data;

      const newGuesses = [...guesses, result];
      let newStatus = "playing";

      if (result.win) newStatus = "won";
      else if (newGuesses.length >= MAX_ATTEMPTS) newStatus = "lost";

      if (newStatus === "won") {
        triggerHaptic(200);
      } else if (newStatus === "lost") {
        triggerHaptic([100, 50, 100]);
      }

      setGuesses(newGuesses);
      setStatus(newStatus);
      if (carData) setCar(carData);
      if (scoreBreakdown && newStatus !== "playing") setScore(scoreBreakdown);

      const stateToSave = {
        guesses: newGuesses,
        status: newStatus,
        carData: carData || null,
        date: getTodayKey(),
        carId: car.id,
      };

      if (user) {
        const { error } = await supabase.from("user_guesses").upsert(
          {
            user_id: user.id,
            car_id: car.id,
            date: stateToSave.date,
            guesses: newGuesses,
            status: newStatus,
            car_data: stateToSave.carData,
          },
          {
            onConflict: "user_id,car_id,date",
          }
        );

        if (error) console.error("Error guardando partida:", error);
      } else {
        localStorage.setItem("cocheDia_state", JSON.stringify(stateToSave));
      }

      return result;

    } catch (error) {
      triggerHaptic([60, 40, 60]);
      toast.push("Error de conexión. Comprueba tu red.", { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    car,
    isLoading,
    isSubmitting,
    guesses,
    attempts,
    status,
    zoom,
    hintIndex,
    totalHints,
    score,
    maxAttempts: MAX_ATTEMPTS,
    submitGuess,
    buildShareText: () => buildShareText(guesses),
  };
}