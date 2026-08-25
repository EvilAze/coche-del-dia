// api/_lib/audit.test.js
// audit.js hashea la IP con REPESCA_TOKEN_SECRET para poder correlacionar
// sesiones sin guardar la IP en claro (ver cabecera del módulo). El secreto
// se leía con `const SECRET = process.env.REPESCA_TOKEN_SECRET || ""` A NIVEL
// DE MÓDULO — igual que el patrón que la regla 2 de CLAUDE.md prohíbe para
// los clientes de Supabase. Si el env llega después del import (por ejemplo,
// porque un test lo fija en `beforeAll`, que en ESM corre DESPUÉS de que los
// imports se evalúen), `SECRET` se queda congelado en cadena vacía para
// siempre y `hashIp` devuelve `null` sin que nada lo explique.

import { describe, it, expect, vi, beforeAll } from "vitest";

const insertMock = vi.fn(() => Promise.resolve({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

// Se mockea getSupabaseAdmin: lo que se prueba aquí es el hasheo de la IP,
// no la inserción en Supabase (que ya tiene su propio contrato en RLS).
vi.mock("./supabase.js", () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

// A propósito DESPUÉS de declarar los mocks pero, como todo `import` estático,
// se evalúa antes de que corra `beforeAll` — que es justo el escenario que
// reproduce el bug si `audit.js` lee el secreto a nivel de módulo.
import { logGuessAttempt, logCanary } from "./audit.js";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("hashIp lee el secreto por llamada, no al importar", () => {
  it("logGuessAttempt hashea la IP aunque el env llegue después del import", async () => {
    await logGuessAttempt({
      req: { headers: { "user-agent": "test-ua", "accept-language": "es" } },
      mode: "daily",
      gameDate: "2026-08-25",
      carId: "c1",
      isAnon: true,
      attemptNumber: 1,
      ip: "1.2.3.4",
      guess: { make: "Seat", model: "Ibiza", year: 2020 },
      result: { win: false },
    });
    const row = insertMock.mock.calls.at(-1)[0];
    expect(row.ip_hash).not.toBeNull();
    expect(row.ip_hash).toHaveLength(32);
  });

  it("logCanary también hashea la IP con el secreto vigente", async () => {
    await logCanary({
      req: { headers: {} },
      reason: "revealToken forjado",
      carId: "c1",
      gameDate: "2026-08-25",
      isAnon: true,
      ip: "5.6.7.8",
    });
    const row = insertMock.mock.calls.at(-1)[0];
    expect(row.ip_hash).not.toBeNull();
    expect(row.ip_hash).toHaveLength(32);
  });

  it("el hash es estable para la misma IP y el mismo secreto", async () => {
    await logGuessAttempt({
      req: { headers: {} },
      mode: "daily",
      gameDate: "2026-08-25",
      carId: "c1",
      isAnon: true,
      attemptNumber: 1,
      ip: "9.9.9.9",
      guess: {},
      result: {},
    });
    const primero = insertMock.mock.calls.at(-1)[0].ip_hash;
    await logGuessAttempt({
      req: { headers: {} },
      mode: "daily",
      gameDate: "2026-08-25",
      carId: "c1",
      isAnon: true,
      attemptNumber: 2,
      ip: "9.9.9.9",
      guess: {},
      result: {},
    });
    const segundo = insertMock.mock.calls.at(-1)[0].ip_hash;
    expect(primero).toBe(segundo);
  });
});
