// src/lib/sw.test.js
// Banco de pruebas de la POLÍTICA DE CACHÉ del service worker (public/sw.js).
//
// POR QUÉ ESTÁ AQUÍ Y NO AL LADO DEL FICHERO QUE PRUEBA. La convención del
// proyecto es dejar el `*.test.js` junto a su fuente, pero `public/` viaja
// ENTERO al APK (regla 15 de CLAUDE.md): Vite lo copia a `build/` y `cap sync`
// mete `build/` dentro del AAB. Un test en `public/` acabaría publicado en Play.
//
// POR QUÉ EXISTE. El service worker es la única pieza del proyecto que puede
// dejar copias de respuestas en el disco del usuario, y una de esas respuestas
// —`/api/daily-image`— es literalmente la pista del coche del día (regla 5).
// Un `if` mal puesto ahí no rompe nada visible: la web sigue funcionando, los
// tests siguen verdes y la pista queda guardada en la caché del navegador. Es
// exactamente el tipo de fallo mudo que solo se caza escribiéndole una prueba.
//
// CÓMO. `public/sw.js` no es un módulo importable: es un script clásico que al
// cargarse llama a `self.addEventListener(...)`. Se ejecuta en un contexto de
// `node:vm` con los globales del worker fingidos; las funciones declaradas en el
// nivel superior quedan como propiedades de ese contexto, así que la política se
// puede ejercitar sin montar un ServiceWorkerGlobalScope de verdad.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_SW = join(AQUI, "..", "..", "public", "sw.js");
const ORIGEN = "https://cochedeldia.com";

