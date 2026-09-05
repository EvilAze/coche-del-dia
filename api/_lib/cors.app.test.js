// api/_lib/cors.app.test.js
// EL CONTRATO DE CORS DE LA APP, endpoint por endpoint.
//
// POR QUÉ EXISTE, en una frase: la app Android es el ÚNICO cliente
// cross-origin del proyecto, y un endpoint sin CORS no falla con un status
// legible — falla con «Failed to fetch» antes de salir del móvil. En web no se
// reproduce jamás (todo es same-origin), así que el hueco se descubre siempre
// tarde y siempre en un dispositivo.
//
// Ya ha pasado DOS veces:
//   · /api/repesca/{start,validate,image} → la repesca entera era inalcanzable
//     desde el APK, no solo su fotografía.
//   · /api/admin/* → el panel completo daba «Failed to fetch» en la app.
// Las dos veces el síntoma llegó desde un móvil, no desde un test.
//
// Así que este test no comprueba «los endpoints que hoy sabemos que necesitan
// CORS»: ESCANEA src/ buscando cada `/api/...` que el cliente nombra y exige
// una DECISIÓN declarada para cada uno. Un endpoint nuevo no puede aparecer en
// el front sin que alguien haya escrito aquí si necesita CORS o no, y por qué.
// Eso es lo que convierte esto en un guardarraíl y no en una foto del pasado.

import { describe, it, expect, vi } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import adminRouter from "../admin/[...slug].js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_ORIGIN = "https://localhost";

// ── LAS DECISIONES ────────────────────────────────────────────────────────
// `cors: true`  → lo pide la app con fetch ⇒ el handler DEBE responder al
//                 preflight.
// `cors: false` → no necesita, CON su motivo. Un `false` sin motivo no vale:
//                 el test lo rechaza, porque «no lo necesita» sin explicación
//                 es exactamente cómo se cuela el siguiente hueco.
const DECISIONES = {
  "/api/get-daily-car": { cors: true },
  "/api/validate-guess": { cors: true },
  "/api/list-cars": { cors: true },
  "/api/garage": { cors: true },
  "/api/daily-stats": { cors: true },
  "/api/delete-account": { cors: true },
  "/api/repesca/start": { cors: true },
  "/api/repesca/validate": { cors: true },
  "/api/repesca/image": { cors: true },
  "/api/admin/analytics": { cors: true },
  "/api/admin/audit": { cors: true },
  "/api/admin/save-car": { cors: true },
  "/api/admin/schedule": { cors: true },
  "/api/admin/seasons": { cors: true },
  "/api/admin/translate": { cors: true },
  "/api/admin/analyze-image": { cors: true },
  "/api/admin/describe-car": { cors: true },
  "/api/admin/moderacion": { cors: true },
  "/api/admin/estado": { cors: true },
  "/api/admin/mensajes": { cors: true },
  "/api/admin/emergency-swap": { cors: true },
  "/api/admin/car-report": { cors: true },

  "/api/push": {
    cors: false,
    motivo:
      "Web push NO existe en la app: isPushSupported() sale por false en " +
      "isNativePlatform() (src/lib/webpush.js) y el recordatorio nativo va por " +
      "LocalNotifications, sin servidor. Ninguna llamada a /api/push sale nunca " +
      "del APK. Si algún día la app usara push web, este endpoint necesita CORS.",
  },
};

// Endpoints que NO viajan como literal en src/ porque los sirve el servidor
// dentro de una respuesta (car.img) y se pintan en un <img>. Van documentados
// aquí para que su ausencia del escaneo sea deliberada y no un despiste:
// una etiqueta <img> no está sujeta a CORS, solo necesita URL absoluta en
// nativo — que es el OTRO bug de esta misma familia (apiUrl en EndScreen y
// Garage). /api/og-image igual: viaja como URL en el texto de compartir.
const SIN_FETCH = ["/api/daily-image", "/api/car-image", "/api/og-image"];

// `/api/` a pelo aparece en los `startsWith("/api/")` de CarImage, PhotoPeek y
// apiUrl: es una comprobación de prefijo, no un endpoint.
const NO_ES_ENDPOINT = new Set(["/api/", "/api"]);

function ficherosFuente(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) ficherosFuente(ruta, acc);
    else if (/\.(js|jsx)$/.test(entrada) && !/\.test\./.test(entrada)) acc.push(ruta);
  }
  return acc;
}

