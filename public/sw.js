// public/sw.js
// Service worker: push + LA CONCHA OFFLINE.
//
// Vite sirve public/ en la raíz → disponible en /sw.js con scope "/". Solo se
// registra en WEB: src/index.jsx tiene un guard explícito de nativo, porque en
// el APK los assets ya viajan dentro y no hay nada que cachear.
//
// ── POR QUÉ EXISTE LA PARTE DE CACHÉ ────────────────────────────────────────
// La web tenía toda la UI de "sin conexión" cuidada —EdicionNoDisponible con su
// reintento, CatalogoCaido, el hook useOnline— y NUNCA llegaba a pintarse en una
// carga en frío: sin red no hay documento, así que el navegador enseñaba su
// propia página de error y nuestro cartel no existía. La app Android no tenía
// ese problema (el bundle va dentro del APK), y por eso el agujero pasó
// desapercibido: era exclusivo de la web.
//
// Lo que arregla esto es exactamente eso y nada más: que el DOCUMENTO y los
// ESTÁTICOS estén disponibles sin red, para que React arranque y enseñe el
// cartel bueno —traducido, con su botón de reintentar— en vez del dinosaurio.
// El coche del día sigue necesitando servidor, y debe seguir necesitándolo.
//
// ── LO QUE NO SE CACHEA, Y ES LO IMPORTANTE ─────────────────────────────────
// `/api/*` NUNCA. No es una cuestión de frescura sino de la regla 5 de
// CLAUDE.md: `/api/daily-image` sirve el recorte del coche de HOY al nivel de
// zoom del intento en curso. Guardarlo en una caché del navegador sería dejar
// la pista del día en disco, legible entre sesiones y por cualquiera que abra
// las DevTools — justo lo que el proxy de imagen viene a evitar. Y
// `/api/get-daily-car` servido de caché le daría al jugador la partida de ayer
// como si fuera la de hoy. La API se queda SIEMPRE en red pura.
//
// ── LOS DOS FOOTGUNS CLÁSICOS, Y CÓMO SE ESQUIVAN ───────────────────────────
// 1. Clavar a la gente en una versión vieja. El documento va SIEMPRE por red
//    primero; la caché es el plan B de cuando no hay red, jamás el plan A. Un
//    `cache-first` sobre el HTML es lo que deja a un usuario con el build del
//    mes pasado hasta que borre datos del sitio, y no se puede arreglar con un
//    deploy porque el SW viejo ya no consulta al servidor.
// 2. Servir un HTML nuevo con assets que ya no existen. Los ficheros de
//    `/assets/` llevan hash de contenido: el nombre ES la versión, así que
//    `cache-first` sobre ellos es correcto por construcción — un hash dado
//    siempre significa el mismo byte.
//
// ── POR QUÉ NO HAY PRECACHÉ EN `install` ────────────────────────────────────
// Sería el momento natural para guardar la concha, pero los nombres de
// `/assets/` los decide Vite en cada build y este fichero se copia tal cual, sin
// pasar por el bundler: aquí no se conocen. Precachear solo el HTML sería PEOR
// que no hacer nada —documento sin su JavaScript es una pantalla en blanco, y
// una pantalla en blanco es peor que la página de error del navegador, que al
// menos explica lo que pasa—. Así que la concha se llena sola durante la primera
// visita controlada, y el offline funciona a partir de la segunda. Es el caso
// real: para estar sin cobertura en cochedeldia.com hay que haber entrado antes.

// Subir esto invalida TODAS las cachés (el activate borra las que no estén en
// CACHES_VIVOS). Tócalo solo si cambia la estrategia, no en cada deploy: los
// assets ya se versionan solos por hash.
const VERSION = "v1";
const CACHE_CONCHA = `cdd-concha-${VERSION}`;
const CACHE_ESTATICO = `cdd-estatico-${VERSION}`;
const CACHES_VIVOS = new Set([CACHE_CONCHA, CACHE_ESTATICO]);

// UNA sola entrada de documento para TODAS las rutas. La SPA rutea en cliente
// (src/index.jsx lee window.location) y vercel.json reescribe cualquier ruta sin
// extensión a /index.html, así que guardar una copia por URL visitada sería
// guardar el mismo documento N veces con N llaves distintas.
const LLAVE_DOCUMENTO = "/index.html";

/**
 * Qué hacer con una petición. Función PURA y declarada en el nivel superior a
 * propósito: es la única pieza de este fichero con reglas de negocio de verdad
 * (la de la regla 5, entre ellas). Así `src/lib/sw.test.js` puede cargar este
 * script en un contexto de `node:vm` y ejercitarla sin montar un
 * ServiceWorkerGlobalScope entero. (El test vive en src/ y no aquí al lado
 * porque `public/` viaja entero al APK — regla 15.)
 *
 * Devuelve: "red" | "red-primero" | "cache-primero" | "revalidar"
 */
