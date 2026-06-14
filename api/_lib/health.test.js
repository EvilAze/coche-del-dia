// api/_lib/health.test.js
// Tests del helper de health-check. Mockean el cliente Supabase para cubrir
// los cuatro caminos: DB sana, error de DB, excepción de red y timeout.
import { describe, it, expect } from "vitest";
import { checkDbHealth } from "./health.js";

// Cliente falso: from().select().limit() devuelve `result` (promise o
// thenable) que controla cada test. Replica la cadena que usa el helper.
function fakeClient(result) {
  return {
    from: () => ({
      select: () => ({
        limit: () => result,
      }),
    }),
  };
}

describe("checkDbHealth", () => {
  it("DB responde sin error → true", async () => {
    const client = fakeClient(Promise.resolve({ data: [{ id: 1 }], error: null }));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(true);
  });

  it("DB devuelve error → false", async () => {
    const client = fakeClient(Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(false);
  });

  it("la query lanza (red caída) → false", async () => {
    const client = fakeClient(Promise.reject(new Error("network")));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(false);
  });

  it("la query no resuelve antes del timeout → false", async () => {
    const client = fakeClient(new Promise(() => {})); // nunca resuelve
    expect(await checkDbHealth(client, { timeoutMs: 30 })).toBe(false);
  });

  it("cliente null (envs ausentes) → false", async () => {
    expect(await checkDbHealth(null, { timeoutMs: 1000 })).toBe(false);
  });
});
