import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../components/Toast";
import { getMyStats } from "./useStats";
import { detectAndPersistNewAchievements } from "../lib/achievementsNotifier";
import { track } from "../lib/analytics";
import { useT } from "../i18n";

const MAX_ATTEMPTS = 5;

// Niveles de zoom CSS aplicados sobre la imagen `?z=5` (crop 58.8% central)
// que sirve el servidor durante la partida.
//
// Los zooms lógicos del juego son [3.7, 3.2, 2.7, 2.2, 1.7] — intervalos
// regulares de 0.5 para que la dificultad baje de forma uniforme y el
// último intento no sea demasiado revelador (antes el salto 2.4 → 1.8
// regalaba mucha imagen). El servidor solo entrega el crop más amplio
// (58.8% = 1/1.7) y el cliente cierra el resto con CSS para los intentos
// 1..4. Un atacante con DevTools nunca ve más imagen que un jugador
// legítimo en intento 5.
//
// Cada valor CSS = ZOOM_LOGICO / 1.7. Si tocas estos números también
// hay que actualizarlos en api/daily-image.js (Z_TO_CROP_PCT) y en
// src/admin/FocusPicker.jsx (ZOOM_PREVIEWS).
const ZOOM_LEVELS = [2.176, 1.882, 1.588, 1.294, 1.0];

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
  // Formato compacto: dominio + emoji + fecha en una sola cabecera, sin
  // URL repetida al final. Pros vs el formato Wordle clásico:
  //   - Ahorra una línea (la URL final).
  //   - La mayoría de clientes (Telegram/WhatsApp) NO renderizan tarjeta
  //     de preview cuando la URL está mezclada con texto en la misma línea,
  //     así que el mensaje no se infla con el "card" de OpenGraph.
  //   - "Carguessr.org" sigue siendo clicable: los autodetectores de URL
  //     reconocen el dominio aunque no lleve https://.
  const lines = guesses.map((g) => {
    const m = g.marca.status === "correct" ? "✅" : "❌";
    const mo = g.modelo.status === "correct" ? "✅" : "❌";
    const a = g.anio.status === "correct" ? "✅" : "❌";

    return m + mo + a;
  });

  return `Carguessr.org 🚗 ${getShareDate()}\n${lines.join("\n")}`;
}

// El estado del coche ahora solo contiene lo mínimo para pintar la UI: la
// imagen (siempre vía proxy), el LQIP base64 (placeholder borroso que
// elimina el flash gris del skeleton) y, opcionalmente, marca/modelo/año
// cuando el servidor decide revelarlos (solo en victoria).
function buildCarState({ img, blurData, reveal }) {
  return {
    img,
    blurData: blurData ?? null,
    marca: reveal?.marca ?? null,
    modelo: reveal?.modelo ?? null,
    anio: reveal?.anio ?? null,
    pais: reveal?.pais ?? null,
    // Mantenemos `description` como compat y añadimos `description_en`.
    // El helper getCarDescription() en src/i18n decide cuál mostrar según
    // el locale activo. Si reveal aún no llegó, ambos quedan null.
    description: reveal?.description ?? null,
    description_en: reveal?.description_en ?? null,
  };
}

// Helper compartido con Repesca.jsx: tras ganar una partida, refresca
// stats (que ya están actualizadas server-side por record_daily_result_v2
// o por la propia /api/repesca/validate), detecta logros nuevos y los
// pinta como toasts staggered. Máximo 3 individuales — si hay más,
// agrega el resto en uno solo para no spamear.
//
// Importable desde useGame y desde Repesca. NO usa hooks (recibe toast
// y t por parámetro) para poder llamarse fuera de un componente React.
export async function notifyAchievementsAfterWin({ toast, t, locale }) {
  try {
    // Refetch stats: la victoria que acaba de pasar ha actualizado al
    // menos current_streak/max_streak/total_wins/total_points + posibles
    // achievements ya persistidos (si el usuario tenía MyStats abierto en
    // sesiones anteriores). Necesitamos el snapshot fresco.
    const { stats } = await getMyStats();
    if (!stats) return;
    const { newlyUnlocked } = await detectAndPersistNewAchievements({ stats });
    if (newlyUnlocked.length === 0) return;

    const MAX_INDIVIDUAL = 3;
    const head = newlyUnlocked.slice(0, MAX_INDIVIDUAL);
    const rest = newlyUnlocked.length - head.length;

    head.forEach((a, i) => {
      const title =
        a.title?.[locale] || a.title?.es || a.title?.en || "Logro";
      track("achievement_unlocked", {
        id: a.id,
        category: a.category,
        tier: a.currentTier || null,
      });
      // Stagger: 600 ms entre toasts. Da tiempo a leer cada uno sin que
      // pisen al anterior (el Toast por defecto dura ~3-4s).
      setTimeout(() => {
        toast.push(`🏅 ${t("achievements.toastUnlocked")} ${title}`, {
          type: "success",
        });
      }, i * 600);
    });

    if (rest > 0) {
      setTimeout(() => {
        toast.push(
          `🏅 ${t("achievements.toastMore", { count: rest })}`,
          { type: "success" }
        );
      }, head.length * 600);
    }
  } catch (err) {
    // No interferir nunca con el flujo de victoria. Si la notificación
    // falla, el usuario verá los logros la próxima vez que abra MyStats.
    console.warn("[achievementsNotifier] post-win:", err);
  }
}

