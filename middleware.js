// middleware.js
// Edge Middleware que inyecta un `Link: rel=preload` de la imagen del coche
// del día en la respuesta HTML de la home. Objetivo: que el navegador
// descubra y empiece a descargar la imagen hero AL PARSEAR EL HTML, en
// paralelo con el bundle JS — sin esperar a que React ejecute
// /api/get-daily-car para conocer la URL. Rompe el waterfall:
//
//   ANTES:  HTML → JS → React → get-daily-car → daily-image
//   AHORA:  HTML (con Link preload) ─┬→ JS bundle
//                                    └→ daily-image (arranca ya, en paralelo)
//
// De dónde sale la URL: el cron `api/cron/warm-daily.js` la escribe cada
// noche en Vercel Edge Config bajo la clave `daily_preload` con forma
// `{ date, img }`. Edge Config se lee en <1ms desde el edge, así que no
// añadimos latencia perceptible al HTML (a diferencia de consultar
// Supabase aquí, que era la alternativa descartada).
//
// Degradación segura: si Edge Config no está configurado, está vacío, o la
// fecha guardada no es la de hoy (el cron falló esa noche), NO inyectamos
// nada y la página carga exactamente como antes — sin regresión, solo sin
// el adelanto del preload.
//
// Requisitos de plataforma:
//   - Edge Config store conectado al proyecto (inyecta env `EDGE_CONFIG`).
//   - El cron alimentándolo (ver warm-daily.js PASO 3).

import { next } from "@vercel/edge";
import { get } from "@vercel/edge-config";
import {
  cabeceraCookie,
  decidirPuerta,
} from "./api/_lib/edge/admin-gate.js";

export const config = {
  // Tres cometidos:
  //   "/"      → el preload de la imagen hero (lo de arriba). En el host
  //              interno, además, la redirección al panel.
  //   "/r/:p*" → los enlaces COMPARTIDOS, que llevan la partida en la ruta y
  //              necesitan un og:image propio (ver más abajo).
  //   el resto → LA PUERTA del panel interno (api/_lib/edge/admin-gate.js).
  //              Son las rutas que montan el panel en el cliente; en el host
  //              público la puerta las deja pasar sin tocarlas.
  // Nada más. Cuanto menos tráfico pase por aquí, menos superficie de fallo.
  matcher: [
    "/",
    "/r/:path*",
    "/admin-tools",
    "/admin-tools/:path*",
    "/preview",
    "/admin/:path*",
  ],
};

// ─── LA PUERTA DEL PANEL INTERNO ─────────────────────────────────────────────
// La decisión vive en api/_lib/edge/admin-gate.js (lógica pura, con su suite:
// el host de la petición es lo que la gobierna, y un Preview de Vercel tiene
// una URL distinta en cada deploy, así que los tests son la verificación).
//
// Las dos variables se leen aquí y no allí para que el módulo siga siendo puro:
//   ADMIN_HOST      subdominio del panel, p.ej. "taller.cochedeldia.com".
//   ADMIN_GATE_KEY  clave del enlace de arranque (?k=…). Cambiarla invalida
//                   todas las cookies emitidas.
// Si falta cualquiera de las dos, la puerta no existe y todo se comporta como
// antes: es el interruptor de emergencia si algo sale mal en producción.
const ADMIN_HOST = process.env.ADMIN_HOST || "";
const ADMIN_GATE_KEY = process.env.ADMIN_GATE_KEY || "";

// Cabeceras de toda respuesta del host interno. El nombre del subdominio es
// público (los certificados se publican en los logs de Certificate
// Transparency), así que al menos que no lo indexe nadie.
const CABECERAS_INTERNAS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "private, no-store",
};

