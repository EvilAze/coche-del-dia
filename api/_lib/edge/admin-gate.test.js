// api/_lib/edge/admin-gate.test.js
// La puerta del panel interno no se puede probar en un Preview de Vercel: su
// comportamiento depende del HOST de la petición, y el Preview tiene una URL
// *.vercel.app distinta en cada deploy. Así que esta suite ES la verificación.
//
// Lo que se protege aquí, por orden de gravedad si se rompe:
//   1. Quedarme encerrado fuera del panel (envs a medias, cookie que no casa).
//   2. Dejar una ruta interna sin vigilar (los alias por query son fáciles de
//      olvidar: montan el panel exactamente igual que las rutas).
//   3. Filtrar la clave a la barra de direcciones o al Referer.
//   4. Tocar el host público, que es la regla 9 (no degradar la home).

import { describe, it, expect } from "vitest";
import {
  COOKIE_PUERTA,
  cabeceraCookie,
  decidirPuerta,
  esRutaInterna,
  igualdadLenta,
  leerCookie,
} from "./admin-gate.js";

const HOST = "taller.example.com";
const CLAVE = "clave-larga-de-ejemplo-1234567890";
const CONFIG = { hostInterno: HOST, clave: CLAVE };

// Atajo: una petición al host interno.
function interna(pathname, extra = {}) {
  return decidirPuerta({ hostname: HOST, pathname, ...CONFIG, ...extra });
}

describe("esRutaInterna", () => {
  it("reconoce la ruta canónica y sus subrutas", () => {
    expect(esRutaInterna("/admin-tools")).toBe(true);
    expect(esRutaInterna("/admin-tools/")).toBe(true);
    expect(esRutaInterna("/admin-tools/loquesea")).toBe(true);
  });

  it("reconoce las rutas legacy que siguen montando el panel", () => {
    expect(esRutaInterna("/admin/edit-car")).toBe(true);
    expect(esRutaInterna("/admin/add-car")).toBe(true);
    expect(esRutaInterna("/preview")).toBe(true);
  });

  it("reconoce los alias por query string", () => {
    expect(esRutaInterna("/", "?admin-tools")).toBe(true);
    expect(esRutaInterna("/", "?foo=1&preview")).toBe(true);
    expect(esRutaInterna("/", "?admin-edit-car=1")).toBe(true);
  });

  // Falso positivo caro: si esto diera true, el middleware vigilaría rutas
  // públicas del juego y podría acabar devolviendo 404 en la web.
  it("no confunde rutas públicas ni prefijos parecidos", () => {
    expect(esRutaInterna("/")).toBe(false);
    expect(esRutaInterna("/repesca")).toBe(false);
    expect(esRutaInterna("/privacidad")).toBe(false);
    expect(esRutaInterna("/admin-tools-falso")).toBe(false);
    expect(esRutaInterna("/", "?utm_source=push")).toBe(false);
  });
});

describe("leerCookie", () => {
  it("saca el valor entre otras cookies y tolera espacios", () => {
    expect(leerCookie(`a=1; ${COOKIE_PUERTA}=xyz; b=2`, COOKIE_PUERTA)).toBe("xyz");
    expect(leerCookie(`  ${COOKIE_PUERTA} = xyz  `, COOKIE_PUERTA)).toBe("xyz");
  });

  it("no confunde una cookie cuyo nombre contiene al buscado", () => {
    expect(leerCookie(`x${COOKIE_PUERTA}=no`, COOKIE_PUERTA)).toBe(null);
  });

  it("devuelve null sin cabecera, sin la cookie o con %-escapes rotos", () => {
    expect(leerCookie("", COOKIE_PUERTA)).toBe(null);
    expect(leerCookie("otra=1", COOKIE_PUERTA)).toBe(null);
    expect(leerCookie(`${COOKIE_PUERTA}=%E0%A4%A`, COOKIE_PUERTA)).toBe(null);
  });
});

describe("igualdadLenta", () => {
  it("casa lo idéntico y rechaza lo distinto", () => {
    expect(igualdadLenta("abc", "abc")).toBe(true);
    expect(igualdadLenta("abc", "abd")).toBe(false);
    expect(igualdadLenta("abc", "abcd")).toBe(false);
  });

  it("trata null/undefined como cadena vacía sin explotar", () => {
    expect(igualdadLenta(null, "")).toBe(true);
    expect(igualdadLenta(undefined, "x")).toBe(false);
  });
});

describe("decidirPuerta — desactivada", () => {
  // El interruptor de emergencia: borrar ADMIN_HOST devuelve el
  // comportamiento anterior en el siguiente deploy.
  it("es ajena a todo si falta el host o la clave", () => {
    const base = { hostname: HOST, pathname: "/admin-tools" };
    expect(decidirPuerta({ ...base, hostInterno: "", clave: CLAVE }).tipo).toBe("ajeno");
    expect(decidirPuerta({ ...base, hostInterno: HOST, clave: "" }).tipo).toBe("ajeno");
    expect(decidirPuerta({ ...base, hostInterno: "", clave: "" }).tipo).toBe("ajeno");
  });
});

