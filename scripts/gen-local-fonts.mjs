#!/usr/bin/env node
/**
 * Descarga las fuentes de Google Fonts y las deja auto-hospedadas.
 *
 *   Google Fonts CSS  ->  public/fonts/*.woff2  +  src/fonts.css
 *
 * Por qué auto-hospedarlas:
 *   La app Android empaqueta TODO el HTML/JS/CSS… y luego pedía la tipografía
 *   por red. Primer arranque sin cobertura = Fraunces/Franklin/Courier caen a
 *   la serif del sistema y la identidad «Prensa del motor» desaparece justo en
 *   la primera impresión. En web tampoco salía gratis: dos conexiones extra
 *   (googleapis + gstatic) en la ruta crítica del render, y desde que Chrome
 *   particiona la caché HTTP por sitio (2020) el supuesto "ya la tendrá
 *   cacheada de otra web" dejó de ser cierto.
 *
 * Lo que hace, en orden:
 *   1. Pide el CSS a Google con User-Agent de Chrome. El UA IMPORTA: con uno
 *      genérico Google devuelve TTF en vez de WOFF2 (el doble de peso).
 *   2. Se queda solo con los subsets `latin` y `latin-ext`. La app habla es/en
 *      (i18n) y el CSS traía además cyrillic, cyrillic-ext y vietnamese: 14 de
 *      los 36 bloques eran peso muerto.
 *   3. Deduplica por URL. Fraunces y Libre Franklin son VARIABLES: Google emite
 *      un @font-face por cada peso pedido pero todos apuntan al mismo fichero.
 *      Aquí se colapsan a uno solo con `font-weight: <min> <max>`, que es la
 *      forma correcta de declarar una variable y evita descargar lo mismo N
 *      veces (36 bloques -> 17 ficheros).
 *   4. Descarga los woff2 a public/fonts/ y escribe src/fonts.css apuntando a
 *      rutas locales, conservando `unicode-range` (deja que el navegador se
 *      salte latin-ext si la página no lo usa) y `font-display: swap`.
 *
 * Uso:  node scripts/gen-local-fonts.mjs
 * (a mano, cuando cambie el juego tipográfico — no en cada build)
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR_FUENTES = resolve(ROOT, "public/fonts");
const CSS_SALIDA = resolve(ROOT, "src/fonts.css");

// La MISMA petición que había en index.html. Si cambias pesos o familias,
// cámbiala aquí y vuelve a ejecutar el script.
const URL_CSS =
  "https://fonts.googleapis.com/css2" +
  "?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,900;1,9..144,400;1,9..144,600" +
  "&family=Libre+Franklin:wght@400;600;800" +
  "&family=Courier+Prime:ital,wght@0,400;0,700;1,400" +
  "&display=swap";

// Sin esto Google sirve TTF. No es una preferencia: es la diferencia entre
// ~30 KB y ~70 KB por fichero.
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SUBSETS = new Set(["latin", "latin-ext"]);

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const css = await fetch(URL_CSS, { headers: { "User-Agent": UA_CHROME } }).then(
  (r) => {
    if (!r.ok) throw new Error(`Google Fonts devolvió ${r.status}`);
    return r.text();
  }
);

// Cada bloque viene precedido por un comentario con el nombre del subset:
//   /* latin */
//   @font-face { … }
const bloques = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g)];
if (!bloques.length) throw new Error("No se pudo parsear el CSS de Google Fonts");

const campo = (cuerpo, nombre) =>
  cuerpo.match(new RegExp(`${nombre}:\\s*([^;]+);`))?.[1].trim() ?? null;

// Agrupamos por URL: una entrada por FICHERO real, no por peso declarado.
const porFichero = new Map();

