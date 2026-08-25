// api/_lib/reveal-token.test.js
// El revealToken es la llave que abre la foto ENTERA del coche del día. Desde
// que un día puede tener dos coches (cambio de emergencia), una llave que solo
// dice «hoy» abre puertas que su portador no se ha ganado: el congelado que
// termina su partida con el coche A y presenta su token contra la URL del
// vigente B se llevaba la foto sin recorte de B, el coche que todos los demás
// siguen jugando (regla 5). Lo que se prueba aquí es que la llave lleva escrito
// SU coche, y que las dos réplicas (Node y Edge) escriben lo mismo — porque
// get-daily-car firma en Edge y daily-image verifica en Node.

import { describe, it, expect, beforeAll } from "vitest";
import {
  signRevealToken as firmarNode,
  verifyRevealToken as verificarNode,
} from "./reveal-token.js";
import {
  signRevealToken as firmarEdge,
  verifyRevealToken as verificarEdge,
} from "./edge/reveal-token.js";
import { selloDeCoche } from "./sello.js";

const HOY = "2026-08-25";
const COCHE_A = "11111111-1111-4111-8111-111111111111";
const COCHE_B = "22222222-2222-4222-8222-222222222222";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("las dos réplicas hablan el mismo idioma", () => {
  it("lo que firma Edge lo verifica Node, con el sello incluido", async () => {
    const token = await firmarEdge(HOY, "selloDelCoche01");
    expect(verificarNode(token)).toEqual({ date: HOY, sello: "selloDelCoche01" });
  });

  it("lo que firma Node lo verifica Edge, con el sello incluido", async () => {
    const token = firmarNode(HOY, "selloDelCoche01");
    expect(await verificarEdge(token)).toEqual({ date: HOY, sello: "selloDelCoche01" });
  });

  it("y el token viaja byte a byte igual desde las dos", async () => {
    expect(await firmarEdge(HOY, "selloDelCoche01")).toBe(
      firmarNode(HOY, "selloDelCoche01")
    );
  });
});

describe("formato del token", () => {
  it("sin sello sale en el formato viejo y se lee con sello null", async () => {
    const token = firmarNode(HOY);
    expect(verificarNode(token)).toEqual({ date: HOY, sello: null });
    expect(await verificarEdge(token)).toEqual({ date: HOY, sello: null });
  });

  it("el sello va DENTRO de lo firmado: tocarlo invalida el token", async () => {
    const token = firmarNode(HOY, await selloDeCoche(COCHE_A, HOY));
    const [, sig] = token.split(".");
    const otro = `${HOY}|${await selloDeCoche(COCHE_B, HOY)}`;
    const manipulado = `${Buffer.from(otro).toString("base64url")}.${sig}`;
    expect(verificarNode(manipulado)).toBe(null);
    expect(await verificarEdge(manipulado)).toBe(null);
  });

  it("un sello vacío no se cuela como sello", () => {
    // `fecha|` tiene separador pero no sello: se lee como «sin sello», que es
    // el camino restrictivo, no como un sello que casa con cualquier cosa.
    const token = firmarNode(`${HOY}|`);
    expect(verificarNode(token)).toEqual({ date: HOY, sello: null });
  });
});

describe("la llave abre SU revisión y solo la suya", () => {
  // Reproduce la decisión de daily-image (tokenAbreEstaFoto): el sello del
  // token contra el sello del coche que resuelve el `v` de la URL.
  async function abre(token, carIdDeLaFoto, hayCambioHoy) {
    const datos = verificarNode(token);
    if (datos?.date !== HOY) return false;
    if (!datos.sello) return !hayCambioHoy;
    const esperado = await selloDeCoche(carIdDeLaFoto, HOY);
    return Boolean(esperado) && esperado === datos.sello;
  }

  it("el token del coche que jugaste abre su foto", async () => {
    const token = firmarNode(HOY, await selloDeCoche(COCHE_A, HOY));
    expect(await abre(token, COCHE_A, true)).toBe(true);
  });

  it("EL FALLO: el token del saliente NO abre la foto del coche vigente", async () => {
    // El congelado termina su partida con A, abre incógnito y le sirven la URL
    // con el `v` de B. Antes, `canReveal` era true y salía la foto entera de B.
    const token = firmarNode(HOY, await selloDeCoche(COCHE_A, HOY));
    expect(await abre(token, COCHE_B, true)).toBe(false);
  });

  it("un token de OTRO día no abre nada, tenga sello o no", async () => {
    const viejo = firmarNode("2024-01-01", await selloDeCoche(COCHE_A, "2024-01-01"));
    expect(await abre(viejo, COCHE_A, false)).toBe(false);
  });

  it("token viejo (sin sello): vale el día sin salientes y no el día del cambio", async () => {
    // Compatibilidad hacia atrás acotada: sin salientes, «un día = un coche»
    // sigue siendo verdad y el token no abre nada que su portador no tuviera.
    // Con salientes no puede demostrar de qué revisión es → no se revela.
    const token = firmarNode(HOY);
    expect(await abre(token, COCHE_A, false)).toBe(true);
    expect(await abre(token, COCHE_A, true)).toBe(false);
  });

  it("el sello no se puede fabricar sin el secreto", async () => {
    // Es HMAC, no un hash del id: sin secreto no se puede calcular el sello de
    // un coche y por tanto no se puede ir probando el catálogo hasta acertar.
    const sello = await selloDeCoche(COCHE_A, HOY);
    expect(sello).not.toContain(COCHE_A);
    const otroDia = await selloDeCoche(COCHE_A, "2026-08-26");
    expect(otroDia).not.toBe(sello);
  });
});
