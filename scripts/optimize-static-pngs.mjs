// scripts/optimize-static-pngs.mjs
// Optimización one-shot de los PNG estáticos servidos desde public/:
// logos de marca (public/brands) e insignias de logros (public/achievements).
//
// Por qué: eran renders fuente desproporcionados (insignias de 2 MB, logos de
// ~1.9 MB) que se muestran como chips/badges de ~128 px como mucho. Se
// empaquetaban tal cual en el build y en el APK. Aquí los recomprimimos:
//   - resize al lado mayor MAX_DIM (retina holgada para el tamaño de pantalla)
//   - cuantización de paleta (libimagequant) → recorte brutal manteniendo alfa
// Idempotente: withoutEnlargement evita reescalar hacia arriba si se re-ejecuta.

import sharp from "sharp";
import { readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const MAX_DIM = 512; // lado mayor; los badges/logos se ven a <=128 px
const DIRS = ["public/brands", "public/achievements"];

let beforeTotal = 0;
let afterTotal = 0;

for (const dir of DIRS) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".png"));
  for (const file of files) {
    const path = join(dir, file);
    const before = statSync(path).size;
    beforeTotal += before;
    // toBuffer primero: no podemos escribir el mismo fichero mientras sharp lo lee.
    const out = await sharp(path)
      .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer();
    // Guard: si el original ya pesaba menos (PNG pequeño ya optimizado), la
    // cuantización solo añade overhead. Conservamos siempre el menor.
    if (out.length >= before) {
      afterTotal += before;
      console.log(
        `${(before / 1024).toFixed(0).padStart(5)} KB  (sin cambio, ya óptimo)  ${path}`
      );
      continue;
    }
    writeFileSync(path, out);
    afterTotal += out.length;
    const pct = ((1 - out.length / before) * 100).toFixed(0);
    console.log(
      `${(before / 1024).toFixed(0).padStart(5)} KB -> ${(out.length / 1024)
        .toFixed(0)
        .padStart(5)} KB  (-${pct}%)  ${path}`
    );
  }
}

console.log(
  `\nTOTAL: ${(beforeTotal / 1024 / 1024).toFixed(1)} MB -> ${(
    afterTotal /
    1024 /
    1024
  ).toFixed(1)} MB  (-${((1 - afterTotal / beforeTotal) * 100).toFixed(0)}%)`
);
