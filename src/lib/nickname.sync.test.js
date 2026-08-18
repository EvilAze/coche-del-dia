// src/lib/nickname.sync.test.js
// Red de seguridad de la RÉPLICA del nick, en el espíritu de zoom.sync.test.js
// (CLAUDE.md #7): la regla de formato está escrita dos veces —en JS para el
// error inmediato del modal, en SQL para que sea de verdad— y no se pueden
// compartir. Este test rompe el CI (vercel.json ejecuta `vitest run` en el
// build) si alguien cambia una y olvida la otra.
//
// El fallo que previene es asimétrico y por eso conviene nombrarlo: relajar
// solo el JS no rompe nada visible —el modal acepta y la base de datos
// rechaza—, así que el jugador se come un error genérico al guardar sin
// entender por qué. Endurecer solo el JS deja la puerta de PostgREST abierta,
// que es el agujero que esto vino a cerrar.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  NICK_PATTERN,
  NICK_MAX,
  nickValido,
  limpiarNick,
  filtrarNick,
} from "./nickname.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(
  AQUI,
  "../../scripts/2026-08-nick-validado-en-servidor.sql"
);

describe("sincronía src/lib/nickname.js ↔ el CHECK de la base de datos", () => {
  const sql = readFileSync(SQL_PATH, "utf8");

  // Todos los usos del regex en el .sql: el CHECK, el recuento de filas
  // históricas y la consulta de verificación. Los tres tienen que decir lo
  // mismo — un `!~` desactualizado en la verificación mentiría sobre el estado
  // real de la tabla, que es la peor clase de comprobación.
  const patronesSql = [...sql.matchAll(/!?~\s*'([^']*)'/g)].map((m) => m[1]);

  it("el .sql usa el regex en los sitios que esperamos", () => {
    // Si este número cambia, alguien añadió o quitó un uso: que lo mire.
    expect(patronesSql).toHaveLength(3);
  });

  it("todos los patrones del .sql son idénticos al de JS", () => {
    for (const patron of patronesSql) {
      expect(patron).toBe(NICK_PATTERN);
    }
  });

  it("el máximo declarado coincide con el que dice el patrón", () => {
    // NICK_MAX alimenta el `maxLength` del input; si se separa del regex, el
    // campo deja escribir más de lo que se puede guardar.
    expect(NICK_PATTERN).toContain(`{1,${NICK_MAX}}`);
  });
});

describe("nickValido", () => {
  it("acepta lo que la base de datos aceptaría", () => {
    for (const bueno of ["A", "PEPE", "max2", "123456789012", "aA0"]) {
      expect(nickValido(bueno)).toBe(true);
    }
  });

  it("rechaza lo que la base de datos rechazaría", () => {
    for (const malo of [
      "",
      "1234567890123", // 13 caracteres
      "con espacio",
      "acentuado-á",
      "guion-bajo_",
      // Escapado y no el carácter suelto: es un fixture, no interfaz, y así el
      // fichero se queda en ASCII (regla 14 — nada de no-ASCII incrustado que
      // un re-guardado con la codificación equivocada pueda convertir en
      // mojibake). De paso no lo cuenta como emoji el test:estetica.
      "emoji\u{1F600}",
      null,
      undefined,
    ]) {
      expect(nickValido(malo)).toBe(false);
    }
  });

  it("perdona los espacios de los bordes en vez de rechazarlos", () => {
    expect(nickValido("  PEPE  ")).toBe(true);
    expect(limpiarNick("  PEPE  ")).toBe("PEPE");
  });

  // El motivo del trim NO es solo cosmético: sin él, el `$` de JavaScript casa
  // antes de un salto de línea final y "PEPE\n" pasaría aquí para morir en el
  // CHECK de Postgres, que sí ancla al final real. Con el trim, las dos
  // réplicas deciden lo mismo. Si alguien quita el trim, esto cae.
  it("no cuela un salto de línea final (donde JS y Postgres discrepan)", () => {
    expect(nickValido("PEPE\n")).toBe(true); // el trim lo convierte en "PEPE"
    expect(limpiarNick("PEPE\n")).toBe("PEPE");
    // Y un salto EN MEDIO no lo salva nada: lo rechazan los dos.
    expect(nickValido("PE\nPE")).toBe(false);
  });
});

describe("filtrarNick", () => {
  // Lo que el campo deja teclear tiene que ser un subconjunto de lo que la
  // base de datos acepta. Si se separan, el input deja escribir algo que luego
  // el guardado rechaza — o peor, al revés.
  it("lo que sobrevive al filtro siempre es válido (mientras quepa)", () => {
    for (const crudo of [
      "pe pe",
      "áéí",
      "PEPE!",
      "a-b_c",
      "\u{1F600}MAX\u{1F600}",
    ]) {
      const filtrado = filtrarNick(crudo).slice(0, NICK_MAX);
      if (filtrado.length > 0) expect(nickValido(filtrado)).toBe(true);
    }
  });

  it("no toca lo que ya era válido", () => {
    expect(filtrarNick("PEPE2")).toBe("PEPE2");
  });
});
