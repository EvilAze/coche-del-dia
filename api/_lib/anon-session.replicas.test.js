// api/_lib/anon-session.replicas.test.js
// api/_lib/anon-session.js (Node) y api/_lib/edge/anon-session.js (Edge) son
// réplicas: get-daily-car firma el token en Edge y validate-guess lo verifica
// en Node. Si divergen, el jugador anónimo pierde sus intentos a mitad de
// partida — y el síntoma aparece lejos de la causa.

import { describe, it, expect, beforeAll } from "vitest";
import { signAnonSession as firmarNode, verifyAnonSession as verificarNode } from "./anon-session.js";
import {
  signAnonSession as firmarEdge,
  verifyAnonSession as verificarEdge,
} from "./edge/anon-session.js";

const SESION = { d: "2026-08-25", n: 2, s: "playing", c: "selloDelCoche01" };

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("las dos réplicas hablan el mismo idioma", () => {
  it("lo que firma Edge lo verifica Node, con el sello incluido", async () => {
    const token = await firmarEdge(SESION);
    expect(verificarNode(token)).toEqual(SESION);
  });

  it("lo que firma Node lo verifica Edge, con el sello incluido", async () => {
    const token = firmarNode(SESION);
    expect(await verificarEdge(token)).toEqual(SESION);
  });

  it("un token sin `c` (emitido antes de esto) sigue siendo válido", async () => {
    const viejo = { d: "2026-08-25", n: 1, s: "playing" };
    expect(await verificarEdge(firmarNode(viejo))).toEqual(viejo);
  });
});
