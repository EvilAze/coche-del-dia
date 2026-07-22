// scripts/generate-og-image.mjs
//
// Genera public/og-image.jpg (1200×630) para los previews de Open Graph /
// Twitter Card cuando alguien comparte un enlace de cochedeldia.com.
//
// Por qué 1200×630:
//   - Facebook / WhatsApp recomienda mínimo 1200×630. Por debajo lo
//     muestran chico y pixelado.
//   - Twitter (X) usa 1200×600 para summary_large_image; ese mismo
//     1200×630 lo recorta sin pérdida visible.
//   - LinkedIn / Discord usan el mismo estándar OG.
//
// Diseño — «Prensa del motor» (antes: foto oscurecida + wordmark dorado, la
// estética «Platino Eléctrico» que la web ya no usa):
//   - Papel #f3eee1 a sangre, tinta #1b1712, un solo acento rojo #b3271b.
//     Mismos tokens que src/index.css, para que el preview compartido y la
//     portada real sean reconociblemente la misma publicación.
//   - Composición a dos cuerpos: masthead a la izquierda, foto A SANGRE a la
//     derecha — el mismo gesto que la portada del juego.
//   - La foto va en duotono sobre papel (gris + tinte cálido), no a color:
//     una foto a todo color sobre crema canta a plantilla; el duotono la
//     integra como un fotograbado de periódico.
//   - Filetes dobles arriba y bajo el wordmark: el motif de .prensa-folio.
//
// Fuentes: pilas EXPLÍCITAS, nunca el genérico `serif`/`sans-serif` a secas.
// El genérico parecía funcionar pero en bold caía en una monoespaciada (el
// wordmark salía tipo terminal), porque librsvg resuelve `serif` por fontconfig
// y en Windows no encuentra una serif bold que le valga. Georgia (Windows/Mac)
// y DejaVu Serif (Linux/Vercel) cubren los dos entornos donde alguien puede
// regenerar esto. NO referenciamos 'Fraunces' ni 'Libre Franklin' (las reales
// del sitio): no están instaladas en ningún entorno de build y el fallback
// silencioso da un resultado peor que elegir la sustituta a sabiendas.
//
// Uso:
//   node scripts/generate-og-image.mjs
//
// Idempotente: sobrescribe el output cada vez. Versiona el archivo
// generado (`public/og-image.jpg`) en git: los CDN cachean por URL,
// no necesitamos regenerar en cada deploy.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = resolve(ROOT, "public/splash-car.jpg");
const OUT = resolve(ROOT, "public/og-image.jpg");

const W = 1200;
const H = 630;

// Paleta = tokens del tema día (src/index.css). No inventar hex aquí.
const PAPEL = "#f3eee1";
const TINTA = "#1b1712";
const TINTA2 = "#6e6553";
const ROJO = "#b3271b";

// Reparto horizontal: la foto ocupa el tercio derecho a sangre; el masthead
// respira en los 720px restantes. El filete vertical los separa.
const FOTO_X = 760;
const FOTO_W = W - FOTO_X;
const MARGEN = 64;

// Pilas tipográficas (ver cabecera): primero la de Windows/Mac, luego la de
// Linux, y el genérico solo como último recurso.
const SERIF = "Georgia, 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "Arial, 'DejaVu Sans', Helvetica, sans-serif";

// Overlay SVG: filetes + tipografía. Se pinta DESPUÉS de la foto, así el
// filete de separación cae limpio sobre el borde del fotograbado.
const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Filete doble superior (motif de .prensa-folio: 3px double). -->
  <rect x="${MARGEN}" y="86" width="${FOTO_X - MARGEN * 2}" height="3" fill="${TINTA}"/>
  <rect x="${MARGEN}" y="93" width="${FOTO_X - MARGEN * 2}" height="1" fill="${TINTA}"/>

  <!-- Antetítulo: el folio de la edición, en rojo como .prensa-folio .rojo -->
  <text x="${MARGEN}" y="134"
        font-family="${SANS}" font-size="19" font-weight="700"
        fill="${ROJO}" letter-spacing="7">EDICIÓN DIARIA</text>
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

async function generate() {
  // 1) Papel a sangre: el lienzo base es color plano, no la foto.
  const papel = await sharp({
    create: { width: W, height: H, channels: 3, background: PAPEL },
  })
    .png()
    .toBuffer();

  // 2) Fotograbado: la foto en duotono cálido. grayscale() quita el color,
  //    linear() abre el contraste Y BAJA el punto blanco (el desplazamiento
  //    negativo): sin eso, un coche claro sobre cielo claro se quemaba contra
  //    el crema y la foto se leía como una mancha pálida. tint() la reencaja
  //    en la gama del papel. El orden importa: tint sobre una imagen aún en
  //    color daría un viraje sucio.
  const foto = await sharp(BASE)
    .resize(FOTO_W, H, { fit: "cover", position: "center" })
    .grayscale()
    .linear(1.26, -42)
    .tint({ r: 226, g: 214, b: 190 })
    .toBuffer();

  // 3) Foto primero, tipografía después.
  await sharp(papel)
    .composite([
      { input: foto, top: 0, left: FOTO_X },
      { input: Buffer.from(overlay), top: 0, left: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(OUT);

  console.log(`✓ Generada ${OUT} (${W}×${H})`);
}

generate().catch((err) => {
  console.error("[og-image] ERROR:", err);
  process.exit(1);
});
