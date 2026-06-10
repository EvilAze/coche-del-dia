import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../components/Toast";
import { notifyAchievementsAfterWin } from "../lib/achievementsNotifier";
import { track } from "../lib/analytics";
import { haptic } from "../lib/haptics";
import { useT } from "../i18n";
// Niveles de zoom CSS aplicados sobre la imagen `?z=5` que sirve el servidor
// durante la partida. AHORA son POR COCHE: dependen de su `zoomBase` (el zoom
// lógico del intento 1, que llega en la respuesta de get-daily-car). El
// servidor solo entrega el crop del intento 5 (el más amplio) y el cliente
// cierra el resto con CSS para los intentos 1..4 — un atacante con DevTools
// nunca ve más imagen que un jugador legítimo en intento 5.
//
// La fórmula está centralizada en src/lib/zoom.js (réplica de api/_lib/zoom.js).
// Para el base por defecto (3.7) cssZoomLevels reproduce [2.176, 1.882, 1.588,
// 1.294, 1.0] — el comportamiento histórico exacto.
import { cssZoomLevels, ZOOM_ATTEMPTS } from "../lib/zoom.js";

// Fallback de intentos máximos mientras /api/get-daily-car no ha respondido
// (o si una respuesta antigua no trae el campo). La fuente de verdad es el
// servidor: get-daily-car incluye `maxAttempts` en su JSON y lo guardamos en
// estado. OJO: este valor solo gobierna la UI — la validación real de
// "partida terminada" la hace api/validate-guess.js con SU constante,
// porque un valor que pasa por el navegador es manipulable con DevTools.
const DEFAULT_MAX_ATTEMPTS = 5;

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

// Lectura SÍNCRONA del estado local del reto diario, solo para anónimos.
// Sirve para pintar el resultado (ResultPanel + lista de guesses) en el
// primer render, sin esperar a que /api/get-daily-car resuelva. Antes,
// el usuario que volvía durante el día veía un fondo negro hasta que
// llegaba la respuesta del servidor (~150-400 ms en revisitas con caché
// caliente, mucho más en redes lentas).
//
// Restricciones críticas para no romper la fuente de verdad:
//   1. SOLO se aplica si NO hay sesión Supabase en localStorage. Si el
//      usuario está logueado, la fuente de verdad es el servidor — un
//      estado anon antiguo podría engañarle pintando un resultado
//      incorrecto durante 200 ms.
//   2. Solo si la `date` del snapshot coincide con HOY (Europe/Madrid).
//   3. Cualquier excepción → null. Modo privado / sandbox / JSON corrupto
//      caen al flujo normal (loading + fetch), no a UI rota.
//
// El servidor sigue corriendo después con su propia respuesta y, si
// difiere, sobreescribe el estado. En el 99% de los casos coincide.
function readInitialAnonState() {
  if (typeof window === "undefined") return null;
  try {
    // Detectar sesión Supabase: la lib guarda el token en una clave del
    // estilo `sb-<projectref>-auth-token`. Si hay una, el usuario está
    // logueado y NO debemos confiar en el snapshot anon local.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
        const val = localStorage.getItem(key);
        if (val && val !== "null" && val !== '""') return null;
      }
    }
    const raw = localStorage.getItem("cocheDia_state");
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.date !== getTodayKey()) return null;
    if (!Array.isArray(saved.guesses)) return null;
    return {
      guesses: saved.guesses,
      status: saved.status || "playing",
      reveal: saved.reveal || null,
    };
  } catch {
    return null;
  }
}

function getShareDate() {
  // Formato corto DD/MM sin año — los resultados solo tienen sentido
  // contextual el mismo día (es un puzzle diario), así que el año es
  // ruido. Ahorra 3 caracteres en cada mensaje compartido.
  const [, month, day] = getTodayKey().split("-");
  return `${day}/${month}`;
}

