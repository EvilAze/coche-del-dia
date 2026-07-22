// scripts/gen-brand-master.mjs
//
// Construye el MÁSTER de marca (assets/brand-logo-source.png, 2048×2048 RGBA)
// a partir del raster crudo del logo. Es el paso 0 de la cadena de iconos:
//
//   raster crudo → [este script] → assets/brand-logo-source.png
//                                     ├→ scripts/gen-favicons.mjs   (web/PWA)
//                                     └→ scripts/gen-cap-assets.js  (app Android)
//
// Por qué hace falta un paso intermedio y no vale el raster tal cual:
//
//   1. El raster viene con FONDO CREMA opaco. El máster tiene que ser
//      transparente: el icono adaptativo de Android es foreground + color de
//      fondo en capas separadas, y gen-favicons.mjs compone el papel él mismo.
//      Se recorta el alfa por luminancia (el crema se va, la tinta se queda),
//      lo que además deja huecos limpios en ventanillas y centros de rueda.
//
//   2. El encuadre del raster es APAISADO (el dibujo ocupaba una banda central
//      ~2.4:1). Un icono es cuadrado: hay que recomponer el bloque centrado y
//      a un tamaño que respete la zona de seguridad del `maskable`.
//
//   3. Los FILETES del raster eran demasiado finos: por debajo de ~32px se
//      evaporaban. Aquí se redibujan en vector, con el peso controlado y las
//      proporciones del `3px double` de .prensa-folio (src/index.css).
//
//   4. El generador de imágenes estampa su marca de agua en una esquina. Al
//      recortar por el bounding box de la tinta se queda fuera por completo.
//
// Degradación asumida: a 16×16 (solo el favicon.ico legacy) el filete doble se
// funde en una sola línea. Es inevitable —a ese tamaño el icono ENTERO son 16
// píxeles— y es un degradado honesto: sigue leyéndose "coche sobre una raya".
// Los consumidores modernos tiran del PNG de 96 en adelante, donde sí se ve.
//
// El raster crudo NO se versiona (son ~5 MB y el repo ya purgó las imágenes
// fuente legacy por peso: ver commit 59e708e). El artefacto versionado es el
// máster que sale de aquí. Guarda el crudo donde quieras y pásale la ruta.
//
// Uso:  node scripts/gen-brand-master.mjs <ruta-al-raster>

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = process.argv[2] || resolve(ROOT, "assets/brand-logo-raw.png");
const OUT = resolve(ROOT, "assets/brand-logo-source.png");

const LIENZO = 2048;

// Recorte de la tinta en el raster de origen, medido sobre el propio archivo
// (bounding box de los píxeles oscuros). Si cambias el raster, vuelve a medirlo.
const CROP = { left: 265, top: 726, width: 1518, height: 516 };

// Knockout por luminancia: el crema del raster es el punto transparente y la
// tinta el opaco. Se toman con holgura para que el antialias del borde caiga
// dentro del rango y no queden dientes de sierra.
const LUM_FONDO = 232; // ≈ rgb(240,232,208), el crema medido
const LUM_TINTA = 30; // el negro-marrón del dibujo

// Paleta = tokens del tema día (src/index.css).
const TINTA = { r: 0x1b, g: 0x17, b: 0x12 };
const ROJO = "#b3271b";

// Geometría del bloque. El ancho del 73% NO es estético: es el máximo que cabe
// dentro del círculo de seguridad del 80% que exige `purpose: "maskable"`. Con
// un bloque apaisado manda la DIAGONAL, no el ancho — a 80% las esquinas se
// salían y el launcher recortaba el morro del coche.
const ANCHO = Math.round(LIENZO * 0.73);
const HUECO_COCHE_FILETE = 44;
const FILETE_GRUESO = 44;
const HUECO_FILETES = 38;
const FILETE_FINO = 18;

async function main() {
  // 1) Recorte de la tinta y knockout del fondo. Se recolorea TODO a la tinta
  //    del tema: el raster venía un pelo desviado y así el icono usa el mismo
  //    negro exacto que el resto del sitio.
  const { data, info } = await sharp(SRC)
    .extract(CROP)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = info.width * info.height;
  const rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const s = i * info.channels;
    const lum = 0.299 * data[s] + 0.587 * data[s + 1] + 0.114 * data[s + 2];
    // Regla de tres invertida: fondo → alfa 0, tinta → alfa 255.
    let a = ((LUM_FONDO - lum) / (LUM_FONDO - LUM_TINTA)) * 255;
    a = a < 0 ? 0 : a > 255 ? 255 : a;
    const d = i * 4;
    rgba[d] = TINTA.r;
    rgba[d + 1] = TINTA.g;
    rgba[d + 2] = TINTA.b;
    rgba[d + 3] = Math.round(a);
  }

  const alto = Math.round((CROP.height / CROP.width) * ANCHO);
  const coche = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(ANCHO, alto)
    .png()
    .toBuffer();

  // 2) Filetes en vector, con las proporciones del folio del sitio.
  const bloque =
    alto + HUECO_COCHE_FILETE + FILETE_GRUESO + HUECO_FILETES + FILETE_FINO;
  const x = Math.round((LIENZO - ANCHO) / 2);
  const y = Math.round((LIENZO - bloque) / 2);
  const yF1 = y + alto + HUECO_COCHE_FILETE;
  const yF2 = yF1 + FILETE_GRUESO + HUECO_FILETES;

  const filetes = `<svg width="${LIENZO}" height="${LIENZO}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${x}" y="${yF1}" width="${ANCHO}" height="${FILETE_GRUESO}" fill="${ROJO}"/>
    <rect x="${x}" y="${yF2}" width="${ANCHO}" height="${FILETE_FINO}" fill="${ROJO}"/>
  </svg>`;

  await sharp({
    create: {
      width: LIENZO,
      height: LIENZO,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: coche, top: y, left: x },
      { input: Buffer.from(filetes), top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  // Comprobación de la zona de seguridad: si el bloque se sale del círculo del
  // 80%, el launcher recortará el dibujo. Avisa en vez de fallar en silencio.
  const semiDiag = Math.hypot(ANCHO / 2, bloque / 2);
  const radioSeguro = LIENZO * 0.4;
  console.log(`✓ ${OUT} (${LIENZO}×${LIENZO})`);
  console.log(`  bloque: ${ANCHO}×${bloque} px`);
  console.log(
    `  semidiagonal ${Math.round(semiDiag)} / radio seguro ${radioSeguro} → ${
      semiDiag <= radioSeguro ? "OK maskable" : "⚠ SE SALE del área segura"
    }`
  );
}

main().catch((err) => {
  console.error("[gen-brand-master] ERROR:", err);
  process.exit(1);
});
