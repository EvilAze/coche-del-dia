// api/_lib/edge/admin-gate.js
// ---------------------------------------------------------------------
// LA PUERTA del panel interno. Lógica PURA (sin Request, sin Response, sin
// process.env) para que `middleware.js` se limite a traducir la decisión a
// una respuesta del Edge Runtime y esta parte se pueda testear de verdad.
//
// POR QUÉ EXISTE. El panel vivía en `cochedeldia.com/admin-tools`, y eso
// traía dos problemas que no se arreglan con más autenticación:
//
//   1. El App Link. El manifest de Android declara `cochedeldia.com` SIN
//      pathPattern —a propósito: la app es la misma SPA y atiende cualquier
//      ruta—, así que un clic en un resultado de Google hacia /admin-tools
//      abría la APP en vez del navegador. Los intent filters no tienen
//      negación: no se puede excluir una ruta. La única salida es que el
//      panel viva en un host que el manifest NO declare.
//   2. Estaba a la vista. Cualquiera podía cargar la pantalla de login del
//      panel y saber que existe. Los datos nunca estuvieron en riesgo
//      (requireAdmin exige sesión de Google + email en ADMIN_EMAILS), pero
//      "no se sabe que existe" es una capa que aquí sale casi gratis.
//
// CÓMO QUEDA. Dos hosts, un solo deploy y un solo bundle:
//
//   cochedeldia.com/admin-tools   → el middleware NO se mete (sigue siendo
//                                   una ruta desconocida más, que la SPA
//                                   resuelve cayendo a la portada; ver el
//                                   guard de hostname en src/index.jsx).
//   <ADMIN_HOST>/                 → 307 a /admin-tools, para que el icono
//                                   instalado en el móvil abra el panel.
//   <ADMIN_HOST>/admin-tools?k=…  → si la clave casa, deja la cookie y
//                                   redirige a la URL limpia.
//   <ADMIN_HOST>/admin-tools      → con cookie, pasa; sin cookie, 404.
//
// El 404 es deliberado y va sin cuerpo propio: quien llegue sin cookie ve lo
// mismo que vería en una ruta que no existe. No hay formulario, ni "no
// autorizado", ni nada que confirmar.
//
// LÍMITES QUE ESTO NO CUBRE, para no confundir la puerta con una caja fuerte:
//   - El NOMBRE del host es público. Vercel emite un certificado por dominio
//     y los certificados se publican en los logs de Certificate Transparency,
//     que cualquiera puede consultar. Por eso ADMIN_HOST es configurable y
//     conviene que sea un subdominio anodino, no "admin".
//   - El chunk JS del panel se sirve desde /assets con el mismo nombre
//     hasheado en los dos hosts. Esconderlo de verdad pediría un segundo
//     build, y no compensa: sin sesión de admin el chunk no hace nada.
//   - La autorización REAL sigue siendo requireAdmin en el servidor. Esta
//     puerta reduce quién ve el panel, no quién puede usarlo.
// ---------------------------------------------------------------------

// Cookie de la puerta. Nombre anodino a propósito (no dice "admin"): es lo
// único de todo esto que viaja en cada petición y se ve en las devtools de
// cualquiera que use el móvil.
export const COOKIE_PUERTA = "cdd_t";

// Un año, y se renueva en cada visita con cookie válida (ver "seguir" en
// middleware.js). Objetivo: pasar por la URL con clave UNA vez por
// dispositivo y no volver a pensar en ello.
export const COOKIE_MAX_AGE = 31536000;

// Nombre del parámetro que trae la clave en el enlace de arranque.
export const PARAM_CLAVE = "k";

// Rutas que montan el panel en el cliente. RÉPLICA de los guards de
// src/index.jsx (isAdminTools / isLegacyEditCar / isLegacyAddCar /
// isLegacyPreview): si añades o quitas una ruta interna allí, tócala aquí
// también, o quedará una puerta abierta (ruta que monta el panel y el
// middleware no vigila) o una puerta de más (ruta vigilada que ya no existe).
const RUTAS_INTERNAS = [
  "/admin-tools",
  "/admin/edit-car",
  "/admin/add-car",
  "/preview",
];

// Los alias por query string del mismo ruteo (?admin-tools, ?preview…).
// Existen para bookmarks viejos y montan el panel igual que las rutas, así
// que la puerta tiene que reconocerlos.
const ALIAS_QUERY = /(\?|&)(admin-tools|admin-edit-car|admin-add-car|preview)(=|&|$)/;

/**
 * ¿Esta ruta monta el panel interno en el cliente?
 * @param {string} pathname
 * @param {string} search  Query string CON la "?" inicial, tal como viene de
 *                         `new URL(...)`.
 */
export function esRutaInterna(pathname, search = "") {
  if (RUTAS_INTERNAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return true;
  }
  return ALIAS_QUERY.test(search);
}

/**
 * Comparación en tiempo constante de dos cadenas cortas.
 *
 * Sobre HTTP el ruido de red hace de esto un gesto casi simbólico, pero es
 * gratis y evita la única versión indefendible: `a === b`, que sale antes en
 * el primer byte distinto. Compara TODA la longitud siempre.
 */
