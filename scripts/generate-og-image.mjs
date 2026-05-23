// scripts/generate-og-image.mjs
//
// Genera public/og-image.jpg (1200×630) para los previews de Open Graph /
// Twitter Card cuando alguien comparte un enlace de carguessr.org.
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

// SVG overlay con el branding. Lo componemos sobre la imagen base
// redimensionada + oscurecida. Importante: lleva un rect oscuro
// semi-transparente para garantizar contraste del texto sobre cualquier
// imagen de fondo (no dependemos de que splash-car tenga la zona del
// texto oscura por suerte).
const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="darken" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG}" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="${BG}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0.95"/>
    </linearGradient>
  </defs>

  <!-- Oscurecido vertical para legibilidad del texto inferior -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#darken)"/>

  <!-- Marca CARGUESSR centrada — Impact/Arial Black simula Bebas Neue.
       letter-spacing en SVG va con kerning, simulado con "tspan" + dx. -->
  <text x="${W / 2}" y="${H / 2 - 30}"
        font-family="'Impact', 'Arial Black', 'Helvetica', sans-serif"
        font-size="140"
        fill="#ffffff"
        text-anchor="middle"
        letter-spacing="18"
        font-weight="900">
    CARGUESSR
  </text>

  <!-- Línea dorada bajo el logo — mismo motif que el header -->
  <rect x="${W / 2 - 70}" y="${H / 2 + 8}" width="140" height="3" rx="1.5" fill="${ACCENT}"/>

  <!-- Tagline en gold -->
  <text x="${W / 2}" y="${H / 2 + 70}"
        font-family="'Helvetica Neue', 'Arial', sans-serif"
        font-size="36"
        fill="${ACCENT}"
        text-anchor="middle"
        letter-spacing="6"
        font-weight="500">
    EL RETO DIARIO DE COCHES
  </text>

  <!-- Subtítulo muted -->
  <text x="${W / 2}" y="${H / 2 + 120}"
        font-family="'Helvetica Neue', 'Arial', sans-serif"
        font-size="24"
        fill="${MUTED}"
        text-anchor="middle"
        letter-spacing="2">
    Adivina marca, modelo y año en 5 intentos
  </text>

  <!-- Dominio abajo a la derecha como sello -->
  <text x="${W - 40}" y="${H - 30}"
        font-family="'Helvetica Neue', 'Arial', sans-serif"
        font-size="22"
        fill="${ACCENT}"
        text-anchor="end"
        letter-spacing="4"
        font-weight="600">
    CARGUESSR.ORG
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
