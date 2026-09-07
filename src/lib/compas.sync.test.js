// src/lib/compas.sync.test.js
// Los peldaños del compás están escritos dos veces: en `:root` de index.css (la
// fuente para el CSS y para Tailwind, que apunta a esas variables) y en
// `lib/compas.js` (la que puede leer el JavaScript). Este test es lo que impide
// que se separen — el mismo trato que ya reciben las réplicas de `zoom.js`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { MS } from "./compas";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS = readFileSync(join(RAIZ, "src", "index.css"), "utf8");

// `--ms-latido: 1.2s` es el único que se cuenta en segundos (es un pulso
// ambiental, no un recorrido), así que hay que normalizar a ms.
function leerDeCss(nombre) {
  const m = CSS.match(new RegExp(`--ms-${nombre}\\s*:\\s*([0-9.]+)(ms|s)\\s*;`));
  if (!m) return null;
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
}

describe("el compás no se desafina", () => {
  for (const nombre of Object.keys(MS)) {
    it(`--ms-${nombre} vale lo mismo en index.css y en lib/compas.js`, () => {
      expect(leerDeCss(nombre)).toBe(MS[nombre]);
    });
  }
});
