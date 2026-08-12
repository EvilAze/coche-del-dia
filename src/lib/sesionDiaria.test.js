// src/lib/sesionDiaria.test.js
// El tope de "una marca por dispositivo y día" es TODO el valor de este módulo:
// sin él la serie de app vs web no es comparable (ver el comentario del
// módulo). Estos tests son lo que impide que se rompa sin que se note, porque
// el fallo natural aquí es silencioso — la RPC es fire-and-forget.
//
// El módulo arrastra supabaseClient (exige envs), así que va mockeado y se
// carga con import() dinámico. Mismo patrón que deleteAccount.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const HOY = "2026-08-12";

// localStorage de mentira, con la posibilidad de fallar como el real en modo
// privado.
function almacenFalso(inicial = null, { explota = false } = {}) {
  let valor = inicial;
  return {
    getItem: () => {
      if (explota) throw new Error("SecurityError");
      return valor;
    },
    setItem: (_k, v) => {
      if (explota) throw new Error("SecurityError");
      valor = v;
    },
    leer: () => valor,
  };
}

function clienteFalso({ falla = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    rpc: (nombre, args) => {
      llamadas.push({ nombre, args });
      // Réplica de la forma que devuelve supabase-js: un thenable al que el
      // módulo le pasa (undefined, onError).
      return {
        then: (ok, ko) => {
          if (falla) return ko?.(new Error("red"));
          return ok?.({ error: null });
        },
      };
    },
  };
}

async function cargar() {
  vi.doMock("../supabaseClient", () => ({ supabase: { rpc: () => ({ then: () => {} }) } }));
  return import("./sesionDiaria.js");
}

let registrar;

beforeEach(async () => {
  ({ registrarSesionDiaria: registrar } = await cargar());
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../supabaseClient");
});

describe("registrarSesionDiaria", () => {
  it("manda la marca la primera vez del día", () => {
    const almacen = almacenFalso();
    const cliente = clienteFalso();
    const enviado = registrar({
      logueado: true,
      deps: { hoy: HOY, almacen, cliente, plat: "app" },
    });

    expect(enviado).toBe(true);
    expect(cliente.llamadas).toEqual([
      {
        nombre: "increment_feature_event",
        args: { p_event: "sesion", p_auth: "user", p_plataforma: "app" },
      },
    ]);
    expect(almacen.leer()).toBe(HOY);
  });

  it("no repite si ya se marcó hoy", () => {
    const cliente = clienteFalso();
    const enviado = registrar({
      logueado: false,
      deps: { hoy: HOY, almacen: almacenFalso(HOY), cliente, plat: "web" },
    });

    expect(enviado).toBe(false);
    expect(cliente.llamadas).toHaveLength(0);
  });

  it("vuelve a marcar al cambiar el día", () => {
    const cliente = clienteFalso();
    const enviado = registrar({
      logueado: false,
      deps: { hoy: HOY, almacen: almacenFalso("2026-08-11"), cliente, plat: "web" },
    });

    expect(enviado).toBe(true);
    expect(cliente.llamadas[0].args.p_auth).toBe("anon");
    expect(cliente.llamadas[0].args.p_plataforma).toBe("web");
  });

  // Preferimos perder la métrica antes que contar un arranque por visita: en
  // modo privado no hay tope posible y una serie inflada engaña más que una
  // serie corta.
  it("no cuenta nada si no hay almacén o si localStorage explota", () => {
    const sinAlmacen = clienteFalso();
    expect(
      registrar({ logueado: false, deps: { hoy: HOY, almacen: null, cliente: sinAlmacen } })
    ).toBe(false);
    expect(sinAlmacen.llamadas).toHaveLength(0);

    const roto = clienteFalso();
    expect(
      registrar({
        logueado: false,
        deps: { hoy: HOY, almacen: almacenFalso(null, { explota: true }), cliente: roto },
      })
    ).toBe(false);
    expect(roto.llamadas).toHaveLength(0);
  });

  // Fire-and-forget de verdad: un fallo de red no puede propagarse al arranque
  // del juego.
  it("se traga el fallo de la RPC sin lanzar", () => {
    expect(() =>
      registrar({
        logueado: false,
        deps: {
          hoy: HOY,
          almacen: almacenFalso(),
          cliente: clienteFalso({ falla: true }),
          plat: "app",
        },
      })
    ).not.toThrow();
  });

  // Si el sello se escribiera DESPUÉS de la llamada, un fallo de red dejaría
  // reintentando en cada arranque de la sesión.
  it("sella el día aunque la RPC falle", () => {
    const almacen = almacenFalso();
    registrar({
      logueado: false,
      deps: {
        hoy: HOY,
        almacen,
        cliente: clienteFalso({ falla: true }),
        plat: "app",
      },
    });
    expect(almacen.leer()).toBe(HOY);
  });

  // La allowlist de verdad está en la RPC (cualquier otra cosa cae en
  // 'legacy'), pero el cliente tampoco debería mandar basura de entrada.
  it("por defecto resuelve la plataforma con plataforma()", () => {
    const cliente = clienteFalso();
    registrar({ logueado: false, deps: { hoy: HOY, almacen: almacenFalso(), cliente } });
    // Sin Capacitor en el entorno de test, plataforma() cae a "web" — el valor
    // que verá cualquier build servido por un navegador.
    expect(cliente.llamadas[0].args.p_plataforma).toBe("web");
  });
});