function estrategiaPara(request) {
  // Solo GET. Un POST/PATCH/DELETE no se cachea ni se sirve de caché jamás:
  // enviar un intento no es una lectura, y responderlo desde disco sería
  // inventarse un veredicto.
  if (request.method !== "GET") return "red";

  let url;
  try {
    url = new URL(request.url);
  } catch {
    // URL que no parsea: no es asunto nuestro.
    return "red";
  }

  // Otro origen (Supabase, Google, tiles de terceros): que lo gestione el
  // navegador con sus propias reglas. Cachear respuestas opacas ocupa cuota sin
  // dejarnos siquiera comprobar si venían bien.
  if (url.origin !== self.location.origin) return "red";

  // ── LA LÍNEA QUE NO SE CRUZA (regla 5) ──────────────────────────────────
  // Ver el bloque de arriba. Si algún día se añade un endpoint que parezca
  // cacheable, la respuesta sigue siendo no: la ganancia es un viaje de red y
  // el precio es la pista del día en disco.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return "red";

  // El propio service worker nunca desde caché, o no habría forma de
  // actualizarlo. (El navegador ya lo trata aparte, pero dejarlo escrito evita
  // que alguien lo meta sin querer en una regla por extensión.)
  if (url.pathname === "/sw.js") return "red";

  // El documento: red primero SIEMPRE (footgun 1).
  if (request.mode === "navigate") return "red-primero";

  // Assets con hash de contenido en el nombre (footgun 2): inmutables.
  if (url.pathname.startsWith("/assets/")) return "cache-primero";

  // Estáticos SIN hash: fuentes, iconos, banderas, logos de marca, manifest.
  // Cambian rarísimo pero pueden cambiar, así que se sirven de caché y se
  // refrescan por detrás — nunca se quedan clavados.
  // El rango va escapado a propósito (regla 14 de CLAUDE.md): un re-guardado
  // con codificación mala convierte los literales no-ASCII en rangos inválidos
  // y tumba el fichero entero al parsearlo.
  if (/\.(?:woff2|woff|ttf|png|jpe?g|avif|webp|svg|ico|css|json|txt|xml)$/i.test(url.pathname)) {
    return "revalidar";
  }

  return "red";
}

/** Red primero; si no hay red, la copia de la concha; si no, el cartel mínimo. */
async function redPrimero(request) {
  try {
    const res = await fetch(request);
    // Solo se guarda una respuesta BUENA. Guardar un 500 o un 404 dejaría la
    // concha envenenada hasta el siguiente deploy.
    //
    // Y ojo con el `res.ok`, que aquí hace un segundo trabajo NO evidente: las
    // peticiones de navegación llegan con `redirect: "manual"`, así que un 3xx
    // no se sigue sino que se devuelve como respuesta *opaqueredirect*, con
    // `status` 0 y `ok` false. O sea, un redirect ni se cachea ni se toca: se
    // devuelve tal cual y lo sigue el navegador. De eso depende que siga
    // funcionando la puerta del panel interno (regla 19), que responde 307 en
    // `/` del host interno. Si alguien relaja esta condición —«guardemos
    // también los 3xx»— rompe justo eso.
    if (res && res.ok) {
      const cache = await caches.open(CACHE_CONCHA);
      await cache.put(LLAVE_DOCUMENTO, res.clone());
    }
    return res;
  } catch {
    // `caches.open()` y no `caches.match(req, {cacheName})`: con un cacheName
    // que todavía no existe, la segunda forma resuelve undefined en unos
    // navegadores y RECHAZA en otros. `open` crea la caché si falta, así que
    // este camino se comporta igual en todos — y es justo el camino del que
    // depende que se vea el cartel en vez de un error.
    const cache = await caches.open(CACHE_CONCHA);
    const guardado = await cache.match(LLAVE_DOCUMENTO);
    if (guardado) return guardado;
    return carteSinConexion();
  }
}

/** Inmutable: si está, se sirve sin preguntar. */
async function cachePrimero(request) {
  const cache = await caches.open(CACHE_ESTATICO);
  const guardado = await cache.match(request);
  if (guardado) return guardado;
  // Sin red y sin copia no hay nada que inventar: dejamos que el fallo suba tal
  // cual. Fabricar un 503 aquí solo cambiaría el mensaje de error del navegador.
  const res = await fetch(request);
  if (res && res.ok) await cache.put(request, res.clone());
  return res;
}

/**
 * Stale-while-revalidate. Devuelve lo que haya al instante y actualiza por
 * detrás. `enSegundoPlano` lo engancha el handler a event.waitUntil(): sin eso
 * el navegador puede matar el worker en cuanto responde y la actualización no
 * llega nunca.
 */