function aplicarPuerta(request, url) {
  const decision = decidirPuerta({
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    cookieHeader: request.headers.get("cookie") || "",
    hostInterno: ADMIN_HOST,
    clave: ADMIN_GATE_KEY,
  });

  switch (decision.tipo) {
    case "redirigir":
      return new Response(null, {
        status: 307,
        headers: { Location: new URL(decision.a, url).toString(), ...CABECERAS_INTERNAS },
      });

    case "sellar":
      // Cookie + redirección a la URL sin la clave. Un solo viaje: al soltar
      // el enlace de arranque el navegador acaba ya dentro del panel.
      return new Response(null, {
        status: 307,
        headers: {
          Location: new URL(decision.a, url).toString(),
          "Set-Cookie": cabeceraCookie(ADMIN_GATE_KEY),
          ...CABECERAS_INTERNAS,
        },
      });

    case "seguir":
      // Renovamos la cookie en cada visita válida: así el año de caducidad se
      // cuenta desde la última vez que entré, y no desde que la sellé.
      return next({
        headers: { "Set-Cookie": cabeceraCookie(ADMIN_GATE_KEY), ...CABECERAS_INTERNAS },
      });

    case "ocultar":
      // 404 seco, sin cuerpo. Ni formulario, ni "no autorizado", ni nada que
      // confirme que en esta ruta hay algo que encontrar.
      return new Response(null, { status: 404, headers: CABECERAS_INTERNAS });

    default:
      return null; // "ajeno": que siga el flujo normal del middleware.
  }
}

// ─── ENLACES COMPARTIDOS: /r/DD-MM/CODIGO ───────────────────────────────────
// El og:image de index.html es estático e igual para todos, así que por sí solo
// no puede enseñar la partida de quien comparte. Aquí es donde se arregla: para
// las rutas /r/* cogemos el HTML, le cambiamos las etiquetas de imagen por
// /api/og-image?d=…&r=… y devolvemos eso. El crawler ve la tarjeta con la
// rejilla del jugador; el navegador de una persona recibe el mismo HTML de
// siempre y la SPA arranca igual (el ruteo de index.jsx ignora la ruta y cae a
// la portada).
//
// LA HOME NO PASA POR AQUÍ. Es deliberado y es media regla 9: transformar el
// cuerpo del HTML es la operación más arriesgada de todo el middleware, y no se
// le hace a la página que carga el 95% del tráfico. Si esto falla, falla solo
// para quien viene de un enlace compartido — y encima falla hacia `next()`, que
// sirve la página normal con la tarjeta genérica.
const RUTA_RESULTADO = /^\/r\/(\d{2}-\d{2})\/([0-7]{0,5})\/?$/;