for (const [, subset, cuerpo] of bloques) {
  if (!SUBSETS.has(subset)) continue;

  const familia = campo(cuerpo, "font-family")?.replace(/['"]/g, "");
  const estilo = campo(cuerpo, "font-style") ?? "normal";
  const peso = parseInt(campo(cuerpo, "font-weight") ?? "400", 10);
  const url = cuerpo.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  const rango = campo(cuerpo, "unicode-range");
  if (!familia || !url) continue;

  const previo = porFichero.get(url);
  if (previo) {
    // Mismo fichero, otro peso declarado: ampliamos el rango.
    previo.pesoMin = Math.min(previo.pesoMin, peso);
    previo.pesoMax = Math.max(previo.pesoMax, peso);
    continue;
  }
  porFichero.set(url, {
    familia,
    estilo,
    pesoMin: peso,
    pesoMax: peso,
    rango,
    subset,
  });
}

// El nombre del fichero se calcula AQUÍ y no al insertar, porque incluye el
// peso y el rango no se conoce hasta haber recorrido todos los bloques.
//
// El peso tiene que ir en el nombre: Courier Prime es ESTÁTICA, así que su 400
// y su 700 son ficheros distintos con la misma familia, estilo y subset. Sin el
// peso ambos se llamaban igual, el segundo pisaba al primero en disco y los dos
// @font-face acababan apuntando al mismo woff2 — la Courier regular se habría
// renderizado en negrita en todo el cupón.
for (const info of porFichero.values()) {
  const peso =
    info.pesoMin === info.pesoMax ? `${info.pesoMin}` : `${info.pesoMin}-${info.pesoMax}`;
  info.fichero = `${slug(info.familia)}-${info.estilo}-${peso}-${info.subset}.woff2`;
}

const nombres = new Set([...porFichero.values()].map((i) => i.fichero));
if (nombres.size !== porFichero.size) {
  throw new Error(
    `Colisión de nombres: ${porFichero.size} ficheros pero ${nombres.size} nombres únicos`
  );
}

// Empezamos de cero para que un cambio de familias no deje huérfanos que luego
// viajarían al APK sin que nadie los referencie (regla 15: todo lo de public/
// acaba dentro del AAB).
if (existsSync(DIR_FUENTES)) rmSync(DIR_FUENTES, { recursive: true });
mkdirSync(DIR_FUENTES, { recursive: true });

let total = 0;
const reglas = [];

for (const [url, info] of porFichero) {
  const bytes = Buffer.from(
    await fetch(url, { headers: { "User-Agent": UA_CHROME } }).then((r) => {
      if (!r.ok) throw new Error(`${info.fichero}: gstatic devolvió ${r.status}`);
      return r.arrayBuffer();
    })
  );
  writeFileSync(resolve(DIR_FUENTES, info.fichero), bytes);
  total += bytes.length;
  console.log(
    `  ${info.fichero.padEnd(42)} ${String(Math.round(bytes.length / 1024)).padStart(4)} KB` +
      `  ${info.familia} ${info.estilo} ${info.pesoMin}-${info.pesoMax}`
  );

  // `font-weight: min max` es la declaración correcta para una fuente variable:
  // el navegador interpola cualquier peso intermedio de un único fichero.
  const peso =
    info.pesoMin === info.pesoMax ? `${info.pesoMin}` : `${info.pesoMin} ${info.pesoMax}`;
  reglas.push(
    [
      `/* ${info.familia} · ${info.estilo} · ${info.subset} */`,
      `@font-face {`,
      `  font-family: '${info.familia}';`,
      `  font-style: ${info.estilo};`,
      `  font-weight: ${peso};`,
      `  font-display: swap;`,
      `  src: url('/fonts/${info.fichero}') format('woff2');`,
      info.rango ? `  unicode-range: ${info.rango};` : null,
      `}`,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// Se ordenan las reglas para que el fichero generado no baile entre
// ejecuciones (el orden del Map depende de lo que devuelva Google).
reglas.sort();

writeFileSync(
  CSS_SALIDA,
  [
    "/* src/fonts.css — GENERADO por scripts/gen-local-fonts.mjs. No editar a mano. */",
    "/*",
    " * Fuentes auto-hospedadas desde public/fonts/. Antes venían de",
    " * fonts.googleapis.com, lo que dejaba la app Android sin su tipografía en",
    " * el primer arranque sin cobertura (el bundle es local, la fuente no lo era)",
    " * y metía dos conexiones a terceros en la ruta crítica del render.",
    " *",
    " * Las tres familias son SIL Open Font License 1.1 (ver public/fonts/LICENSE.txt).",
    " * Para regenerar tras cambiar pesos o familias:",
    " *   node scripts/gen-local-fonts.mjs",
    " */",
    "",
    reglas.join("\n\n"),
    "",
  ].join("\n")
);

writeFileSync(
  resolve(DIR_FUENTES, "LICENSE.txt"),
  [
    "Fuentes auto-hospedadas en este directorio",
    "==========================================",
    "",
    "Las tres familias se distribuyen bajo la SIL Open Font License 1.1,",
    "que permite expresamente el uso incrustado y la redistribución:",
    "",
    "  Fraunces        © The Fraunces Project Authors",
    "                  https://github.com/undercasetype/Fraunces",
    "  Libre Franklin  © The Libre Franklin Project Authors",
    "                  https://github.com/impallari/Libre-Franklin",
    "  Courier Prime   © The Courier Prime Project Authors",
    "                  https://github.com/quoteunquoteapps/CourierPrime",
    "",
    "Texto completo de la licencia: https://openfontlicense.org",
    "",
    "Ficheros generados por scripts/gen-local-fonts.mjs — no editar a mano.",
  ].join("\n")
);

console.log(
  `\n${porFichero.size} ficheros · ${(total / 1024).toFixed(0)} KB en total` +
    `\nEscrito: public/fonts/ y src/fonts.css`
);

// Los <link rel="preload"> de index.html llevan el rango de pesos EN EL NOMBRE
// del fichero, y ese nombre lo decide este script. Si alguien cambia los pesos
// de URL_CSS, los preload quedan apuntando a rutas que ya no existen: el
// navegador suelta un aviso en consola que nadie lee, deja de precargar y la
// única señal es un LCP peor. Fallo mudo de manual, así que lo comprobamos
// aquí, que es donde se rompe.
const nombresGenerados = new Set([...porFichero.values()].map((i) => i.fichero));
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const preloads = [...html.matchAll(/rel="preload"[^>]*href="\/fonts\/([^"]+\.woff2)"/g)].map(
  (m) => m[1]
);

const rotos = preloads.filter((p) => !nombresGenerados.has(p));
if (rotos.length) {
  console.error(
    `\n✖ index.html precarga ${rotos.length} fuente(s) que ya no se generan:\n` +
      rotos.map((r) => `    /fonts/${r}`).join("\n") +
      `\n  Actualiza los <link rel="preload"> de index.html con los nombres nuevos.`
  );
  process.exitCode = 1;
} else if (!preloads.length) {
  console.warn(
    "\n⚠ index.html no precarga ninguna fuente. No es un error, pero se pierde " +
      "un viaje en la ruta crítica del render."
  );
} else {
  console.log(`✔ ${preloads.length} preload(s) de index.html casan con los ficheros generados.`);
}