function revalidar(request) {
  const pendiente = (async () => {
    const cache = await caches.open(CACHE_ESTATICO);
    const guardado = await cache.match(request);
    const red = fetch(request)
      .then(async (res) => {
        if (res && res.ok) await cache.put(request, res.clone());
        return res;
      })
      .catch(() => null);

    if (guardado) return { res: guardado, enSegundoPlano: red };
    const res = await red;
    // Sin copia y sin red: que falle como fallaría sin service worker.
    if (!res) throw new Error("sin red y sin copia");
    return { res, enSegundoPlano: null };
  })();

  return pendiente;
}

/**
 * El último recurso: alguien que llega sin red y sin haber entrado nunca. No
 * usa i18n ni tokens del tema A PROPÓSITO —igual que ErrorFallback.jsx—: se
 * pinta cuando no hay NADA cargado, así que cuantas menos dependencias tenga,
 * menos formas hay de que el propio cartel también falle. Colores del tema
 * papel/tinta escritos a mano por la misma razón.
 */
function carteSinConexion() {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sin conexion - El Coche del Dia</title>
<style>
  html,body{margin:0;height:100%}
  body{background:#f3eee1;color:#1b1712;font-family:Georgia,'Times New Roman',serif;
       display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .k{font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;
     letter-spacing:.2em;text-transform:uppercase;color:#b3271b;margin:0}
  h1{font-size:26px;line-height:1.2;margin:10px 0 0}
  p{color:#6e6553;font-size:15px;line-height:1.55;margin:12px auto 0;max-width:34ch}
  button{margin-top:26px;background:none;border:1px solid #1b1712;color:#1b1712;
         font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;
         letter-spacing:.14em;text-transform:uppercase;padding:12px 32px;cursor:pointer}
</style>
</head>
<body>
  <main>
    <p class="k">Fe de erratas</p>
    <h1>La edicion no ha llegado al quiosco</h1>
    <p>No hay conexion. En cuanto vuelva la red podras jugar el coche de hoy.</p>
    <button onclick="location.reload()">Reintentar</button>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Que no se quede pegado en ninguna caché intermedia: es un cartel de un
      // momento malo, no una página del sitio.
      "Cache-Control": "no-store",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const estrategia = estrategiaPara(event.request);

  // "red" = ni tocamos la petición. Sin respondWith el navegador la hace tal
  // cual, que es más barato y más seguro que hacer un fetch() de paso.
  if (estrategia === "red") return;

  if (estrategia === "red-primero") {
    event.respondWith(redPrimero(event.request));
    return;
  }

  if (estrategia === "cache-primero") {
    event.respondWith(cachePrimero(event.request));
    return;
  }

  if (estrategia === "revalidar") {
    event.respondWith(
      revalidar(event.request).then(({ res, enSegundoPlano }) => {
        if (enSegundoPlano) event.waitUntil(enSegundoPlano);
        return res;
      })
    );
  }
});

self.addEventListener("install", () => {
  // Sin precaché (ver el bloque de arriba). `skipWaiting` para que el SW nuevo
  // releve al viejo sin esperar a que se cierren todas las pestañas: como el
  // documento va por red y los assets por hash, un relevo a media sesión no
  // puede servir contenido de otra versión.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Solo se borran cachés NUESTRAS (prefijo cdd-). Un `caches.delete()` a
      // ciegas se llevaría por delante las de cualquier otra cosa del origen.
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith("cdd-") && !CACHES_VIVOS.has(n))
          .map((n) => caches.delete(n))
      );
      // Tomar el control de las pestañas ya abiertas: sin esto el SW recién
      // instalado no gobierna nada hasta la siguiente navegación, y la primera
      // visita se iría sin dejar concha.
      await self.clients.claim();
    })()
  );
});

// ── PUSH (lo que ya había) ──────────────────────────────────────────────────

// Al recibir un push, mostramos la notificación. El payload lo manda el server
// como JSON {title, body, url}. Fallback defensivo si llega vacío/no-JSON.
self.addEventListener("push", (event) => {
  // El fallback de url lleva UTM igual que el payload del servidor: si por lo
  // que sea llega un push sin datos, el retorno se sigue atribuyendo a "push".
  let data = {
    title: "El Coche del Día",
    body: "Ya puedes jugar al coche de hoy 🚗",
    url: "/?utm_source=push&utm_medium=web_push",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* payload no-JSON: usamos el fallback */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/web-app-manifest-192x192.png",
      badge: "/web-app-manifest-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Al pulsar la notificación: si ya hay una pestaña del juego, la enfocamos;
// si no, abrimos una nueva en la URL indicada.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});