export function igualdadLenta(a, b) {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  // La longitud sí se filtra (no hay forma de evitarlo sin hashear); lo que no
  // se filtra es CUÁNTOS caracteres iniciales acertaste.
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/**
 * Lee una cookie de la cabecera cruda. No usamos `request.cookies` para que
 * esta función siga siendo pura y testeable sin fabricar un Request.
 *
 * @param {string} cabecera  Valor de la cabecera `Cookie`.
 * @param {string} nombre
 * @returns {string|null}
 */
export function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  for (const trozo of cabecera.split(";")) {
    const i = trozo.indexOf("=");
    if (i < 0) continue;
    if (trozo.slice(0, i).trim() !== nombre) continue;
    try {
      return decodeURIComponent(trozo.slice(i + 1).trim());
    } catch {
      // Cookie con %-escapes rotos: la tratamos como ausente.
      return null;
    }
  }
  return null;
}

/**
 * Decide qué hacer con una petición. Devuelve SIEMPRE un objeto con `tipo`:
 *
 *   { tipo: "ajeno" }                → no es asunto de la puerta; flujo normal
 *                                      del middleware (preload, /r/…).
 *   { tipo: "redirigir", a }         → 307 a `a`.
 *   { tipo: "sellar", a }            → deja la cookie de la puerta y 307 a `a`.
 *   { tipo: "seguir" }               → next(), y renovamos la cookie.
 *   { tipo: "ocultar" }              → 404 seco.
 *
 * @param {object} args
 * @param {string} args.hostname     Host de la petición, sin puerto.
 * @param {string} args.pathname
 * @param {string} args.search       Query CON "?".
 * @param {string} args.cookieHeader Cabecera `Cookie` cruda (puede ser "").
 * @param {string} args.hostInterno  ADMIN_HOST (vacío = puerta desactivada).
 * @param {string} args.clave        ADMIN_GATE_KEY (vacío = desactivada).
 */
export function decidirPuerta({
  hostname,
  pathname,
  search = "",
  cookieHeader = "",
  hostInterno,
  clave,
}) {
  // SIN CONFIGURAR, NO HAY PUERTA. Hacen falta las DOS variables: con host
  // pero sin clave, el panel quedaría en un 404 permanente y sin forma de
  // abrirlo — o sea, yo mismo encerrado fuera por un env a medio poner.
  // Este early-return es también el interruptor de emergencia: se borra
  // ADMIN_HOST en Vercel, se redeploya, y todo vuelve a ser como antes.
  if (!hostInterno || !clave) return { tipo: "ajeno" };

  // Comparación de host insensible a mayúsculas (el Host de una petición
  // puede llegar en cualquier caja) y tolerante al puerto.
  const host = String(hostname || "").toLowerCase().split(":")[0];
  if (host !== String(hostInterno).toLowerCase()) {
    // Host público: la puerta NO se mete. Ni 404 ni redirección. Que
    // /admin-tools se comporte en el apex igual que cualquier otra ruta
    // inexistente es justo lo que hace que no se note que existe; de que no
    // MONTE el panel se encarga el guard de hostname de src/index.jsx.
    return { tipo: "ajeno" };
  }

  // A partir de aquí estamos en el host interno.

  // La raíz del host interno no tiene nada que enseñar: lleva al panel. Es
  // además el start_url del icono instalado en el móvil, que se guarda con el
  // manifest del host (scope "/") y por eso arranca aquí.
  if (pathname === "/") {
    return { tipo: "redirigir", a: "/admin-tools" };
  }

  if (!esRutaInterna(pathname, search)) {
    // Cualquier otra cosa en este host (assets del bundle, /api/*) sigue su
    // curso. El matcher del middleware ni las mira; esto es solo la red por
    // si alguien amplía el matcher sin leer esto.
    return { tipo: "ajeno" };
  }

  // ¿Viene el enlace de arranque con la clave? Si casa, dejamos la cookie y
  // redirigimos a la URL LIMPIA: así la clave no se queda en la barra de
  // direcciones ni acaba en el Referer de las peticiones siguientes.
  const params = new URLSearchParams(search || "");
  const claveEntrante = params.get(PARAM_CLAVE);
  if (claveEntrante != null) {
    if (igualdadLenta(claveEntrante, clave)) {
      params.delete(PARAM_CLAVE);
      const resto = params.toString();
      return { tipo: "sellar", a: pathname + (resto ? `?${resto}` : "") };
    }
    // Clave presente y equivocada: mismo 404 que sin clave. Sin mensaje, sin
    // reintento, sin confirmar que el parámetro significa algo.
    return { tipo: "ocultar" };
  }

  const cookie = leerCookie(cookieHeader, COOKIE_PUERTA);
  if (cookie && igualdadLenta(cookie, clave)) return { tipo: "seguir" };

  return { tipo: "ocultar" };
}

/**
 * Valor de la cabecera Set-Cookie de la puerta.
 *
 * La cookie guarda la clave TAL CUAL, y es una decisión, no un descuido:
 *   - HttpOnly + Secure + SameSite=Lax + sin Domain → host-only, no la lee
 *     JavaScript y no viaja al apex.
 *   - Guardar un hash en su lugar no protegería de nada realista: el enlace
 *     de arranque con la clave en claro ya vive en el gestor de contraseñas y
 *     en el historial del navegador, así que quien tiene el dispositivo tiene
 *     la clave por otras cuatro vías.
 *   - Y da la propiedad que sí importa: cambiar ADMIN_GATE_KEY en Vercel
 *     invalida de golpe TODAS las cookies emitidas. Rotar es una variable de
 *     entorno y un redeploy.
 */
export function cabeceraCookie(clave, maxAge = COOKIE_MAX_AGE) {
  return [
    `${COOKIE_PUERTA}=${encodeURIComponent(clave)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}
