// scripts/generate-og-image.mjs
//
// Genera public/og-image.jpg (1200×630): el RESPALDO estático de la tarjeta
// Open Graph.
//
// Ya no es la tarjeta que se publica. Desde jul-2026 el og:image apunta a
// /api/og-image, que compone la misma portada con el recorte del coche de HOY
// (ver api/og-image.js). Este fichero sigue existiendo porque ese endpoint cae
// aquí ante cualquier fallo —Supabase caído, CDN sin responder, sharp
// petardeando— y un preview genérico es infinitamente mejor que un enlace sin
// preview, que en un chat parece un enlace roto.
//
// La COMPOSICIÓN vive en api/_lib/og-card.js, compartida con el endpoint: si se
// rediseña la tarjeta, se rediseña en un solo sitio y el respaldo no se queda
// con la piel antigua. Aquí solo queda elegir la foto base y dónde escribir.
//
// Uso:
//   node scripts/generate-og-image.mjs
//
// Idempotente: sobrescribe el output cada vez. Versiona el archivo generado
// (public/og-image.jpg) en git — es un respaldo, tiene que estar desplegado
// aunque nadie regenere nada.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { componerTarjetaOG, W, H } from "../api/_lib/og-card.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE = resolve(ROOT, "public/splash-car.jpg");
const OUT = resolve(ROOT, "public/og-image.jpg");

async function generate() {
  // Sin `kicker`: el respaldo se queda con el "EDICIÓN DIARIA" genérico. La
  // fecha solo la pone la tarjeta viva, que es la única que sabe de qué día
  // está hablando.
  const tarjeta = await componerTarjetaOG(BASE);
  await writeFile(OUT, tarjeta);
  console.log(`✓ Generada ${OUT} (${W}×${H})`);
}

generate().catch((err) => {
  console.error("[og-image] ERROR:", err);
  process.exit(1);
});
