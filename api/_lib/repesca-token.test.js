// api/_lib/repesca-token.test.js
// pseudoIdFor deriva el pseudo-id de repesca con HMAC(REPESCA_TOKEN_SECRET).
// El secreto se leía con `const SECRET = process.env.REPESCA_TOKEN_SECRET ||
// ""` A NIVEL DE MÓDULO — igual que el patrón que la regla 2 de CLAUDE.md
// prohíbe para los clientes de Supabase. Si el env llega después del import
// (aquí, fijado en `beforeAll`, que en ESM corre DESPUÉS de que los imports se
// evalúen), `SECRET` se queda vacío para siempre y `pseudoIdFor` lanza
// "not configured" aunque el entorno esté perfectamente configurado.

import { describe, it, expect, beforeAll } from "vitest";
import { pseudoIdFor, resolveRealCarId } from "./repesca-token.js";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

const USER = "user-1";
const COCHE_A = "11111111-1111-4111-8111-111111111111";
const COCHE_B = "22222222-2222-4222-8222-222222222222";

describe("pseudoIdFor lee el secreto por llamada, no al importar", () => {
  it("no lanza aunque el env llegue después del import", () => {
    expect(() => pseudoIdFor(COCHE_A, USER)).not.toThrow();
  });

  it("devuelve un pseudo-id de 24 hex chars, determinista para el mismo par", () => {
    const uno = pseudoIdFor(COCHE_A, USER);
    const dos = pseudoIdFor(COCHE_A, USER);
    expect(uno).toMatch(/^[0-9a-f]{24}$/);
    expect(uno).toBe(dos);
  });

  it("resolveRealCarId reconoce el pseudo entre una lista de candidatos", () => {
    const pseudo = pseudoIdFor(COCHE_B, USER);
    const resuelto = resolveRealCarId(pseudo, USER, [COCHE_A, COCHE_B]);
    expect(resuelto).toBe(COCHE_B);
  });
});
