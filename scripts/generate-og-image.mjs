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
// Diseño:
//   - Fondo: splash-car.jpg redimensionado + oscurecido para legibilidad.
//   - Overlay: capa SVG con título en grande, línea dorada de acento
//     (el mismo motif que usamos en el header), tagline y dominio.
//   - Fuentes: stack system (Impact / Arial Black) en lugar de Bebas
//     Neue para no depender de internet ni de fuentes embebidas.
//     El visual es similar — condensed sans-serif con letter-spacing.
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
const ACCENT = "#e8c87a";
const MUTED = "#9a9aab";
const BG = "#0a0a0b";

// SVG overlay con el branding. Decisiones tipográficas:
//   • `serif` y `sans-serif` genéricos: Fontconfig en el entorno de
//     build de Vercel (Linux) mapea esto a DejaVu Serif / DejaVu Sans
//     respectivamente. Evitamos referenciar 'Impact' o 'Helvetica Neue'
//     que NO están instalados — el fallback silencioso de DejaVu era el
//     que daba el look "tosco" del v1.
//   • Wordmark en serif: editorial, premium, energía Top Gear / Octane.
//     Resta peso y deja respirar la foto del coche en lugar de
//     aplastarla con un block negro tipo Impact.
//   • Tagline + dominio en sans tracked-out: energía badge automotive
//     (Mercedes-AMG, BMW Individual).
const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG}" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="${BG}" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0.92"/>
    </linearGradient>
    <!-- Vignette radial para acentuar el centro y oscurecer esquinas:
         ayuda a que el ojo aterrice en el wordmark. -->
    <radialGradient id="vignette" cx="50%" cy="50%" r="75%">
      <stop offset="55%" stop-color="${BG}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0.55"/>
    </radialGradient>
  </defs>

  <!-- Capas de oscurecido -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#darken)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vignette)"/>

  <!-- Tagline superior, micro-cabecera estilo masthead de revista -->
  <text x="${W / 2}" y="155"
        font-family="sans-serif"
        font-size="20"
        fill="${ACCENT}"
        text-anchor="middle"
        letter-spacing="14"
        font-weight="500">
    EL RETO DIARIO DE COCHES
  </text>

  <!-- Hairline dorado entre tagline y wordmark, sutil y simétrico -->
  <line x1="${W / 2 - 230}" y1="180" x2="${W / 2 - 80}" y2="180"
        stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.55"/>
  <line x1="${W / 2 + 80}" y1="180" x2="${W / 2 + 230}" y2="180"
        stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.55"/>

  <!-- WORDMARK: "El Coche del Día" en serif, una sola línea.
       Sentence case + serif = identidad editorial premium. La longitud
       (16 chars) cabe perfectamente en serif a este tamaño sin
       sentirse aplastado. -->
  <text x="${W / 2}" y="${H / 2 + 30}"
        font-family="serif"
        font-size="105"
        fill="#f4f1ea"
        text-anchor="middle"
        letter-spacing="2"
        font-weight="400">
    El Coche del Día
  </text>

  <!-- Línea dorada bajo el wordmark — el mismo motif del header histórico -->
  <rect x="${W / 2 - 65}" y="${H / 2 + 70}" width="130" height="2" rx="1" fill="${ACCENT}"/>

  <!-- Subtítulo descriptivo -->
  <text x="${W / 2}" y="${H / 2 + 125}"
        font-family="sans-serif"
        font-size="22"
        fill="${MUTED}"
        text-anchor="middle"
        letter-spacing="3"
        font-weight="400">
    Adivina marca, modelo y año en 5 intentos
  </text>

  <!-- Dominio inferior — pequeño y discreto, no compite con el wordmark.
       Centrado abajo para simetría editorial; tracked-out para
       lectura como inscripción. -->
  <text x="${W / 2}" y="${H - 50}"
        font-family="sans-serif"
        font-size="18"
        fill="${ACCENT}"
        text-anchor="middle"
        letter-spacing="8"
        font-weight="600">
    cochedeldia.com
  </text>
</svg>`;

async function generate() {
  // 1) Imagen base: redimensiona splash-car.jpg a 1200×630 con cover
  //    (recorta lo que sobre, sin deformar).
  const base = await sharp(BASE)
    .resize(W, H, { fit: "cover", position: "center" })
    .toBuffer();

  // 2) Composita el overlay SVG encima.
  await sharp(base)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(OUT);

  console.log(`✓ Generada ${OUT} (${W}×${H})`);
}

generate().catch((err) => {
  console.error("[og-image] ERROR:", err);
  process.exit(1);
});
