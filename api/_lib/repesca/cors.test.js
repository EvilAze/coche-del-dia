// api/_lib/repesca/cors.test.js
// Regresión del bug "la repesca no carga en la app": los tres handlers de
// repesca hacían methodGuard SIN applyCors previo. Desde la app Android el
// origen es https://localhost y todas las llamadas llevan Authorization, lo
// que obliga al navegador a un preflight OPTIONS — que se comía un 405 y
// mataba el fetch antes de que saliera. La foto se quedaba en skeleton y la
// repesca entera era inalcanzable desde el APK.
//
// El test entra por el MISMO sitio que el tráfico real (el catch-all
// api/repesca/[...action].js) para cubrir también el routing: si alguien
// añade una acción nueva y olvida el CORS, salta aquí.
//
// No toca Supabase ni sharp: applyCors va lo PRIMERO en cada handler, así que
// el preflight contesta 204 y retorna antes de que se ejecute nada más. Esa
// es justamente la propiedad que queremos atar — si el CORS se mueve por
// debajo del methodGuard o del gate de auth, el test falla.

import { describe, it, expect, vi } from "vitest";
import router from "../../repesca/[...action].js";

const APP_ORIGIN = "https://localhost";

function mockRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    setHeader: (k, v) => (headers[k] = v),
    end: vi.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(function () {
      return this;
    }),
  };
  return res;
}

function preflight(action) {
  return {
    method: "OPTIONS",
    url: `/api/repesca/${action}`,
    query: { action: [action] },
    headers: {
      origin: APP_ORIGIN,
      // Lo que manda el navegador en el preflight de la app: es el
      // Authorization el que fuerza que este OPTIONS exista.
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type",
    },
  };
}

describe("CORS de /api/repesca/* (preflight desde la app Android)", () => {
  for (const action of ["start", "validate", "image"]) {
    it(`${action}: preflight OPTIONS → 204 con ACAO, nunca 405`, async () => {
      const res = mockRes();
      await router(preflight(action), res);

      expect(res.statusCode).toBe(204);
      expect(res.headers["Access-Control-Allow-Origin"]).toBe(APP_ORIGIN);
      // Sin Authorization en Allow-Headers el preflight falla igual aunque
      // el status sea 204 — es el header que el navegador viene a negociar.
      expect(res.headers["Access-Control-Allow-Headers"]).toContain("Authorization");
      expect(res.headers["Access-Control-Allow-Methods"]).toContain("OPTIONS");
      // El 405 del methodGuard se escribía con res.status(405).json(...):
      // si vuelve a colarse por delante, este json() habrá corrido.
      expect(res.json).not.toHaveBeenCalled();
    });
  }

  it("la web (same-origin) no recibe headers CORS: la allowlist sigue cerrada", async () => {
    const res = mockRes();
    await router(
      { ...preflight("start"), headers: { origin: "https://cochedeldia.com" } },
      res
    );
    // El preflight se contesta igual (204), pero SIN ACAO: el navegador no lo
    // acepta y, en same-origin, tampoco lo necesita. Lo que importa es que no
    // estamos abriendo la API a orígenes de terceros.
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
