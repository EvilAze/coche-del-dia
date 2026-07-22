#!/usr/bin/env node
/**
 * Guardarraíl de peso del bundle web (y por tanto del APK/AAB de Capacitor).
 *
 * Por qué existe: la v1.0 publicada en Play pesaba ~400 MB. La causa no fue un
 * cambio de código sino `public/coches/` — 185 JPGs de 366 MB que vivían en el
 * disco de la máquina de build SIN estar en git (untracked primero, ignorados
 * después). Vite copia `public/` entero al `build/`, y `cap sync` copia el
 * `build/` entero a `android/app/src/main/assets/public`. Resultado: peso
 * muerto invisible en el diff, invisible en `git status` y solo detectable
 * mirando el .aab ya subido.
 *
 * Este script corre dentro de `npm run cap:sync`, entre el `vite build` y el
 * `cap sync`, para que el fallo salte ANTES de empaquetar y no después de
 * subirlo a Play. Falla en dos frentes:
 *
 *   1. Presupuesto: `build/` no puede pasar de MAX_BUILD_MB, ni ningún fichero
 *      suelto de MAX_FILE_KB.
 *   2. Origen: cualquier ruta dentro de `public/` que git no siga (untracked o
 *      ignorada) y ocupe más de MAX_UNTRACKED_KB se reporta, porque es justo el
 *      patrón que se nos coló.
 *
 * Es intencionadamente de coste cero (sin deps, sin red) para que nadie tenga
 * la tentación de saltárselo.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_DIR = join(ROOT, "build");
const PUBLIC_DIR = join(ROOT, "public");

// Presupuestos. El build sano ronda 2,5-4 MB; 12 MB deja margen de sobra para
// crecer sin dejar pasar un desastre de tres cifras.
const MAX_BUILD_MB = 12;
// Tope por fichero, solo para estáticos (imágenes, vídeo, fuentes). Ningún
// recurso empaquetado debería pesar tanto: las fotos de coches van por CDN vía
// /api/daily-image, nunca dentro del APK. El JS/CSS queda fuera de esta regla a
// propósito — su crecimiento ya lo vigila el presupuesto global y los chunks de
// Vite pasan de 500 KB con normalidad.
const MAX_FILE_KB = 500;
const ESTATICOS = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|svg|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|zip|pdf)$/i;
// Umbral para chivarse de material no versionado dentro de public/.
const MAX_UNTRACKED_KB = 250;

/** Recorre un directorio y devuelve [{ path, bytes }] de todos sus ficheros. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push({ path: full, bytes: statSync(full).size });
  }
  return out;
}

/** Tamaño de una ruta, sea fichero o directorio. */
function sizeOf(path) {
  const st = statSync(path);
  return st.isDirectory() ? walk(path).reduce((n, f) => n + f.bytes, 0) : st.size;
}

/**
 * Rutas de public/ que git no versiona: untracked e ignoradas. `--directory`
 * colapsa una carpeta entera en una sola línea, que es como se vería el caso
 * `public/coches/` en vez de 185 entradas.
 */
function gitUnversionedInPublic() {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      // Sin git (CI de Vercel con checkout superficial, tarball…) el guardarraíl
      // de presupuesto sigue valiendo; este chequeo simplemente no aplica.
      return [];
    }
  };
  return [
    ...run(["ls-files", "--others", "--exclude-standard", "--directory", "public"]),
    ...run(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "public"]),
  ];
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const kb = (bytes) => (bytes / 1024).toFixed(0);

if (!existsSync(BUILD_DIR)) {
  console.error("✖ No existe build/. Ejecuta `vite build` antes de comprobar el tamaño.");
  process.exit(1);
}

const errors = [];
const files = walk(BUILD_DIR);
const total = files.reduce((n, f) => n + f.bytes, 0);

if (total > MAX_BUILD_MB * 1024 * 1024) {
  errors.push(`build/ pesa ${mb(total)} MB y el máximo es ${MAX_BUILD_MB} MB.`);
}

const heavy = files
  .filter((f) => ESTATICOS.test(f.path) && f.bytes > MAX_FILE_KB * 1024)
  .sort((a, b) => b.bytes - a.bytes);
if (heavy.length) {
  errors.push(
    `${heavy.length} estático(s) superan ${MAX_FILE_KB} KB:\n` +
      heavy.map((f) => `      ${kb(f.bytes)} KB  ${relative(ROOT, f.path).split(sep).join("/")}`).join("\n")
  );
}

if (existsSync(PUBLIC_DIR)) {
  const sospechosas = gitUnversionedInPublic()
    .map((p) => join(ROOT, p))
    .filter(existsSync)
    .map((p) => ({ path: p, bytes: sizeOf(p) }))
    .filter((e) => e.bytes > MAX_UNTRACKED_KB * 1024)
    .sort((a, b) => b.bytes - a.bytes);
  if (sospechosas.length) {
    errors.push(
      "public/ contiene material pesado que git NO versiona; Vite lo empaqueta igual:\n" +
        sospechosas
          .map((e) => `      ${mb(e.bytes)} MB  ${relative(ROOT, e.path).split(sep).join("/")}`)
          .join("\n") +
        "\n      Bórralo del disco de build o muévelo fuera de public/."
    );
  }
}

if (errors.length) {
  console.error("\n✖ El bundle no pasa el presupuesto de tamaño:\n");
  for (const e of errors) console.error(`  · ${e}`);
  console.error(
    `\n  Recuerda: todo lo que hay en build/ acaba dentro del APK/AAB.\n` +
      `  Ajusta los límites en scripts/check-bundle-size.mjs solo si el crecimiento es intencionado.\n`
  );
  process.exit(1);
}

console.log(
  `✔ build/ = ${mb(total)} MB en ${files.length} ficheros ` +
    `(límite ${MAX_BUILD_MB} MB, fichero mayor ${kb(Math.max(...files.map((f) => f.bytes)))} KB).`
);