function buildShareText(guesses, streak = 0) {
  // Formato Wordle-style con tres bloques de información, cada uno con rol
  // distinto — sin redundancia entre ellos:
  //
  //   1. CABECERA  → identificador + fecha [+ racha]
  //        "Coche del Día · 24/05 · 🔥7"
  //      • Nombre sin artículo: más compacto sin perder identidad.
  //      • Fecha sin año: nadie comparte resultados de meses atrás.
  //      • Racha (solo si > 0): peso emocional → "no quiero romperla" =
  //        share-bait. El 🔥 es universal para streak.
  //      • NO incluimos "N/5" tipo Wordle: con máx 5 filas de 3 celdas,
  //        la cuadrícula ES trivialmente parseable a ojo (contar filas =
  //        score, última fila ✅✅✅ = victoria). Repetir esa info en
  //        número es ruido. Wordle lo lleva por su grid de 6x5 más densa.
  //
  //   2. CUADRÍCULA → resultados visuales (contiene score + win/loss)
  //        ✅❌❌ / ✅✅❌ / ✅✅✅
  //
  //   3. DOMINIO   → en línea propia, sin texto alrededor
  //        "cochedeldia.com"
  //      Esto SÍ activa el OG card preview en WhatsApp/Telegram —
  //      decisión deliberada: cada share genera un preview con el
  //      wordmark dorado + GT-R en el chat del receptor. Marketing
  //      gratis vs ahorrar 50 px de altura en el mensaje.
  const lines = guesses.map((g) => {
    const m = g.marca.status === "correct" ? "✅" : "❌";
    const mo = g.modelo.status === "correct" ? "✅" : "❌";
    const a = g.anio.status === "correct" ? "✅" : "❌";

    return m + mo + a;
  });

  // Racha: solo se incluye si hay racha real (>0). Los anónimos pasan
  // streak=0 por defecto y se omite limpiamente. Un "🔥0" sería
  // contraproducente.
  const streakChunk = streak > 0 ? ` · 🔥${streak}` : "";

  return `Coche del Día · ${getShareDate()}${streakChunk}\n${lines.join("\n")}\ncochedeldia.com`;
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

export function useGame() {
  // Snapshot anon leído UNA sola vez al montar. Si existe, pre-pintamos
  // el resultado del reto y omitimos el primer paso de loading — la
  // CarImage seguirá esperando al servidor por su cuenta (tiene su propio
  // skeleton) pero el resto de la UI ya está visible.
  const initialAnonRef = useRef(null);
  if (initialAnonRef.current === null) {
    // Inicialización lazy "tipo useState lazy initializer" pero a través
    // de ref para que esté disponible tanto en useState como en useEffect.
    initialAnonRef.current = readInitialAnonState() || { _empty: true };
  }
  const initialAnon = initialAnonRef.current._empty ? null : initialAnonRef.current;

  // `car` arranca con un placeholder que solo expone el reveal (marca/
  // modelo/año si el usuario ya ganó). `img` y `blurData` siguen siendo
  // null hasta que llegue la respuesta del servidor, y CarImage trata src
  // null como "muestra skeleton" — sin error ni request rota.
  const [car, setCar] = useState(
    initialAnon
      ? buildCarState({ img: null, blurData: null, reveal: initialAnon.reveal })
      : null
  );
  // Si tenemos snapshot, isLoading=false desde el principio → App.jsx
  // considera dataReady=true en el primer paint y renderiza la UI completa
  // (con CarImage en skeleton hasta que llegue la foto).
  const [isLoading, setIsLoading] = useState(!initialAnon);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [guesses, setGuesses] = useState(initialAnon?.guesses ?? []);
  // Fila "pending" que se pinta mientras esperamos respuesta del servidor.
  // Tiene la misma forma que un guess real, pero todas las celdas se renderizan
  // con shimmer neutro. Se setea al inicio de submitGuess y se limpia cuando
  // llega la respuesta (o error). Sin esto, el usuario solo veía un spinner
  // en el botón sin pista de qué estaba pasando.
  const [pendingGuess, setPendingGuess] = useState(null);
  // Índice de la última guess "recién revelada". Sirve para que App marque la
  // GuessRow correspondiente con justRevealed → reveal secuencial por celda.
  // Se resetea a -1 al inicializar y cuando entra una nueva pending.
  const [justRevealedIndex, setJustRevealedIndex] = useState(-1);
  const [status, setStatus] = useState(initialAnon?.status ?? "playing");
  // Intentos máximos según el servidor (ver DEFAULT_MAX_ATTEMPTS arriba).
  const [maxAttempts, setMaxAttempts] = useState(DEFAULT_MAX_ATTEMPTS);
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

  // Flag: si la primera ejecución de initGame tiene snapshot optimista,
  // NO flipeamos isLoading→true (eso causaría exactamente el flicker que
  // estamos evitando). El servidor confirma en background y, si todo va
  // bien, el setIsLoading(false) final es un no-op.
  const skipFirstLoadingFlipRef = useRef(Boolean(initialAnon));

  useEffect(() => {
    async function initGame() {
      if (skipFirstLoadingFlipRef.current) {
        skipFirstLoadingFlipRef.current = false;
      } else {
        setIsLoading(true);
      }
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
        // daily = { date, img, maxAttempts, guesses, status, reveal, revealToken }
        setRevealToken(daily.revealToken || null);
        if (Number.isInteger(daily.maxAttempts) && daily.maxAttempts > 0) {
          setMaxAttempts(daily.maxAttempts);
        }

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
  const zoomIndex = Math.min(attempts, ZOOM_ATTEMPTS - 1);
  // Scales CSS por intento, derivados del zoom_base del coche de hoy (llega en
  // car.zoomBase). Si aún no hay coche o es un coche sin la columna, cssZoomLevels
  // cae al default 3.7. El zoom es un scale aplicado sobre la imagen `?z=5` (el
  // crop del intento 5): con cada intento baja → la imagen se "aleja" mostrando
  // más coche, hasta scale=1.0 en el intento 5. Al revelar (won/lost), el
  // servidor sirve la imagen completa y volvemos a scale=1.0.
  const zoomLevels = cssZoomLevels(car?.zoomBase);
  const zoom = status === "playing" ? zoomLevels[zoomIndex] : 1.0;
  const hintIndex = status === "playing" ? zoomIndex : null;
  const totalHints = ZOOM_ATTEMPTS;

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

  async function submitGuess({ guessCarId, anio, marca, modelo }) {
    if (status !== "playing" || isSubmitting) return;
    // Los ids del catálogo son UUIDs (string). Solo exigimos que venga algo.
    if (typeof guessCarId !== "string" || !guessCarId) {
      console.error("[submitGuess] guessCarId inválido:", guessCarId);
      toast.push("Selecciona un coche del listado.", { type: "error" });
      return;
    }

    setIsSubmitting(true);
    // Pintamos la fila pending con los valores que el usuario tecleó. Si el
    // form no nos los pasó, caemos a placeholders neutros para no romper
    // la UI (las celdas mostrarán "—").
    setPendingGuess({
      marca: { val: marca || "" },
      modelo: { val: modelo || "" },
      anio: { val: anio ? String(anio) : "" },
    });
    // Al iniciar un nuevo intento, dejamos de "destacar" el anterior — su
    // reveal ya terminó y no queremos que vuelva a animarse.
    setJustRevealedIndex(-1);

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
      haptic.error();
      toast.push("Error de conexión. Comprueba tu red.", { type: "error" });
      setPendingGuess(null);
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
      haptic.error();
      toast.push("Respuesta inválida del servidor.", { type: "error" });
      setPendingGuess(null);
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
      haptic.error();
      toast.push(
        data?.error
          ? `Error: ${data.error}`
          : "No se pudo validar el intento.",
        { type: "error" }
      );
      setPendingGuess(null);
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, reveal, revealToken: nextRevealToken, score: scoreBreakdown } = data;
      if (nextRevealToken) setRevealToken(nextRevealToken);
      if (!result) {
        console.error("[submitGuess] respuesta sin `result`", data);
        toast.push("Respuesta inesperada del servidor.", { type: "error" });
        setPendingGuess(null);
        setIsSubmitting(false);
        return;
      }

      const newGuesses = [...guesses, result];
      // Marcamos la nueva guess como "recién revelada" para que App active
      // el reveal secuencial por celda en esa fila concreta.
      setJustRevealedIndex(newGuesses.length - 1);
      setPendingGuess(null);
      let newStatus = "playing";

      if (result.win) newStatus = "won";
      else if (newGuesses.length >= maxAttempts) newStatus = "lost";

      if (newStatus === "won") {
        haptic.success();
      } else if (newStatus === "lost") {
        haptic.warning();
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
      haptic.error();
      toast.push("Error procesando la respuesta.", { type: "error" });
      setPendingGuess(null);
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
    pendingGuess,
    justRevealedIndex,
    attempts,
    status,
    zoom,
    hintIndex,
    totalHints,
    score,
    maxAttempts,
    submitGuess,
    buildShareText: (streak = 0) => buildShareText(guesses, streak),
  };
}
