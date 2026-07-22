// scripts/gen-store-graphics.mjs
//
// Genera el «gráfico de funciones» (feature graphic) de la ficha de Google Play:
// assets/play-feature-graphic.png, 1024×500.
//
// Requisitos de Play Console: 1024×500 exactos, PNG o JPEG, SIN canal alfa,
// máximo 15 MB. Aquí se emite PNG aplanado sobre el papel (sin alfa) para no
// depender de la compresión con pérdida en un gráfico de tinta plana, donde el
// JPEG ensucia los bordes duros del filete.
//
// Diseño — mismo sistema que el icono y el OG («Prensa del motor»):
//   - Composición CENTRADA a propósito. Play recorta el gráfico en varias
//     superficies (y le superpone el botón de play si hay vídeo promocional),
//     así que nada importante toca los bordes: todo vive en la banda central.
//   - Sin texto pequeño. El gráfico se muestra escalado a anchos muy distintos;
//     lo único legible garantizado es el wordmark, así que el resto es
//     jerarquía visual, no información.
//   - La silueta se reutiliza del MÁSTER de marca, no se redibuja: si algún día
//     cambia el logo, este gráfico lo hereda al reejecutar el script.
//
// Fuentes: mismas pilas explícitas que generate-og-image.mjs, y por el mismo
// motivo (el genérico `serif` cae en una monoespaciada al pedir bold).
//
// Uso:  node scripts/gen-store-graphics.mjs

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MASTER = resolve(ROOT, "assets/brand-logo-source.png");
const OUT = resolve(ROOT, "assets/play-feature-graphic.png");

const W = 1024;
const H = 500;

// Paleta = tokens del tema día (src/index.css).
const PAPEL = "#f3eee1";
const TINTA = "#1b1712";
const TINTA2 = "#6e6553";
const ROJO = "#b3271b";

const SERIF = "Georgia, 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "Arial, 'DejaVu Sans', Helvetica, sans-serif";

const MARGEN = 92; // filetes de encuadre, holgados: Play recorta por los lados
const COCHE_ANCHO = 340;

async function main() {
  // 1) Silueta sola: el máster trae coche + filete rojo; nos quedamos con la
  //    tinta (descartando el rojo) y recortamos al contenido con trim().
  const { data, info } = await sharp(MASTER)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  const soloTinta = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const s = i * 4;
    const r = data[s], g = data[s + 1], b = data[s + 2], a = data[s + 3];
    // El filete es rojo saturado; la carrocería es tinta neutra.
    const esRojo = r - g > 40 && r - b > 40;
    const d = i * 4;
    soloTinta[d] = r;
    soloTinta[d + 1] = g;
    soloTinta[d + 2] = b;
    soloTinta[d + 3] = esRojo ? 0 : a;
  }

  const coche = await sharp(soloTinta, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim()
    .resize({ width: COCHE_ANCHO })
    .png()
    .toBuffer();
  const cocheMeta = await sharp(coche).metadata();

  // 2) Retícula vertical. Se calcula de arriba abajo con el alto real de la
  //    silueta, para que el bloque quede ópticamente centrado sin números
  //    mágicos si algún día cambia la proporción del logo.
  const yCoche = 96;
  const yWordmark = yCoche + cocheMeta.height + 84; // línea base del titular
  const yFilete1 = yWordmark + 30;
  const yFilete2 = yFilete1 + 12;
  const yLema = yFilete2 + 46;

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${PAPEL}"/>

    <!-- Filetes de encuadre: la caja del pliego. -->
    <rect x="${MARGEN}" y="46" width="${W - MARGEN * 2}" height="3" fill="${TINTA}"/>
    <rect x="${MARGEN}" y="53" width="${W - MARGEN * 2}" height="1" fill="${TINTA}"/>
    <rect x="${MARGEN}" y="${H - 54}" width="${W - MARGEN * 2}" height="1" fill="${TINTA}"/>
    <rect x="${MARGEN}" y="${H - 49}" width="${W - MARGEN * 2}" height="3" fill="${TINTA}"/>

    <!-- Wordmark: única pieza que se garantiza legible a cualquier escala. -->
    <text x="${W / 2}" y="${yWordmark}" text-anchor="middle"
          font-family="${SERIF}" font-size="62" font-weight="700"
          fill="${TINTA}" letter-spacing="-1">El Coche del Día</text>

    <!-- Filete doble rojo: el acento único, igual que en el icono. -->
    <rect x="${W / 2 - 210}" y="${yFilete1}" width="420" height="4" fill="${ROJO}"/>
    <rect x="${W / 2 - 210}" y="${yFilete2}" width="420" height="2" fill="${ROJO}"/>

    <text x="${W / 2}" y="${yLema}" text-anchor="middle"
          font-family="${SANS}" font-size="21" letter-spacing="3"
          fill="${TINTA2}">MARCA · MODELO · AÑO EN CINCO INTENTOS</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: coche, top: yCoche, left: Math.round((W - COCHE_ANCHO) / 2) }])
    // flatten() deja la imagen opaca pero MANTIENE el canal alfa (PNG de 32
    // bits con alfa a 255). Play lo rechaza igual, así que hay que quitarlo.
    .flatten({ background: PAPEL })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  const m = await sharp(OUT).metadata();
  const s = await sharp(OUT).stats();
  console.log(`✓ ${OUT}`);
  console.log(`  ${m.width}×${m.height} | alfa: ${m.hasAlpha} | opaco: ${s.isOpaque}`);
  if (m.width !== 1024 || m.height !== 500 || m.hasAlpha) {
    console.error("  ⚠ NO cumple los requisitos de Play Console");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[store-graphics] ERROR:", err);
  process.exit(1);
});