function reescribirEtiquetas(html, fecha, codigo) {
  const tarjeta = `https://cochedeldia.com/api/og-image?d=${fecha}&r=${codigo}`;
  // Sustitución por atributo completo y no por búsqueda de la URL suelta: así
  // da igual si algún día cambia el valor por defecto en index.html.
  return html
    .replace(
      /(<meta\s+property="og:image"\s+content=")[^"]*(")/,
      `$1${tarjeta}$2`
    )
    .replace(
      /(<meta\s+property="og:image:secure_url"\s+content=")[^"]*(")/,
      `$1${tarjeta}$2`
    )
    .replace(
      /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/,
      `$1${tarjeta}$2`
    );
}

async function servirEnlaceCompartido(request, url) {
  const m = url.pathname.match(RUTA_RESULTADO);
  if (!m) return null; // /r/ con forma rara → que siga el flujo normal
  const [, fecha, codigo] = m;

  // El HTML base, pedido a nuestro propio origen. `/index.html` NO está en el
  // matcher, así que esta petición no vuelve a entrar aquí (nada de bucles).
  const res = await fetch(new URL("/index.html", url), {
    headers: { "x-middleware-og": "1" },
  });
  if (!res.ok) return null;

  const html = await res.text();
  return new Response(reescribirEtiquetas(html, fecha, codigo), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Cacheable en el edge: la partida de un enlace concreto no cambia nunca.
      // El crawler y las visitas siguientes se sirven sin recomponer nada.
      "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

// Fecha de hoy en Europe/Madrid (YYYY-MM-DD). Mismo formato que usa el
// resto del backend (todayInMadrid) y que el cron guarda en `date`.
function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// srcset/sizes DEBEN coincidir byte-a-byte con los del <picture> de
// CarImage.jsx. Si difieren, el navegador no reusa el recurso precargado
// y descarga dos veces. Si tocas el srcset de CarImage, tócalo también aquí.
const IMAGE_SIZES =
  "(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px";

// ---- Caché de la lectura de Edge Config -------------------------------
// `daily_preload` solo cambia UNA vez al día (lo escribe el cron por la
// noche), pero el middleware corre en CADA visita a "/". Leer Edge Config
// por request consumía la cuota del free tier (50k lecturas/mes) en
// proporción directa al tráfico → riesgo de que Vercel pause el proyecto.
//
// Cacheamos el valor en una variable a nivel de módulo. El isolate edge,
// mientras está caliente, reusa el valor sin volver a tocar Edge Config.
// Esto desacopla las lecturas del volumen de tráfico: pasan de "una por
// visita" a, en régimen estable, "una por isolate y día".
//
// Re-leemos solo cuando:
//   - aún no tenemos el valor de HOY (cache.value.date !== today), p.ej.
//     tras un cold start o en la ventana posterior a medianoche antes de
//     que el cron haya escrito el valor del nuevo día; y
//   - han pasado >= RETRY_MS desde la última lectura (throttle para no
//     martillear Edge Config si el cron se retrasa o falla esa noche).
//
// Seguro por diseño: si el cache trae el valor de ayer, el guard
// `preload.date === todayInMadrid()` de abajo simplemente NO inyecta
// preload (degradación limpia, sin regresión), igual que cuando Edge
// Config no está configurado.
const RETRY_MS = 5 * 60 * 1000; // 5 min
let cache = null; // { value, fetchedAt }

async function getPreloadCached(today) {
  const haveToday = cache && cache.value?.date === today;
  const recentlyFetched = cache && Date.now() - cache.fetchedAt < RETRY_MS;
  // Si ya tenemos el valor de hoy, o leímos hace muy poco (aunque saliera
  // vacío/stale), reusamos lo cacheado sin gastar una lectura.
  if (haveToday || recentlyFetched) return cache.value;

  const value = await get("daily_preload");
  cache = { value, fetchedAt: Date.now() };
  return value;
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // LA PUERTA VA PRIMERO, y va envuelta en try/catch como todo lo demás: si
  // algo aquí explota, preferimos el comportamiento de siempre a una web
  // caída. El caso normal —una visita al host público— sale en el primer
  // `if` del módulo sin tocar nada.
  try {
    const respuesta = aplicarPuerta(request, url);
    if (respuesta) return respuesta;
  } catch {
    // Puerta averiada: seguimos el flujo normal. Se degrada hacia "el panel
    // vuelve a estar accesible", no hacia "la web no carga".
  }

  // Enlaces compartidos: su propio camino, y ninguno de los dos se pisa.
  if (url.pathname.startsWith("/r/")) {
    try {
      const respuesta = await servirEnlaceCompartido(request, url);
      if (respuesta) return respuesta;
    } catch {
      // Cualquier fallo (el fetch del HTML, un regex que no casa) cae a la
      // página normal con la tarjeta genérica. Un preview menos personalizado
      // es infinitamente mejor que un enlace roto.
    }
    return next();
  }

  // EL PRELOAD ES SOLO DE LA HOME. El matcher ya no es únicamente "/" y
  // "/r/*": desde que vigila las rutas del panel, sin este guard una visita a
  // /admin-tools en el host público gastaría una lectura de Edge Config (cuota
  // del free tier) para inyectar un preload en una página que no lleva foto.
  if (url.pathname !== "/") return next();

  try {
    const today = todayInMadrid();
    const preload = await getPreloadCached(today);

    // Guard anti-stale: solo inyectamos si el cron escribió HOY. Si la
    // clave es de ayer (cron falló) o no existe, no arriesgamos a precargar
    // una imagen que ya no es la del día.
    if (preload?.img && preload.date === today) {
      // `preload.img` = "/api/daily-image?d=YYYY-MM-DD&v=HASH"
      // Reconstruimos las 3 variantes AVIF del crop de juego (z=5), igual
      // que pide el cliente durante "playing".
      const variant = `${preload.img}&z=5&f=avif`;
      const srcset =
        `${variant}&w=640 640w, ` +
        `${variant}&w=1280 1280w, ` +
        `${variant}&w=1920 1920w`;
      // Fallback para navegadores que no entiendan imagesrcset en el Link
      // header: 1280w es la mejor apuesta universal (móvil con DPR alto y
      // desktop ≤1280px ambos tiran hacia ahí).
      const fallback = `${variant}&w=1280`;

      const linkHeader =
        `<${fallback}>; rel=preload; as=image; fetchpriority=high; ` +
        `imagesrcset="${srcset}"; imagesizes="${IMAGE_SIZES}"`;

      return next({ headers: { Link: linkHeader } });
    }
  } catch {
    // EDGE_CONFIG no inyectado / error de lectura → seguimos sin preload.
    // Nunca rompemos el HTML por esto.
  }

  return next();
}