// Escanea src/ buscando `/api/...` DENTRO DE COMILLAS (literal o plantilla).
// Los comentarios del proyecto mencionan rutas constantemente («se sirve vía
// /api/repesca/image»), y ninguno va entre comillas: por eso el filtro es la
// comilla y no una lista de exclusiones que habría que mantener.
function endpointsQueNombraElCliente() {
  const encontrados = new Map();
  for (const fichero of ficherosFuente(join(RAIZ, "src"))) {
    const codigo = readFileSync(fichero, "utf8");
    for (const m of codigo.matchAll(/["`'](\/api\/[a-z0-9\-/]*)/gi)) {
      const ep = m[1];
      if (NO_ES_ENDPOINT.has(ep)) continue;
      if (!encontrados.has(ep)) encontrados.set(ep, new Set());
      encontrados.get(ep).add(fichero.replace(RAIZ + "/", ""));
    }
  }
  return encontrados;
}

// Endpoint → fichero que tiene que aplicar el CORS. Para los catch-all es el
// dispatcher: es la única puerta por la que entra el tráfico.
function ficheroQueAplicaCors(endpoint) {
  const resto = endpoint.slice("/api/".length);
  if (resto.startsWith("admin/")) return "api/admin/[...slug].js";
  if (resto.startsWith("repesca/")) return `api/_lib/repesca/${resto.slice("repesca/".length)}.js`;
  return `api/${resto}.js`;
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader: (k, v) => (headers[k] = v),
    end: vi.fn(),
    status(code) { this.statusCode = code; return this; },
    json: vi.fn(function () { return this; }),
  };
}

describe("contrato de CORS de la app Android", () => {
  const nombrados = endpointsQueNombraElCliente();

  it("todo /api/ que nombra el cliente tiene una decisión declarada", () => {
    const sinDecidir = [...nombrados.keys()].filter(
      (ep) => !(ep in DECISIONES) && !SIN_FETCH.includes(ep)
    );
    expect(
      sinDecidir,
      `Endpoints nuevos en src/ sin decisión de CORS en este test: ` +
        sinDecidir.map((ep) => `${ep} (${[...nombrados.get(ep)].join(", ")})`).join("; ") +
        `. Añádelos a DECISIONES: cors:true si la app los llama con fetch, ` +
        `cors:false + motivo si no.`
    ).toEqual([]);
  });

  it("no quedan decisiones para endpoints que ya nadie llama (contrato sin muertos)", () => {
    const huerfanos = Object.keys(DECISIONES).filter((ep) => !nombrados.has(ep));
    expect(
      huerfanos,
      `Declarados aquí pero ya no aparecen en src/: ${huerfanos.join(", ")}. ` +
        `Si el endpoint se retiró, quita su entrada.`
    ).toEqual([]);
  });

  it("cada cors:false lleva su motivo escrito", () => {
    for (const [ep, d] of Object.entries(DECISIONES)) {
      if (d.cors === false) {
        expect(typeof d.motivo === "string" && d.motivo.length > 40, `${ep} sin motivo`).toBe(true);
      }
    }
  });

  // El chequeo que habría cazado los dos bugs: quien dice necesitar CORS, lo
  // aplica de verdad en su fichero. Estático a propósito — invocar los ocho
  // handlers admin exigiría envs de Supabase que los tests no tienen.
  for (const [ep, d] of Object.entries(DECISIONES)) {
    if (!d.cors) continue;
    it(`${ep} aplica CORS en su handler`, () => {
      const fichero = ficheroQueAplicaCors(ep);
      const codigo = readFileSync(join(RAIZ, fichero), "utf8");
      const aplica = /applyCors\(req, res\)/.test(codigo) || /corsHeadersFor\(/.test(codigo);
      expect(aplica, `${fichero} no aplica CORS (lo necesita ${ep})`).toBe(true);
    });
  }
});

// Y la prueba de comportamiento, que es la que de verdad reproduce el fallo:
// el dispatcher admin tiene que CONTESTAR el preflight. Es barato porque
// applyCors va lo primero — antes del routing y de requireAdmin—, así que
// devuelve 204 sin tocar Supabase. Si alguien lo mueve por debajo de la auth,
// esto falla: un preflight no lleva credenciales, así que ahí se rechazaría
// siempre y el panel volvería a «Failed to fetch».
describe("preflight de /api/admin/* (el panel dentro del APK)", () => {
  it("OPTIONS desde la app → 204 con ACAO, nunca 404 ni 401", async () => {
    const res = mockRes();
    await adminRouter(
      {
        method: "OPTIONS",
        url: "/api/admin/save-car",
        query: { slug: ["save-car"] },
        headers: {
          origin: APP_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      },
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe(APP_ORIGIN);
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    // El 404 del routing y el 401 de requireAdmin se escriben con
    // res.status().json(): si alguno se cuela por delante, habrá corrido.
    expect(res.json).not.toHaveBeenCalled();
  });

  it("la web (same-origin) sigue sin recibir headers CORS", async () => {
    const res = mockRes();
    await adminRouter(
      {
        method: "OPTIONS",
        url: "/api/admin/save-car",
        query: { slug: ["save-car"] },
        headers: { origin: "https://cochedeldia.com" },
      },
      res
    );
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
