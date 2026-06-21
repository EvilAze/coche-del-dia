// api/_lib/http.cors.test.js
import { describe, it, expect, vi } from "vitest";
import { applyCors } from "./http.js";

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader: (k, v) => (headers[k] = v),
    end: vi.fn(),
  };
}

describe("applyCors", () => {
  it("origen permitido → setea headers CORS", () => {
    const res = mockRes();
    const handled = applyCors({ method: "GET", headers: { origin: "https://localhost" } }, res);
    expect(handled).toBe(false);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("X-Anon-Session");
  });

  it("origen NO permitido (web same-origin) → no añade ACAO", () => {
    const res = mockRes();
    const handled = applyCors({ method: "GET", headers: { origin: "https://cochedeldia.com" } }, res);
    expect(handled).toBe(false);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("preflight OPTIONS desde origen permitido → 204 y handled=true", () => {
    const res = mockRes();
    const handled = applyCors({ method: "OPTIONS", headers: { origin: "https://localhost" } }, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });
});
