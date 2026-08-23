// api/_lib/ratelimit.test.js
// Tests de la lógica pura de rate-limit. evaluateLimit recibe un "limiter"
// (real o falso) para no depender de Upstash ni de red: cubrimos fail-open
// sin limiter, bajo límite, sobre límite y excepción. Más getClientIpEdge.
import { describe, it, expect } from "vitest";
import { evaluateLimit, getClientIpEdge } from "./ratelimit.js";

// Limiter falso: .limit() devuelve `outcome` (objeto) o lanza si es Error.
function fakeLimiter(outcome) {
  return {
    limit: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

describe("evaluateLimit", () => {
  it("sin limiter (Upstash no configurado) → ok (fail-open)", async () => {
    expect(await evaluateLimit(null, "1.2.3.4")).toEqual({ ok: true });
  });

  it("bajo el límite → ok", async () => {
    const lim = fakeLimiter({ success: true, reset: Date.now() + 60000 });
    expect(await evaluateLimit(lim, "1.2.3.4")).toEqual({ ok: true });
  });

  it("sobre el límite → !ok con retryAfter en segundos", async () => {
    const lim = fakeLimiter({ success: false, reset: Date.now() + 5000 });
    const r = await evaluateLimit(lim, "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(r.retryAfter).toBeLessThanOrEqual(6);
  });

  it("el limiter lanza (Upstash caído) → ok (fail-open)", async () => {
    const lim = fakeLimiter(new Error("redis down"));
    expect(await evaluateLimit(lim, "1.2.3.4")).toEqual({ ok: true });
  });

  it("el limiter NO CONTESTA (Upstash atrancado) → ok (fail-open)", async () => {
    // El caso que faltaba, y el que importa: la cabecera del módulo promete
    // fail-open si Upstash «cae/TARDA/sin cuota», pero un try/catch solo cubre
    // al que contesta mal, no al que no contesta. Sin plazo este await se
    // quedaba colgado, el catch no llegaba a ejecutarse y la Edge Function
    // moría a los 25 s — con la base de datos perfectamente sana, porque esto
    // corre ANTES de tocar Supabase.
    const lim = { limit: () => new Promise(() => {}) };
    expect(await evaluateLimit(lim, "1.2.3.4")).toEqual({ ok: true });
  }, 10000);
});

describe("getClientIpEdge", () => {
  function req(headers) {
    return { headers: { get: (h) => headers[h] ?? null } };
  }
  it("usa el primer valor de x-forwarded-for", () => {
    expect(getClientIpEdge(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });
  it("cae a x-real-ip si no hay xff", () => {
    expect(getClientIpEdge(req({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });
  it("'unknown' si no hay cabeceras de IP", () => {
    expect(getClientIpEdge(req({}))).toBe("unknown");
  });
});
