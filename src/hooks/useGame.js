import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient"; // Asegúrate de tener tu cliente de Supabase aquí
import { recordWin } from "./useStats";

const MAX_ATTEMPTS = 5;

function getTodayKey() {
  const options = { timeZone: "Europe/Madrid", year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); 
  return formatter.format(new Date()); 
}

export function useGame() {
  const [car, setCar] = useState(null); 
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");
  const [user, setUser] = useState(null);

  useEffect(() => {
    // 1. Detectar si hay un usuario logueado
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
        // 2. Pedir el coche del día a la API
        const res = await fetch('/api/get-daily-car');
        const dailyCar = await res.json();

        let initialGuesses = [];
        let initialStatus = "playing";
        let initialCarData = dailyCar;

        // 3. PRIORIDAD: ¿Hay usuario logueado? Miramos en Supabase
        if (user) {
          const { data: dbState } = await supabase
            .from('user_guesses')
            .select('*')
            .eq('user_id', user.id)
            .eq('car_id', dailyCar.id)
            .eq('date', today)
            .single();

          if (dbState) {
            initialGuesses = dbState.guesses;
            initialStatus = dbState.status;
            initialCarData = dbState.car_data || dailyCar;
          }
        } else {
          // Si no hay usuario, usamos el LocalStorage de siempre
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
  }, [user]); // Se vuelve a ejecutar si el usuario hace Login/Logout

  async function submitGuess(marca, modelo, anio) {
    if (status !== "playing" || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/check-guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: { marca, modelo, anio }, carId: car.id, attemptNumber: guesses.length + 1 })
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

      // 4. GUARDADO SINCRONIZADO
      const stateToSave = { 
        guesses: newGuesses, 
        status: newStatus, 
        carData: carData || null,
        date: getTodayKey(),
        carId: car.id
      };

      if (user) {
        // Guardar en la nube (Supabase)
        await supabase.from('user_guesses').upsert({
          user_id: user.id,
          car_id: car.id,
          date: stateToSave.date,
          guesses: newGuesses,
          status: newStatus,
          car_data: stateToSave.carData
        });
      } else {
        // Guardar solo en local
        localStorage.setItem("cocheDia_state", JSON.stringify(stateToSave));
      }
      
      if (result.win) recordWin().catch(console.error);

    } catch (error) {
      alert("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // (buildShareText y retornos se mantienen igual que antes...)
  return { car, isLoading, isSubmitting, guesses, attempts: guesses.length, status, submitGuess /* ... */ };
}