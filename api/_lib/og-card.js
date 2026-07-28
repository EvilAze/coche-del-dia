// api/_lib/og-card.js
// Composición de la tarjeta Open Graph (1200×630) del «Prensa del motor».
//
// Vivía entera dentro de scripts/generate-og-image.mjs, que producía UN jpeg
// estático versionado en public/. Se extrae aquí porque ahora tiene dos
// consumidores:
//   · api/og-image.js          → la tarjeta VIVA, con el recorte del coche de hoy.
//   · scripts/generate-og-image.mjs → el respaldo estático (public/og-image.jpg),
//                                     que sigue existiendo como red de seguridad.
// Una sola composición: si algún día se rediseña la tarjeta, no hay dos sitios
// que puedan divergir.
//
// POR QUÉ 1200×630
//   - Facebook / WhatsApp piden mínimo 1200×630. Por debajo se ve chico y
//     pixelado.
//   - Twitter (X) usa 1200×600 para summary_large_image; recorta este sin
//     pérdida visible.
//   - LinkedIn / Discord / Telegram usan el mismo estándar.
//
// EL DISEÑO (heredado del generador estático, sin cambios)
//   - Papel #f3eee1 a sangre, tinta #1b1712, un solo acento rojo #b3271b.
//     Mismos tokens que src/index.css: el preview compartido y la portada real
//     tienen que ser reconociblemente la misma publicación.
//   - Composición a dos cuerpos: masthead a la izquierda, foto A SANGRE a la
//     derecha — el mismo gesto que la portada del juego.
//   - La foto va en DUOTONO sobre papel, no a color: una foto a todo color
//     sobre crema canta a plantilla; el duotono la integra como un fotograbado
//     de periódico. (Es el knob más fácil de girar si algún día se decide que
//     en un chat concurrido pesa más el impacto que la coherencia: quitar
//     grayscale/linear/tint de `procesarFoto` y la foto sale a color.)
//   - Filetes dobles arriba y bajo el wordmark: el motif de .prensa-folio.
//
// FUENTES: pilas EXPLÍCITAS, nunca el genérico `serif`/`sans-serif` a secas.
// El genérico parecía funcionar pero en bold caía en una monoespaciada (el
// wordmark salía tipo terminal), porque librsvg resuelve `serif` por fontconfig
// y no siempre encuentra una serif bold que le valga. Georgia (Windows/Mac) y
// DejaVu Serif (Linux, y por tanto el runtime de Vercel) cubren los dos
// entornos. NO referenciamos 'Fraunces' ni 'Libre Franklin' (las reales del
// sitio): no están instaladas en ningún entorno de build ni en el servidor, y
// el fallback silencioso da un resultado peor que elegir la sustituta a
// sabiendas.

import sharp from "sharp";

export const W = 1200;
export const H = 630;

// Paleta = tokens del tema día (src/index.css). No inventar hex aquí.
const PAPEL = "#f3eee1";
const TINTA = "#1b1712";
const TINTA2 = "#6e6553";
const ROJO = "#b3271b";

// Reparto horizontal: la foto ocupa el tercio derecho a sangre; el masthead
// respira en los 760px restantes. El filete vertical los separa.
const FOTO_X = 760;
const FOTO_W = W - FOTO_X;
const MARGEN = 64;

const SERIF = "Georgia, 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "Arial, 'DejaVu Sans', Helvetica, sans-serif";

