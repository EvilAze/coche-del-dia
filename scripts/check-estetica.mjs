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
 *   5. REDONDEOS (`rounded-sm` … `rounded-3xl`). La forma es la mitad de la
 *      identidad: el sistema es de filetes, doble filete y esquinas VIVAS. Cada
 *      piel anterior tenía su radio (12px en el plano, 16-24px en el de cristal)
 *      y sobrevivían mezclados: el mismo marco de foto redondeado en el lightbox
 *      y a escuadra en el escenario, tarjetas de 16px al lado de filetes rectos.
 *      `rounded-none` sí se permite —es la forma de decirlo en voz alta— y
 *      `rounded-full` también, porque un CÍRCULO no es una esquina blanda: es un
 *      objeto (el avatar, el «?» de la ayuda), y esos sí existen en el sistema.
 *   6. SOMBRAS BLANDAS de Tailwind (`shadow-sm/md/lg/xl/2xl/inner`). La
 *      jerarquía se dice con filetes. Lo que de verdad flota (el desplegable del
 *      cupón, el aviso, el recorte de la foto, el sumario) lleva la sombra del
 *      sistema, `--sombra-flota`, que tiene una receta por tema. Un preset de
 *      Tailwind no se entera de si debajo hay papel crema o grafito.
 *   7. BLANCO y NEGRO crudos (`text-white`, `bg-black/40`, `border-white/10`…).
 *      Es el resto más traicionero de la piel oscura, porque no desentona: DESAPARECE.
 *      El modo día es papel crema, así que un `hover:text-white` deja el texto
 *      invisible y un filete `border-white/10` no llega a dibujarse. Así estuvo
 *      el selector de idioma y así estuvo el cuerpo del aviso de iOS.
 *
 * Excepciones deliberadas (ver ALLOW): el share de texto plano, la notificación
 * push y el mapa de banderas (el emoji ahí lo pinta WhatsApp o la barra de estado
 * del sistema, no nosotros), el cromo que va SOBRE una fotografía —donde el papel
 * no es una opción— y la chapa de marca de Google.
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
//
// La lista es la paleta COMPLETA de Tailwind a propósito. Antes enumeraba solo
// los colores que se habían visto en el repo, y por el hueco se coló un
// `text-red-400` en el modal de ranking que sobrevivió a todo el rediseño: el
// guardarraíl solo protege de los colores que alguien se acordó de escribir.
// Los tokens del tema (rojo, gold, plata, bronce, tinta, papel, muted…) no
// llevan sufijo numérico, así que no colisionan con este patrón.
const PALETA_CRUDA =
  /\b(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|[1-9]00|950)\b/;

// Glow: sombra que empieza en 0 0 (sin desplazamiento) = halo.
const GLOW = /shadow-\[0_0_/;

// Hex de 3 o 6 dígitos dentro de un className/clase Tailwind arbitraria.
const HEX_EN_CLASE = /(?:\[|:)#[0-9a-fA-F]{3,8}\b/;

// Esquina blanda. Deja pasar `rounded-none` (declarar la esquina viva) y
// `rounded-full` (un círculo es un objeto, no un radio). El `\b` final evita que
// `rounded-full` entre por la puerta de `rounded-f…`.
const REDONDEO = /\brounded(?:-[a-z]+)?-(?:sm|md|lg|xl|2xl|3xl)\b|\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/;

// Sombras de catálogo de Tailwind. `shadow-[…]` (arbitraria) queda fuera a
// propósito: ahí es donde se escribe la del sistema, `shadow-[var(--sombra-flota)]`.
// Y `shadow-none` también se permite.
const SOMBRA_BLANDA = /\bshadow-(?:sm|md|lg|xl|2xl|inner)\b/;

// Blanco/negro crudos en cualquier utilidad de color, con o sin alfa.
const BLANCO_NEGRO =
  /\b(?:text|bg|border|divide|ring|outline|from|via|to|fill|stroke|decoration|placeholder|shadow)-(?:white|black)\b/;

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
  {
    id: "redondeo",
    re: REDONDEO,
    msg: "esquina blanda — el sistema es de filetes y esquinas vivas; usa rounded-none (rounded-full solo para un círculo de verdad: avatar, glifo de ayuda)",
  },
  {
    id: "sombra-blanda",
    re: SOMBRA_BLANDA,
    msg: "sombra de catálogo de Tailwind — no sabe si debajo hay papel o grafito; separa con filete (border) o, si de verdad flota, usa shadow-[var(--sombra-flota)]",
  },
  {
    id: "blanco-negro",
    re: BLANCO_NEGRO,
    msg: "blanco/negro crudo — el modo día es papel crema, así que no desentona: desaparece; usa un token (tinta, papel, muted). Excepción solo para el cromo que va SOBRE una fotografía",
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
  {
    path: "src/components/CarImage.jsx",
    reglas: ["blanco-negro"],
    porque:
      "todo el cromo de este componente (etiqueta de pista, filete y ✕ del lightbox, icono de ampliar) se pinta ENCIMA de una fotografía cualquiera: ahí el papel no es una opción y el blanco/negro es lo único que se lee sobre una carrocería blanca o negra. El resto del archivo sí sigue vigilado",
  },
  {
    path: "src/components/LoginModal.jsx",
    reglas: ["blanco-negro"],
    porque:
      "el botón de Google es una chapa de MARCA: su logo va sobre fondo blanco por las directrices de Google, así que ese par de colores no lo elegimos nosotros (la forma sí: esquina viva, como el resto)",
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
