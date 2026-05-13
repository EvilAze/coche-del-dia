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

// El estado del coche ahora solo contiene lo mínimo para pintar la UI: la
// imagen (siempre vía proxy) y, opcionalmente, marca/modelo/año cuando el
// servidor decide revelarlos (solo en victoria).
function buildCarState({ img, reveal }) {
  return {
    img,
    marca: reveal?.marca ?? null,
    modelo: reveal?.modelo ?? null,
    anio: reveal?.anio ?? null,
    pais: reveal?.pais ?? null,
  };
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
        // Para anónimos, hacemos la primera lectura desde localStorage para
        // pintar instantáneamente y luego pedimos al servidor (que no nos
        // dirá nada que no sepamos). Para logueados, /api/get-daily-car ya
        // nos devuelve los intentos guardados.
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token;

        const headers = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const res = await fetch("/api/get-daily-car", { headers });
        const daily = await res.json();
        // daily = { date, img, guesses, status, reveal }

        let initialGuesses = Array.isArray(daily.guesses) ? daily.guesses : [];
        let initialStatus = daily.status || "playing";
        let initialReveal = daily.reveal || null;

        // Anónimos: completamos con localStorage si no había estado server.
        if (!session && initialGuesses.length === 0 && initialStatus === "playing") {
          const raw = localStorage.getItem("cocheDia_state");
          if (raw) {
            try {
              const saved = JSON.parse(raw);
              if (saved.date === daily.date) {
                initialGuesses = Array.isArray(saved.guesses) ? saved.guesses : [];
                initialStatus = saved.status || "playing";
                initialReveal = saved.reveal || null;
              }
            } catch {
              // ignore: estado corrupto, jugamos limpio.
            }
          }
        }

        setGuesses(initialGuesses);
        setStatus(initialStatus);
        setCar(buildCarState({ img: daily.img, reveal: initialReveal }));
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

  async function submitGuess({ guessCarId, anio }) {
    if (status !== "playing" || isSubmitting) return;
    if (!Number.isInteger(guessCarId)) return;

    setIsSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      const headers = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const response = await fetch("/api/validate-guess", {
        method: "POST",
        headers,
        body: JSON.stringify({
          guessCarId,
          anio,
          attemptNumber: guesses.length + 1,
        }),
      });

      if (!response.ok) {
        triggerHaptic([60, 40, 60]);
        toast.push("No se pudo validar el intento.", { type: "error" });
        return;
      }

      const data = await response.json();
      const { result, reveal, score: scoreBreakdown } = data;

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

      // El servidor solo manda `reveal` cuando el usuario gana. Si pierde,
      // reveal=null y el coche del día permanece oculto: el atacante del
      // Network ya no tiene de dónde sacarlo.
      if (reveal) {
        setCar((prev) => ({
          ...(prev || {}),
          marca: reveal.marca,
          modelo: reveal.modelo,
          anio: reveal.anio,
          pais: reveal.pais,
        }));
      }

      if (scoreBreakdown && newStatus !== "playing") setScore(scoreBreakdown);

      // Persistencia local SOLO para anónimos. Para logueados, /api/validate-guess
      // ya escribió en user_guesses con valores server-validated.
      if (!user) {
        const stateToSave = {
          date: getTodayKey(),
          guesses: newGuesses,
          status: newStatus,
          reveal: reveal || null,
        };
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
