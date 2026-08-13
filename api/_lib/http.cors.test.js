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
});

// ── `Vary: Origin` — LA REGRESIÓN QUE ROMPÍA EL CUPÓN DE LA APP ─────────────
// Estos tests existen porque el bloque de arriba ya cubría la cabecera CORS y
// aun así el fallo se coló: nadie comprobaba el `Vary`, que iba DENTRO del `if`
// del origen permitido.
//
// Consecuencia real (reportada en la repesca): la respuesta generada para un
// visitante de web salía sin ACAO y sin `Vary`, el CDN la cacheaba con una clave
// que ignoraba el Origin —list-cars pide s-maxage=300— y durante los siguientes
// 5 minutos TODA la app recibía esa copia sin cabecera CORS. El WebView la
// bloqueaba y el cupón se quedaba en «No ha llegado el listado de marcas», con
// los tres reintentos del cliente pegando contra el mismo objeto cacheado.
//
// La regla que fijan: la respuesta depende del Origin SIEMPRE, incluso cuando la
// dependencia consiste en omitir la cabecera. Si alguien vuelve a meter el
// `Vary` dentro de una rama, esto se pone rojo.
describe("applyCors · Vary (no cachear la respuesta de web para la app)", () => {
  it("SIN Origin (web same-origin) igualmente declara Vary: Origin", () => {
    const res = mockRes();
    applyCors({ method: "GET", headers: {} }, res);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("con Origin de web (no permitido) también", () => {
    const res = mockRes();
    applyCors({ method: "GET", headers: { origin: "https://cochedeldia.com" } }, res);
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("con el Origin de la app también", () => {
    const res = mockRes();
    applyCors({ method: "GET", headers: { origin: "https://localhost" } }, res);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("y en el preflight, que también puede cachearse", () => {
    const res = mockRes();
    applyCors({ method: "OPTIONS", headers: { origin: "https://localhost" } }, res);
    expect(res.headers["Vary"]).toBe("Origin");
  });

  it("req sin headers no revienta y sigue declarando Vary", () => {
    const res = mockRes();
    expect(() => applyCors({ method: "GET" }, res)).not.toThrow();
    expect(res.headers["Vary"]).toBe("Origin");
  });
});

describe("applyCors · preflight", () => {

  it("preflight OPTIONS desde origen permitido → 204 y handled=true", () => {
    const res = mockRes();
    const handled = applyCors({ method: "OPTIONS", headers: { origin: "https://localhost" } }, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });
});
