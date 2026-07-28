// src/lib/shareText.js
// Generación PURA del texto que el jugador comparte. Extraído de useGame.js
// para poder testearlo sin montar el hook ni React, y para ser la FUENTE ÚNICA
// de la rejilla (antes EndScreen.jsx mantenía un espejo manual y el comentario
// advertía "si cambias un mapeo, cambia el otro"; ahora EndScreen importa de aquí).
//
// ─── POR QUÉ EL MENSAJE ES TAN CORTO ────────────────────────────────────────
// Este texto se pega sobre todo en un CANAL de Telegram con cientos de
// personas, y ahí el alto del mensaje es espacio robado a la conversación de
// los demás. Al jugador al que le llaman la atención por spam no vuelve a
// compartir — y compartir es el único canal de captación que tiene el juego.
//
// LA REJILLA ✅/❌ SE RETIRÓ (jul-2026), y no por capricho de brevedad:
//   · Su información ya estaba en la cabecera. "3/5" dice cuántos intentos
//     costó; la rejilla lo repetía en cinco líneas, con el detalle de qué campo
//     falló en cada uno — un matiz que solo entiende quien ya jugó hoy, y que
//     por tanto no recluta a nadie.
//   · Desde que el enlace trae tarjeta con el COCHE del día (api/og-image.js),
//     el mensaje ya tiene su gancho visual. Foto + rejilla era pedirle a un
//     canal ajeno ocho líneas y una imagen por partida.
//   · Y en un canal DE CARDLE —de donde queremos que venga la gente— una
//     rejilla de cuadritos es indistinguible del ruido que ya hay. Lo que llama
//     la atención de un aficionado al motor es el coche.
// `shareGrid` NO se borra: el EndScreen la sigue pintando en pantalla como
// registro de tu partida. Es el trofeo; el mensaje es otra cosa.
//
// Formato resultante — tres líneas como mucho:
//   1. CABECERA  → "Coche del Día · DD/MM · N/5 · 🔥7"
//      • Nombre sin artículo y fecha sin año: más compacto, el resultado solo
//        tiene sentido el mismo día (puzzle diario).
//      • Score "N/5" ("X/5" en derrota), como Wordle: lo primero que comunica.
//      • Racha solo si > 0 (un "🔥0" sería contraproducente).
//   2. PERCENTIL → lo inserta EndScreen, y solo si es un flex de verdad
//      (top 30%). Opcional por definición.
//   3. DOMINIO   → SIEMPRE la última línea, sin texto alrededor. Activa el OG
//      card preview en WhatsApp/Telegram (marketing gratis) y hace de firma.
//      EndScreen inserta el percentil ("Mejor que el N%…") JUSTO ANTES de esta
//      línea — cuenta con que el dominio cierra el mensaje.
//
//      LLEVA LA FECHA (?d=DD-MM) Y NO ES DECORACIÓN. Desde jul-2026 el og:image
//      es una tarjeta viva con el recorte del coche de hoy (api/og-image.js),
//      pero las plataformas cachean el preview POR URL: si todo el mundo
//      comparte `cochedeldia.com` a secas, Telegram enseña eternamente el
//      primer preview que llegó a cachear y la tarjeta nueva no la ve nadie.
//      Con la fecha, el enlace de cada día es una URL distinta → preview nuevo
//      → recorte del día. Es la mitad del trabajo que hace que la OG dinámica
//      sirva de algo.
//
//      El parámetro lo ignora la app (el ruteo de index.jsx solo mira rutas
//      concretas) y no crea contenido duplicado para Google: index.html declara
//      <link rel="canonical"> a la raíz.

import { getMadridDateStr } from "./dates";

// Fallback de intentos máximos para el score del share. La fuente de verdad es
// el servidor (get-daily-car), que el caller pasa explícitamente; este default
// solo cubre llamadas sin el dato.
export const SHARE_MAX_ATTEMPTS = 5;

// Rejilla compartible: una línea por intento. Espejo EXACTO que consume también
// EndScreen.jsx. Optional chaining + guard de array → nunca lanza con estado
// corrupto o lista vacía (cae a ❌, que es lo correcto: sin status no es acierto).
export function shareGrid(guesses) {
  return (Array.isArray(guesses) ? guesses : [])
    .map((g) => {
      const m = g?.marca?.status === "correct" ? "✅" : "❌";
      const mo = g?.modelo?.status === "correct" ? "✅" : "❌";
      const a = g?.anio?.status === "correct" ? "✅" : "❌";
      return m + mo + a;
    })
    .join("\n");
}

// Fecha corta DD/MM (sin año) a partir de una clave YYYY-MM-DD de Madrid.
// `todayStr` es inyectable para tests deterministas; por defecto, hoy en Madrid.
export function getShareDate(todayStr = getMadridDateStr()) {
  const [, month, day] = String(todayStr).split("-");
  return `${day}/${month}`;
}

// Texto completo del share. `todayStr` inyectable para tests.
export function buildShareText(
  guesses,
  streak = 0,
  maxAttempts = SHARE_MAX_ATTEMPTS,
  todayStr = getMadridDateStr()
) {
  const list = Array.isArray(guesses) ? guesses : [];

  // Victoria = última fila con las tres celdas correctas (no hay otra forma de
  // ganar; la partida se cierra ahí). Derrota → "X/5" estilo Wordle.
  const last = list[list.length - 1];
  const won = Boolean(
    last &&
      last.marca?.status === "correct" &&
      last.modelo?.status === "correct" &&
      last.anio?.status === "correct"
  );
  const score = `${won ? list.length : "X"}/${maxAttempts}`;
  const streakChunk = streak > 0 ? ` · 🔥${streak}` : "";

  // La fecha va DD/MM en la cabecera (legible) y DD-MM en la URL (la barra
  // habría que escaparla y `%2F` en mitad de un enlace de chat es feo).
  const fechaUrl = getShareDate(todayStr).replace("/", "-");

  return `Coche del Día · ${getShareDate(todayStr)} · ${score}${streakChunk}\ncochedeldia.com/?d=${fechaUrl}`;
}
