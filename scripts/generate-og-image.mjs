// scripts/generate-og-image.mjs
//
// Pre-renderiza las dos piezas fijas de la tarjeta Open Graph. **Hay que
// ejecutarlo en una máquina con fuentes de verdad** (tu portátil), nunca
// confiando en que las tenga el servidor — que fue exactamente el fallo que
// sacó la tarjeta con las letras convertidas en cajitas. Ver la nota larga de
// api/_lib/og-card.js.
//
// Produce:
//   1. api/_lib/og-overlay.js  → la CAPA FIJA (wordmark, filetes, lema,
//      dominio) rasterizada a PNG con transparencia donde va la foto, embebida
//      en base64. La usa api/og-image.js en cada petición para componer la
//      tarjeta viva sin dibujar una sola letra en el servidor.
//   2. public/og-image.jpg     → el RESPALDO estático completo, con la foto de
//      splash. /api/og-image cae aquí con un 302 ante cualquier fallo
//      (regla 9): un preview genérico es mejor que un enlace sin preview, que
//      en un chat parece roto.
//
// Va en base64 dentro de un módulo JS y no como fichero suelto a propósito: el
// empaquetado de funciones de Vercel sigue los imports, no los assets, así que
// un .png en el árbol podría no viajar con la función. Un módulo importado
// viaja siempre. El coste son unos KB en el bundle; la alternativa es un fallo
// silencioso en producción, que es justo lo que estamos arreglando.
//
// Uso:
//   npm run og:build
//
// Idempotente. Ambos artefactos se versionan en git.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  construirOverlaySvg,
  construirMarcadorSvg,
  CLAVES_MARCADOR,
  W,
  H,
} from "../api/_lib/og-card.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = resolve(ROOT, "public/splash-car.jpg");
const OUT_OVERLAY = resolve(ROOT, "api/_lib/og-overlay.js");
const OUT_JPG = resolve(ROOT, "public/og-image.jpg");

async function generate() {
  // 1) La capa fija. Rasterizamos el SVG AQUÍ, donde hay fuentes.
  const png = await sharp(Buffer.from(construirOverlaySvg()))
    .png({ compressionLevel: 9 })
    .toBuffer();

  // 1.bis) Los seis marcadores posibles (1/5…5/5 y X/5). Van pre-renderizados
  //        por lo mismo que la capa base: en el servidor no hay fuentes. Son
  //        diminutos y evitan tener que dibujar texto en producción.
  const marcadores = {};
  for (const clave of CLAVES_MARCADOR) {
    const buf = await sharp(Buffer.from(construirMarcadorSvg(clave)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    marcadores[clave] = buf.toString("base64");
  }
  const pesoMarcadores = Object.values(marcadores).reduce((n, b) => n + b.length, 0);

  const modulo = `// api/_lib/og-overlay.js
// GENERADO — no editar a mano. Se regenera con: npm run og:build
//
// La capa fija de la tarjeta Open Graph (${W}×${H}), ya rasterizada: wordmark,
// filetes, lema y dominio, con el hueco de la foto transparente. Y los seis
// marcadores posibles (1/5…5/5, X/5). Todo viene en píxeles y no en SVG porque
// el runtime de Vercel no tiene fuentes y dibujar texto allí produce tofu. El
// porqué completo, en api/_lib/og-card.js.
export const OVERLAY_PNG_BASE64 =
  "${png.toString("base64")}";

export const MARCADORES_BASE64 = {
${CLAVES_MARCADOR.map((k) => `  "${k}":\n    "${marcadores[k]}",`).join("\n")}
};
`;
  await writeFile(OUT_OVERLAY, modulo, "utf8");
  console.log(
    `✓ ${OUT_OVERLAY} (capa ${Math.round(png.length / 1024)} KB + ` +
      `${CLAVES_MARCADOR.length} marcadores, ${Math.round(pesoMarcadores / 1024)} KB en base64)`
  );

  // 2) El respaldo estático completo, compuesto con la misma función que usa
  //    el endpoint — así el respaldo no puede quedarse con una piel antigua.
  //
  //    Import DINÁMICO y con cache-buster a propósito: og-card.js importa la
  //    capa que acabamos de reescribir dos líneas más arriba, y un import
  //    estático se habría resuelto al arrancar el script, con la capa VIEJA.
  //    El respaldo saldría con el diseño anterior y nadie lo notaría hasta que
  //    fallara el endpoint, que es el peor momento para descubrirlo.
  const { componerTarjetaOG } = await import(`../api/_lib/og-card.js?v=${Date.now()}`);
  const tarjeta = await componerTarjetaOG(BASE);
  await writeFile(OUT_JPG, tarjeta);
  console.log(`✓ ${OUT_JPG} (${W}×${H})`);
}

generate().catch((err) => {
  console.error("[og-image] ERROR:", err);
  process.exit(1);
});