describe("decidirPuerta — host público", () => {
  const publico = (pathname, search = "") =>
    decidirPuerta({ hostname: "cochedeldia.com", pathname, search, ...CONFIG });

  // Regla 9: por aquí pasa el 95% del tráfico. La puerta no toca NADA.
  it("no se mete en la home ni en las rutas del juego", () => {
    expect(publico("/").tipo).toBe("ajeno");
    expect(publico("/r/12-08/01234").tipo).toBe("ajeno");
  });

  // Deliberado: en el apex /admin-tools NO devuelve 404 ni redirige, porque un
  // 404 en esa ruta y solo en esa ruta sería precisamente la confirmación de
  // que ahí hay algo. Se comporta como cualquier ruta inexistente; de no
  // montar el panel se encarga el guard de hostname del cliente.
  it("deja /admin-tools indistinguible de una ruta cualquiera", () => {
    expect(publico("/admin-tools").tipo).toBe("ajeno");
    expect(publico("/preview").tipo).toBe("ajeno");
  });

  it("ignora el caso del host y el puerto", () => {
    expect(decidirPuerta({ hostname: HOST.toUpperCase(), pathname: "/admin-tools", ...CONFIG }).tipo)
      .toBe("ocultar");
    expect(decidirPuerta({ hostname: `${HOST}:443`, pathname: "/admin-tools", ...CONFIG }).tipo)
      .toBe("ocultar");
  });
});

describe("decidirPuerta — host interno", () => {
  it("manda la raíz al panel (start_url del icono instalado)", () => {
    expect(interna("/")).toEqual({ tipo: "redirigir", a: "/admin-tools" });
  });

  it("oculta el panel sin cookie", () => {
    expect(interna("/admin-tools").tipo).toBe("ocultar");
  });

  it("deja pasar con la cookie correcta", () => {
    expect(
      interna("/admin-tools", { cookieHeader: `${COOKIE_PUERTA}=${CLAVE}` }).tipo
    ).toBe("seguir");
  });

  it("oculta con cookie equivocada o vacía", () => {
    expect(interna("/admin-tools", { cookieHeader: `${COOKIE_PUERTA}=otra` }).tipo).toBe("ocultar");
    expect(interna("/admin-tools", { cookieHeader: `${COOKIE_PUERTA}=` }).tipo).toBe("ocultar");
  });

  it("sella y limpia la URL cuando llega la clave buena", () => {
    expect(interna("/admin-tools", { search: `?k=${CLAVE}` })).toEqual({
      tipo: "sellar",
      a: "/admin-tools",
    });
  });

  // La clave sale de la URL, el resto del estado del panel se queda: si el
  // enlace de arranque apuntaba a un tab concreto, no se pierde.
  it("conserva los demás parámetros al sellar", () => {
    expect(interna("/admin-tools", { search: `?tab=analytics&k=${CLAVE}` })).toEqual({
      tipo: "sellar",
      a: "/admin-tools?tab=analytics",
    });
  });

  it("oculta si la clave es la equivocada (mismo 404, sin pistas)", () => {
    expect(interna("/admin-tools", { search: "?k=no" }).tipo).toBe("ocultar");
    expect(interna("/admin-tools", { search: "?k=" }).tipo).toBe("ocultar");
  });

  it("vigila también las rutas legacy y los alias por query", () => {
    expect(interna("/preview").tipo).toBe("ocultar");
    expect(interna("/admin/edit-car").tipo).toBe("ocultar");
    // El alias por query en la raíz: la raíz redirige ANTES de mirar el alias,
    // y el destino ya pasa por la puerta. Lo que importa es que no haya
    // ninguna forma de montar el panel sin cookie.
    expect(interna("/", { search: "?admin-tools" }).tipo).toBe("redirigir");
    expect(interna("/x", { search: "?admin-tools" }).tipo).toBe("ocultar");
  });

  it("no se mete en los assets del bundle ni en la API", () => {
    expect(interna("/assets/index-abc123.js").tipo).toBe("ajeno");
    expect(interna("/api/admin/analytics").tipo).toBe("ajeno");
  });
});

describe("cabeceraCookie", () => {
  it("emite la cookie blindada y con caducidad larga", () => {
    const c = cabeceraCookie(CLAVE);
    expect(c).toContain(`${COOKIE_PUERTA}=${CLAVE}`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
    expect(c).toMatch(/Max-Age=\d{7,}/);
    // Sin Domain: host-only. Si apareciera, la cookie viajaría al apex.
    expect(c).not.toContain("Domain");
  });

  it("escapa una clave con caracteres raros", () => {
    expect(cabeceraCookie("a b;c")).toContain(`${COOKIE_PUERTA}=a%20b%3Bc`);
  });

  it("la cookie que emite es la que la puerta acepta (ida y vuelta)", () => {
    // El test que de verdad me protege de quedarme fuera: lo que sale del
    // Set-Cookie tiene que volver a entrar por leerCookie.
    const emitida = cabeceraCookie(CLAVE);
    const valor = emitida.split(";")[0];
    expect(interna("/admin-tools", { cookieHeader: valor }).tipo).toBe("seguir");
  });
});
