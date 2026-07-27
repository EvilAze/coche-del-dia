#!/usr/bin/env node
/**
 * Guardarraíl de coherencia estética del sistema «Prensa del motor».
 *
 * Por qué existe: la web ha pasado por tres pieles (neón menta → plano ámbar →
 * prensa) y cada migración dejó restos. El síntoma no era un componente feo,
 * era la CONVIVENCIA: un emoji 🚗 de 24px dentro de un disco de acento en el
 * aviso de recarga, un halo ámbar sobre el cromo de la repesca, un punto menta
 * `#7af0c8` con glow en la campana, medallas de plata en `zinc-300` invisibles
 * sobre el papel del modo día. Todo eso pasó el build y los tests: nada de ello
 * es un error de código, solo de época.
 *
 * Este script convierte "no vuelvas a mezclar temas" en algo que falla solo, en
 * la misma línea que `check-bundle-size.mjs`: coste cero, sin deps, sin red.
 *
 * Lo que vigila, y por qué cada regla:
 *
 *   1. EMOJI en JSX y en cadenas de UI. Cada sistema operativo dibuja un emoji
 *      distinto, a otro tamaño y con otra paleta, así que es el único elemento
 *      gráfico de la web que no controlamos. Se sustituye por el set de iconos
 *      de línea o, mejor, por tipografía (sellos, kickers, glifos).
 *   2. PALETA CRUDA de Tailwind (amber-, zinc-, neutral-, emerald-…). No sigue
 *      al tema: lo que se ve bien sobre el grafito de la edición de noche puede
 *      desaparecer sobre el papel crema de la de día. Todo color va por token.
 *   3. GLOWS (`shadow-[0_0_…]`). Sobre papel un halo no existe; ensucia.
 *   4. HEX SUELTOS en className. Son siempre un color de un tema anterior.
 *
 * Excepciones deliberadas (ver ALLOW): el share de texto plano, la notificación
 * push y el mapa de banderas. Los tres salen de nuestro lienzo — el emoji ahí
 * lo pinta WhatsApp o la barra de estado del sistema, no nosotros.
 *
 * Uso:  npm run test:estetica
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");

// Rangos de emoji + pictogramas + selector de variación.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// Glifos TIPOGRÁFICOS que caen dentro de esos rangos pero que el sistema usa a
// propósito: son caracteres de texto, se componen con la fuente y heredan color
// y tamaño (el visto del cupón, los glifos del Toast, la estrella de logro).
// La diferencia con un emoji no es el bloque Unicode, es si el SO lo pinta como
// pictograma a color por su cuenta o lo deja en manos de nuestra tipografía.
// Sin esta exención el guardarraíl marcaría como "cutre" justo la solución que
// propone.
const GLIFOS_TIPOGRAFICOS = /[✓✔✕✖✗★☆✶]/gu;

// Paleta cruda de Tailwind. `gray-` y `slate-` entran también: son grises que
// no se enteran del cambio día/noche.
const PALETA_CRUDA =
  /\b(?:amber|zinc|neutral|slate|gray|emerald|sky|indigo|violet|lime|teal|cyan|rose|fuchsia)-(?:50|[1-9]00|950)\b/;

// Glow: sombra que empieza en 0 0 (sin desplazamiento) = halo.
const GLOW = /shadow-\[0_0_/;

// Hex de 3 o 6 dígitos dentro de un className/clase Tailwind arbitraria.
const HEX_EN_CLASE = /(?:\[|:)#[0-9a-fA-F]{3,8}\b/;

const REGLAS = [
  {
    id: "emoji",
    re: EMOJI,
    msg: "emoji en la UI — cada SO lo dibuja distinto; usa el set de iconos o tipografía (pm-sello, pm-kicker, glifo de Toast)",
  },
  {
    id: "paleta-cruda",
    re: PALETA_CRUDA,
    msg: "color crudo de Tailwind — no sigue al tema día/noche; usa un token (tinta, papel, rojo, gold, plata, bronce, muted)",
  },
  {
    id: "glow",
    re: GLOW,
    msg: "halo/glow — sobre papel no existe; usa filete (border) o el sello",
  },
  {
    id: "hex",
    re: HEX_EN_CLASE,
    msg: "hex suelto en una clase — es siempre un color de un tema anterior; usa un token",
  },
];

// Excepciones: rutas exactas (relativas a la raíz) y, para cada una, las reglas
// que se le perdonan. Todo lo demás sigue vigilado en esos mismos ficheros.
const ALLOW = [
  {
    path: "src/lib/shareText.js",
    reglas: ["emoji"],
    porque:
      "la rejilla ✅/❌ y el 🔥 de racha son TEXTO PLANO para WhatsApp/X — ahí el emoji es el idioma de Wordle y lo pinta la app destino",
  },
  {
    path: "src/lib/shareText.test.js",
    reglas: ["emoji"],
    porque: "verifica esa misma rejilla de texto plano",
  },
  {
    path: "src/data/countries.js",
    reglas: ["emoji"],
    porque:
      "COUNTRY_FLAGS queda para usos NO visuales; la UI ya pinta las banderas con flagImagePath() precisamente porque Windows no tiene glifo de bandera",
  },
];

// Las cadenas de i18n que sí pueden llevar emoji, por clave. La notificación
// push se pinta en la barra de estado del sistema: ahí no llega nuestro CSS y
// el emoji es lo único que da un golpe de color.
const I18N_ALLOW = new Set(["notif.reminderTitle"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function permitido(rel, reglaId) {
  return ALLOW.some((a) => a.path === rel && a.reglas.includes(reglaId));
}

// Vacía los comentarios de bloque conservando los saltos de línea, para que los
// números de línea del informe sigan cuadrando. Hace falta porque el código
// documenta en comentarios justamente lo que este script persigue ("antes había
// un 🚗 aquí", "la rejilla ✅/❌ del share"): citar el síntoma no es cometerlo.
function sinComentariosDeBloque(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

const fallos = [];

// ── 1. Código fuente (.jsx / .js) ────────────────────────────────────────
for (const full of walk(SRC)) {
  if (!/\.(jsx|js)$/.test(full)) continue;
  const rel = relative(ROOT, full).split(sep).join("/");
  // El admin es una herramienta interna que solo ve el propietario del juego:
  // no forma parte de la web pública, así que no se le exige la estética.
  if (rel.startsWith("src/admin/")) continue;

  const lineas = sinComentariosDeBloque(readFileSync(full, "utf8")).split(/\r?\n/);
  lineas.forEach((linea, i) => {
    const codigo = linea
      .replace(/\/\/.*$/, "")
      .replace(GLIFOS_TIPOGRAFICOS, "");
    for (const regla of REGLAS) {
      if (!regla.re.test(codigo)) continue;
      if (permitido(rel, regla.id)) continue;
      fallos.push({ rel, linea: i + 1, regla: regla.id, msg: regla.msg, texto: linea.trim().slice(0, 100) });
    }
  });
}

// ── 2. Cadenas visibles (locales i18n) ───────────────────────────────────
for (const locale of ["es", "en"]) {
  const rel = `src/i18n/locales/${locale}.json`;
  const datos = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  const recorrer = (obj, prefijo = "") => {
    for (const [clave, valor] of Object.entries(obj)) {
      const ruta = prefijo ? `${prefijo}.${clave}` : clave;
      if (typeof valor === "string") {
        const limpio = valor.replace(GLIFOS_TIPOGRAFICOS, "");
        if (EMOJI.test(limpio) && !I18N_ALLOW.has(ruta)) {
          fallos.push({
            rel,
            linea: 0,
            regla: "emoji",
            msg: `emoji en la cadena "${ruta}" — el texto de UI se compone con la fuente; el adorno lo pone el componente`,
            texto: valor.slice(0, 60),
          });
        }
      } else if (valor && typeof valor === "object") {
        recorrer(valor, ruta);
      }
    }
  };
  recorrer(datos);
}

// ── Informe ──────────────────────────────────────────────────────────────
if (fallos.length === 0) {
  console.log("✓ estética: sin restos de temas anteriores en la web pública.");
  process.exit(0);
}

console.error(`\n✗ estética: ${fallos.length} resto(s) de tema anterior.\n`);
for (const f of fallos) {
  const donde = f.linea ? `${f.rel}:${f.linea}` : f.rel;
  console.error(`  [${f.regla}] ${donde}`);
  console.error(`      ${f.msg}`);
  if (f.texto) console.error(`      → ${f.texto}`);
}
console.error(
  "\n  Si un caso es legítimo (texto que sale de nuestro lienzo: share, push,\n" +
    "  metadatos), añádelo a ALLOW / I18N_ALLOW en scripts/check-estetica.mjs\n" +
    "  CON su motivo. No subas el umbral sin entender el caso.\n"
);
process.exit(1);