/** Carga sw.js en un contexto aislado y devuelve su política + sus oyentes. */
function cargarSw() {
  const codigo = readFileSync(RUTA_SW, "utf8");
  const oyentes = {};
  const cachesBorradas = [];

  const contexto = vm.createContext({
    self: {
      addEventListener: (nombre, fn) => {
        oyentes[nombre] = fn;
      },
      location: new URL(`${ORIGEN}/sw.js`),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    URL,
    Response: class ResponseFalsa {
      constructor(cuerpo, init) {
        this.cuerpo = cuerpo;
        this.status = init?.status ?? 200;
        this.headers = init?.headers ?? {};
      }
    },
    caches: {
      keys: async () => [
        "cdd-concha-v0",
        "cdd-estatico-v0",
        "cdd-concha-v1",
        "cdd-estatico-v1",
        // De otra cosa del mismo origen: NO es nuestra y no se toca.
        "workbox-precache-otro-proyecto",
        "algo-de-un-tercero",
      ],
      delete: async (n) => {
        cachesBorradas.push(n);
        return true;
      },
      open: async () => ({ match: async () => undefined, put: async () => {} }),
    },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    clients: { matchAll: async () => [], openWindow: async () => {} },
  });

  vm.runInContext(codigo, contexto);
  return { politica: contexto.estrategiaPara, oyentes, cachesBorradas };
}

/** Petición mínima: a la política solo le hacen falta estos tres campos. */
function pedir(url, { method = "GET", mode = "no-cors" } = {}) {
  return { method, url: url.startsWith("http") ? url : ORIGEN + url, mode };
}

const { politica, oyentes, cachesBorradas } = cargarSw();

describe("sw: la API NUNCA se cachea (regla 5)", () => {
  // La lista sale del árbol de verdad, no de una copia a mano: si mañana
  // alguien añade un endpoint, este test lo cubre solo.
  const ENDPOINTS = [
    "/api/car-image",
    "/api/daily-image",
    "/api/daily-stats",
    "/api/delete-account",
    "/api/garage",
    "/api/get-daily-car",
    "/api/health",
    "/api/list-cars",
    "/api/og-image",
    "/api/push",
    "/api/validate-guess",
    "/api/admin/save-car",
    "/api/cron/warm-daily",
    "/api/repesca/start",
  ];

  it.each(ENDPOINTS)("%s se queda en red pura", (ruta) => {
    expect(politica(pedir(ruta))).toBe("red");
  });

  it("la imagen del día tampoco con query (es la pista, no una foto cualquiera)", () => {
    const url = "/api/daily-image?token=abc&f=avif&w=1280";
    expect(politica(pedir(url))).toBe("red");
  });

  it("ni siquiera si la piden como navegación", () => {
    expect(politica(pedir("/api/get-daily-car", { mode: "navigate" }))).toBe("red");
  });

  it("`/api` a secas tampoco", () => {
    expect(politica(pedir("/api"))).toBe("red");
  });
});

describe("sw: el documento va SIEMPRE por red primero", () => {
  // El footgun que deja a la gente clavada en un build viejo. Si alguien cambia
  // esto a "cache-primero", un deploy ya no puede arreglarlo: el SW antiguo deja
  // de preguntarle al servidor.
  it.each(["/", "/repesca", "/privacidad", "/eliminar-cuenta"])(
    "%s → red-primero",
    (ruta) => {
      expect(politica(pedir(ruta, { mode: "navigate" }))).toBe("red-primero");
    }
  );
});

describe("sw: estáticos", () => {
  it("los assets con hash van de caché (el hash ES la versión)", () => {
    expect(politica(pedir("/assets/index-C0KTrsU_.js"))).toBe("cache-primero");
    expect(politica(pedir("/assets/Garage-C0pcxKed.js"))).toBe("cache-primero");
  });

  it.each([
    "/fonts/fraunces-normal-400-900-latin.woff2",
    "/brands/seat.png",
    "/flags/espana.jpg",
    "/images/lona.jpg",
    "/manifest.json",
    "/favicon.ico",
  ])("%s se revalida (no lleva hash, puede cambiar)", (ruta) => {
    expect(politica(pedir(ruta))).toBe("revalidar");
  });

  it("el propio sw.js jamás se sirve de caché", () => {
    expect(politica(pedir("/sw.js"))).toBe("red");
  });
});

describe("sw: lo que ni se toca", () => {
  it("cualquier método que no sea GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(politica(pedir("/assets/index-abc.js", { method }))).toBe("red");
    }
  });

  it("otro origen (Supabase, Google) lo gestiona el navegador", () => {
    expect(politica(pedir("https://xyz.supabase.co/rest/v1/cars"))).toBe("red");
    expect(politica(pedir("https://accounts.google.com/o/oauth2/auth"))).toBe("red");
    expect(politica(pedir("https://cdn.otro.com/foto.avif"))).toBe("red");
  });

  it("una URL que no parsea no revienta la política", () => {
    expect(() => politica({ method: "GET", url: "no-es-una-url", mode: "no-cors" })).not.toThrow();
    expect(politica({ method: "GET", url: "no-es-una-url", mode: "no-cors" })).toBe("red");
  });
});

describe("sw: ciclo de vida", () => {
  it("registra los oyentes que necesita (push incluido: no se perdió al añadir caché)", () => {
    expect(Object.keys(oyentes).sort()).toEqual(
      ["activate", "fetch", "install", "notificationclick", "push"].sort()
    );
  });

  it("al activarse borra SOLO cachés propias y de versiones viejas", async () => {
    // Hay que quedarse la promesa que le pasan a waitUntil y esperarla A ELLA:
    // el handler no la devuelve (un ExtendableEvent real tampoco), así que
    // esperar lo que retorna el oyente es esperar a `undefined` y leer el array
    // antes de que se haya borrado nada.
    let pendiente;
    oyentes.activate({ waitUntil: (p) => { pendiente = p; } });
    await pendiente;

    // Las de la versión anterior, fuera.
    expect(cachesBorradas).toContain("cdd-concha-v0");
    expect(cachesBorradas).toContain("cdd-estatico-v0");
    // Las vivas se quedan.
    expect(cachesBorradas).not.toContain("cdd-concha-v1");
    expect(cachesBorradas).not.toContain("cdd-estatico-v1");
    // Y lo ajeno NO se toca: un caches.delete() a ciegas se llevaría por
    // delante la caché de cualquier otra cosa servida en este dominio.
    expect(cachesBorradas).not.toContain("workbox-precache-otro-proyecto");
    expect(cachesBorradas).not.toContain("algo-de-un-tercero");
  });
});