export function useGame() {
  const [car, setCar] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses] = useState([]);
  const [status, setStatus] = useState("playing");
  const [user, setUser] = useState(null);
  const [score, setScore] = useState(null);
  const { t, locale } = useT();
  // Token firmado por el servidor que autoriza ver la imagen completa
  // (modo reveal de /api/daily-image). Se rellena cuando el juego termina:
  //   - Si el usuario llega con la partida ya cerrada → desde /api/get-daily-car.
  //   - Si la cierra en esta sesión → desde la respuesta de /api/validate-guess.
  const [revealToken, setRevealToken] = useState(null);
  const toast = useToast();

  useEffect(() => {
    // Gate por id: onAuthStateChange dispara también TOKEN_REFRESHED al
    // recuperar la pestaña el foco. Si entregamos un user nuevo (aunque
    // sea el mismo usuario lógico), React lo trata como cambio → el
    // useEffect([user]) de abajo re-ejecuta initGame() y vuelve a pintar
    // "Aparcando coche...". Manteniendo la referencia previa cuando el id
    // no cambia, evitamos ese re-fetch.
    function applySession(session) {
      const nextUser = session?.user ?? null;
      setUser((prev) => (prev?.id === nextUser?.id ? prev : nextUser));
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
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

        const res = await fetch("/api/get-daily-car", {
          headers,
          // credentials same-origin: la cookie firmada `cd_anon` que emite
          // el endpoint para anónimos viaja en este round-trip y todas las
          // peticiones posteriores. Sin esto, los anónimos no podrían
          // jugar (validate-guess exige cookie de sesión).
          credentials: "same-origin",
        });
        const daily = await res.json();
        // daily = { date, img, guesses, status, reveal, revealToken }
        setRevealToken(daily.revealToken || null);

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
        setCar(
          buildCarState({
            img: daily.img,
            blurData: daily.blurData,
            reveal: initialReveal,
          })
        );
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
  // El zoom es un scale CSS aplicado sobre la imagen `?z=5` que ya viene
  // recortada al 55.6% central. Con cada intento, el scale baja → la imagen
  // se "aleja" mostrando más coche, hasta scale=1.0 en el intento 5 (no
  // queda más zoom que aplicar, ya ves todo el crop). Al revelar (won/lost),
  // el servidor sirve la imagen completa y volvemos a scale=1.0.
  const zoom = status === "playing" ? ZOOM_LEVELS[zoomIndex] : 1.0;
  const hintIndex = status === "playing" ? zoomIndex : null;
  const totalHints = ZOOM_LEVELS.length;

  // Durante la partida pedimos siempre el crop más amplio (z=5). El cliente
  // termina de "cerrar" el zoom con CSS. Cuando el juego termina añadimos
  // `&t=<revealToken>` y el servidor entrega la imagen completa — sin ese
  // token, /api/daily-image también devuelve crop (cierra el viejo cheat
  // de "quitar &z=5 → ver foto entera").
  let dailyImgSrc = null;
  if (car?.img) {
    if (status === "playing") {
      dailyImgSrc = `${car.img}&z=5`;
    } else if (revealToken) {
      dailyImgSrc = `${car.img}&t=${encodeURIComponent(revealToken)}`;
    } else {
      // Game over pero aún no llegó el revealToken (race muy puntual).
      // Mantenemos el crop hasta que llegue para no romper UX.
      dailyImgSrc = `${car.img}&z=5`;
    }
  }

  async function submitGuess({ guessCarId, anio }) {
    if (status !== "playing" || isSubmitting) return;
    // Los ids del catálogo son UUIDs (string). Solo exigimos que venga algo.
    if (typeof guessCarId !== "string" || !guessCarId) {
      console.error("[submitGuess] guessCarId inválido:", guessCarId);
      toast.push("Selecciona un coche del listado.", { type: "error" });
      return;
    }

    setIsSubmitting(true);

    // Construimos el payload UNA sola vez y lo reutilizamos en logs y en
    // el fetch — así si algo falla podemos ver exactamente qué se mandó.
    const payload = {
      guessCarId,
      anio,
      attemptNumber: guesses.length + 1,
    };

    let response;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      const headers = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      response = await fetch("/api/validate-guess", {
        method: "POST",
        headers,
        // credentials same-origin: imprescindible para anónimos — la
        // cookie HttpOnly `cd_anon` es la fuente de verdad del contador
        // de intentos server-side. Sin esto el endpoint rechazaría con
        // "Anon session missing".
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      // Aquí solo llegan errores de red puros: DNS, CORS, offline, abort.
      console.error("[submitGuess] fetch falló a nivel de red", {
        payload,
        error: networkErr,
        message: networkErr?.message,
      });
      triggerHaptic([60, 40, 60]);
      toast.push("Error de conexión. Comprueba tu red.", { type: "error" });
      setIsSubmitting(false);
      return;
    }

    // A partir de aquí el servidor respondió algo (200, 4xx o 5xx).
    // Intentamos parsear JSON, pero protegemos contra HTML de Vercel.
    let data = null;
    try {
      data = await response.json();
    } catch (parseErr) {
      // Servidor devolvió algo que no es JSON: probablemente HTML de error
      // de Vercel. Loguear el texto crudo es clave para depurar en prod.
      let rawText = "";
      try {
        rawText = await response.clone().text();
      } catch {}
      console.error("[submitGuess] respuesta no-JSON del servidor", {
        status: response.status,
        statusText: response.statusText,
        rawBody: rawText.slice(0, 500),
        parseError: parseErr?.message,
      });
      triggerHaptic([60, 40, 60]);
      toast.push("Respuesta inválida del servidor.", { type: "error" });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      console.error("[submitGuess] el servidor devolvió un error", {
        status: response.status,
        statusText: response.statusText,
        body: data,
        payload,
      });
      triggerHaptic([60, 40, 60]);
      toast.push(
        data?.error
          ? `Error: ${data.error}`
          : "No se pudo validar el intento.",
        { type: "error" }
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, reveal, revealToken: nextRevealToken, score: scoreBreakdown } = data;
      if (nextRevealToken) setRevealToken(nextRevealToken);
      if (!result) {
        console.error("[submitGuess] respuesta sin `result`", data);
        toast.push("Respuesta inesperada del servidor.", { type: "error" });
        setIsSubmitting(false);
        return;
      }

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
          description: reveal.description ?? null,
          description_en: reveal.description_en ?? null,
        }));
      }

      if (scoreBreakdown && newStatus !== "playing") setScore(scoreBreakdown);

      // Analytics: registramos el resultado de la partida diaria.
      // attempts incluye el intento ganador/perdedor que acaba de pasar.
      if (newStatus === "won") {
        track("daily_win", { attempts: newGuesses.length });
      } else if (newStatus === "lost") {
        track("daily_lose", {});
      }

      // Logros: solo aplican a usuarios logueados (los anónimos no tienen
      // persistencia en Supabase). Tras ganar, detectamos desbloqueos
      // nuevos y los notificamos con toast. Lo hacemos "fire and forget":
      // no bloquea el render del resultado de la partida.
      if (newStatus === "won" && user) {
        notifyAchievementsAfterWin({ toast, t, locale });
      }

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
      // Solo se entra aquí si algo casca DESPUÉS de tener la respuesta JSON
      // válida del servidor: un setState, un parseo de reveal, etc.
      console.error("[submitGuess] error procesando respuesta válida", {
        error,
        message: error?.message,
        stack: error?.stack,
        data,
      });
      triggerHaptic([60, 40, 60]);
      toast.push("Error procesando la respuesta.", { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return {
    // Sobreescribimos `img` con dailyImgSrc para que el consumidor reciba
    // ya la URL apropiada según el estado del juego (con `&z=N` si está
    // jugando, sin z si ha terminado y queremos servir la imagen completa).
    car: car ? { ...car, img: dailyImgSrc } : car,
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
