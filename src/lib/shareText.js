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
// (Historia: LA REJILLA ✅/❌ SE RETIRÓ en jul-2026 y VOLVIÓ el 29-jul con el
// formato corto de abajo — sin «N/5», sin racha y sin el enlace /r/…. Lo que
// sigue es por qué se quitó; el formato vigente es el de «Formato resultante».)
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
// Formato resultante (el vigente desde el 8-oct):
//   1. CABECERA  → "Coche del Día · DD/MM · 4/5" ("X/5" al perder). Nombre sin
//      artículo y fecha sin año: el resultado solo tiene sentido el mismo día
//      (puzzle diario). El «N/5» se retiró el 29-jul («la rejilla ya lo cuenta
//      en filas») y VOLVIÓ el 8-oct: en la vista previa de un chat y en las
//      notificaciones solo se lee la primera línea, y el resultado tiene que
//      estar ahí. La racha (🔥) no vuelve: es tuya, no del día.
//   2. REJILLA   → una línea por intento, ✅ acierto · 🟨 mismo país · ❌ fallo.
//      El 🟨 es de oct-2026: antes el «mismo país» se compartía como ❌, así
//      que una partida que se iba acercando parecía a ciegas — y es lo que la
//      rejilla de la pantalla sí distingue (cuadro ámbar).
//   3. DOMINIO   → SIEMPRE la última línea, sin texto alrededor. Activa el OG
//      card preview en WhatsApp/Telegram (marketing gratis) y hace de firma.
//
//      (Hasta el 29-jul el enlace llevaba la partida, /r/DD-MM/CODIGO, y no
//      era decoración: lo que sigue explica qué hacía, por si vuelve. El
//      que hace que la tarjeta del preview sea la TUYA:
//        · La fecha, porque las plataformas cachean el preview POR URL. Si todo
//          el mundo comparte `cochedeldia.com` a secas, Telegram enseña
//          eternamente el primer preview que llegó a cachear.
//        · El código de la partida (ver lib/resultCode.js), porque el
//          middleware lo lee de la ruta y reescribe el og:image apuntando a
//          /api/og-image?r=…, que dibuja TU rejilla en la portada.
//
//      Es una RUTA y no un query (?d=…) a propósito: el middleware solo
//      intercepta /r/*, así que la home nunca pasa por la transformación del
//      HTML y su camino queda intacto (regla 9).
//
//      La app ignora la ruta —el ruteo de index.jsx solo mira prefijos
//      concretos y cae a la portada— y no crea contenido duplicado para Google:
//      index.html declara <link rel="canonical"> a la raíz.)

import { getMadridDateStr } from "./dates";
import { encodeResult } from "./resultCode";

// Fallback de intentos máximos para el score del share. La fuente de verdad es
// el servidor (get-daily-car), que el caller pasa explícitamente; este default
// solo cubre llamadas sin el dato.
const SHARE_MAX_ATTEMPTS = 5;

// Rejilla compartible: una línea por intento, con los MISMOS tres estados que
// la rejilla dibujada del panel final (EndScreen, cuadros bien/cerca/mal).
// «partial» solo existe en la marca (mismo país, ver api/_lib/compare-guess.js).
// Optional chaining + guard de array → nunca lanza con estado corrupto o lista
// vacía (cae a ❌, que es lo correcto: sin status no es acierto).
const EMOJI = { correct: "✅", partial: "🟨" };
const celda = (c) => EMOJI[c?.status] || "❌";
export function shareGrid(guesses) {
  return (Array.isArray(guesses) ? guesses : [])
    .map((g) => celda(g?.marca) + celda(g?.modelo) + celda(g?.anio))
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
  const grid = shareGrid(list);

  // Victoria = última fila con las tres celdas correctas (no hay otra forma de
  // ganar; la partida se cierra ahí). Derrota → "X/5", como Wordle.
  const ultima = list[list.length - 1];
  const gano = Boolean(
    ultima &&
      ultima.marca?.status === "correct" &&
      ultima.modelo?.status === "correct" &&
      ultima.anio?.status === "correct"
  );
  const marcador = `${gano ? list.length : "X"}/${maxAttempts}`;

  return `Coche del Día · ${getShareDate(todayStr)} · ${marcador}\n${grid}\ncochedeldia.com`;
}