// El antetítulo es lo ÚNICO variable de la tarjeta, y viaja dentro de un SVG:
// escapamos para que un valor inesperado no rompa el marcado (y con él la
// generación entera). Hoy solo recibe fechas, pero un helper que confía en su
// entrada es una bomba de relojería.
function escaparXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function construirOverlay(kicker) {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Filete doble superior (motif de .prensa-folio: 3px double). -->
  <rect x="${MARGEN}" y="86" width="${FOTO_X - MARGEN * 2}" height="3" fill="${TINTA}"/>
  <rect x="${MARGEN}" y="93" width="${FOTO_X - MARGEN * 2}" height="1" fill="${TINTA}"/>

  <!-- Antetítulo: el folio de la edición, en rojo como .prensa-folio .rojo.
       El letter-spacing es generoso, así que hay sitio para ~14 caracteres
       antes de chocar con el dominio alineado a la derecha. -->
  <text x="${MARGEN}" y="134"
        font-family="${SANS}" font-size="19" font-weight="700"
        fill="${ROJO}" letter-spacing="7">${escaparXml(kicker)}</text>
  <text x="${FOTO_X - MARGEN}" y="134"
        font-family="${SANS}" font-size="19" font-weight="400"
        fill="${TINTA2}" letter-spacing="4" text-anchor="end">cochedeldia.com</text>

  <!-- Wordmark a dos líneas: más masthead que una línea larga y chica, y deja
       el titular al mismo peso visual que la foto de al lado. -->
  <text x="${MARGEN}" y="298"
        font-family="${SERIF}" font-size="92" font-weight="700"
        fill="${TINTA}" letter-spacing="-1">El Coche</text>
  <text x="${MARGEN}" y="392"
        font-family="${SERIF}" font-size="92" font-weight="700"
        fill="${TINTA}" letter-spacing="-1">del Día</text>

  <!-- Filete doble rojo bajo el wordmark: el único acento de color del lado
       del texto, y el que amarra el bloque tipográfico. -->
  <rect x="${MARGEN}" y="432" width="${FOTO_X - MARGEN * 2}" height="3" fill="${ROJO}"/>
  <rect x="${MARGEN}" y="439" width="${FOTO_X - MARGEN * 2}" height="1" fill="${ROJO}"/>

  <!-- Lema en cursiva serif: la misma voz de .prensa-masthead .lema -->
  <text x="${MARGEN}" y="486"
        font-family="${SERIF}" font-size="27" font-style="italic"
        fill="${TINTA2}">Adivina marca, modelo y año en cinco intentos.</text>

  <!-- Filete vertical de separación: el corte entre el pliego y el grabado. -->
  <rect x="${FOTO_X - 1}" y="0" width="2" height="${H}" fill="${TINTA}" fill-opacity="0.35"/>
</svg>`;
}

// Fotograbado: la foto en duotono cálido. grayscale() quita el color, linear()
// abre el contraste Y BAJA el punto blanco (el desplazamiento negativo): sin
// eso, un coche claro sobre cielo claro se quemaba contra el crema y la foto se
// leía como una mancha pálida. tint() la reencaja en la gama del papel. El
// orden importa: tint sobre una imagen aún en color daría un viraje sucio.
async function procesarFoto(entrada) {
  return sharp(entrada)
    .resize(FOTO_W, H, { fit: "cover", position: "center" })
    .grayscale()
    .linear(1.26, -42)
    .tint({ r: 226, g: 214, b: 190 })
    .toBuffer();
}

/**
 * Compone la tarjeta completa.
 *
 * @param {Buffer|string} foto    Bytes de la imagen (o ruta, para el script).
 * @param {object}   [opciones]
 * @param {string}   [opciones.kicker="EDICIÓN DIARIA"]  Antetítulo rojo. Cabe
 *   holgado hasta ~14 caracteres; más largo choca con "cochedeldia.com".
 * @returns {Promise<Buffer>} JPEG 1200×630.
 */
export async function componerTarjetaOG(foto, { kicker = "EDICIÓN DIARIA" } = {}) {
  // 1) Papel a sangre: el lienzo base es color plano, no la foto.
  const papel = await sharp({
    create: { width: W, height: H, channels: 3, background: PAPEL },
  })
    .png()
    .toBuffer();

  // 2) El fotograbado.
  const grabado = await procesarFoto(foto);

  // 3) Foto primero, tipografía después: así el filete de separación cae
  //    limpio sobre el borde del grabado.
  return sharp(papel)
    .composite([
      { input: grabado, top: 0, left: FOTO_X },
      { input: Buffer.from(construirOverlay(kicker)), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
