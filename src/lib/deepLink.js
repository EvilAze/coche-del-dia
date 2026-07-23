// src/lib/deepLink.js
// Traduce un App Link entrante (https://cochedeldia.com/loquesea) a la ruta
// local que tiene que abrir el WebView de la app.
//
// Por qué hace falta traducir nada: la app NO carga la web. Empaqueta el bundle
// y lo sirve desde `https://localhost`, así que el enrutado manual de
// src/index.jsx lee un `window.location` cuyo host no es el del enlace. Si al
// recibir el enlace no hiciéramos nada, la app abriría —eso ya es una mejora
// sobre ir al navegador— pero siempre en la portada: pulsar "mira mi resultado
// de la repesca" te dejaría en el coche del día de hoy.
//
// La función es PURA a propósito (entra string, sale string o null): la parte
// que toca `window.location` vive en index.jsx, y así esto se testea en node.
//
// SEGURIDAD — por qué se valida el host aunque el intent-filter ya filtre:
//   El `<intent-filter>` del manifest solo gobierna los enlaces que Android
//   ENRUTA hacia nosotros. Cualquier app instalada puede lanzar un intent
//   EXPLÍCITO a nuestra Activity con el contenido que quiera, y ese intent
//   llega igual a appUrlOpen. Sin esta validación, una app cualquiera podría
//   empujar al WebView a una URL de su elección. Por eso se comprueba el
//   esquema y el host, y por eso se devuelve SOLO la parte de ruta
//   (pathname + search + hash): al no devolver nunca un origen, el resultado no
//   puede sacar al WebView de su propio dominio ni siendo malicioso.

export const APP_LINK_HOST = "cochedeldia.com";

/**
 * @param {string} url  URL entrante tal cual la da Capacitor.
 * @param {string} host Host aceptado (parametrizable para los tests).
 * @returns {string|null} Ruta relativa ("/repesca?id=7") o null si no aplica.
 */
export function rutaDesdeEnlace(url, host = APP_LINK_HOST) {
  if (typeof url !== "string" || !url) return null;

  let u;
  try {
    u = new URL(url);
  } catch {
    // Basura o esquema propio (com.cochedeldia://…) que no sabemos enrutar.
    return null;
  }

  // Solo https y solo nuestro dominio. Ver el bloque SEGURIDAD de arriba.
  if (u.protocol !== "https:") return null;
  if (u.hostname !== host) return null;

  // Nunca devolvemos origen: solo la parte que cuelga del host.
  const ruta = `${u.pathname}${u.search}${u.hash}`;

  // Colapsar las barras iniciales NO es cosmética, es la parte que impide el
  // escape de origen. `https://cochedeldia.com//evil.example/x` pasa el filtro
  // de host tan campante (el host ES el nuestro) pero su pathname es
  // "//evil.example/x", y eso, pasado a location.replace(), es una URL
  // PROTOCOL-RELATIVE: el navegador la resuelve como https://evil.example/x y
  // el WebView se va a un dominio ajeno. Como Android enruta ese enlace hacia
  // nosotros por el intent-filter, sería explotable desde cualquier chat.
  // Se contemplan también las barras invertidas porque varios navegadores las
  // tratan como separador en este contexto.
  //
  // Colapsamos en vez de rechazar: el enlace sigue llevando a la app (a una
  // ruta inofensiva de NUESTRO origen) en vez de morir en silencio.
  const normalizada = ruta.replace(/^[/\\]+/, "/");
  return normalizada.startsWith("/") ? normalizada : `/${normalizada}`;
}

/**
 * ¿Merece la pena navegar? Evita recargar el WebView cuando el enlace apunta a
 * donde ya estamos — abrir la app desde un enlace a la portada estando en la
 * portada no debe tirar la partida en curso por un reload gratuito.
 */
export function debeNavegar(rutaDestino, ubicacionActual) {
  if (!rutaDestino) return false;
  const actual = `${ubicacionActual.pathname}${ubicacionActual.search}${ubicacionActual.hash}`;
  return rutaDestino !== actual;
}
