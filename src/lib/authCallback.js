// src/lib/authCallback.js
// Leer el error que trae la vuelta de un flujo OAuth, para no tragárselo.
//
// EL FALLO QUE ARREGLA
// Un jugador terminó su partida en la app instalada, pulsó ENTRAR, eligió su
// cuenta de Google… y volvió a la web sin sesión y sin un solo mensaje. Nada
// roto a la vista, nada en pantalla, nada que reportar salvo «no funciona».
//
// El motivo: `signInWithGoogle` intenta VINCULAR (linkIdentity) cuando hay
// sesión anónima en curso, para conservar la racha. Pero linkIdentity REDIRIGE
// igual que signInWithOAuth, así que si el servidor lo rechaza —el caso normal
// es que esa cuenta de Google YA pertenezca a otro usuario, cosa que pasa
// siempre que alguien con cuenta juega antes de identificarse— el error no
// vuelve en el valor de la llamada, sino en la URL de retorno. El `if
// (!res?.error)` que había allí no puede verlo nunca: para cuando el servidor
// decide, el navegador ya se fue a Google.
//
// Y aquí nadie miraba esa URL. supabase-js consume el fragmento en silencio, no
// encuentra tokens, y la app se queda como estaba. Silencio absoluto.
//
// De los dos arreglos, ESTE es el importante: el otro cubre un caso concreto,
// este hace que cualquier fallo futuro de OAuth se vea en pantalla en vez de
// desaparecer. Un login que falla y lo dice se puede diagnosticar; uno que falla
// callando, no.

// Supabase devuelve el error en el QUERY con el flujo PKCE (el de por defecto
// en navegador) y en el FRAGMENTO con el implícito. Miramos los dos: cuesta
// nada y nos ahorra depender de en qué flujo esté configurado el proyecto.
function leerDe(texto) {
  if (!texto) return null;
  const p = new URLSearchParams(texto.startsWith("#") ? texto.slice(1) : texto);
  const code = p.get("error") || p.get("error_code");
  if (!code) return null;
  return {
    code,
    // `error_description` viene URL-encoded y con '+' por espacios; URLSearchParams
    // ya lo deshace. Puede faltar: entonces nos quedamos con el código.
    description: p.get("error_description") || code,
  };
}

/**
 * ¿Trae la URL actual un error de autenticación?
 * @param {Location|{search:string, hash:string}} [loc]
 * @returns {{code: string, description: string} | null}
 */
export function leerErrorAuth(loc = typeof window === "undefined" ? null : window.location) {
  if (!loc) return null;
  return leerDe(loc.search) || leerDe(loc.hash);
}

/**
 * ¿Es un error de «esa identidad ya es de otra cuenta»?
 *
 * Deliberadamente LAXO: se compara sobre el texto y no contra un código exacto
 * porque Supabase no documenta cuál emite en este caso, y atarnos a una cadena
 * concreta sería repetir el error de dar por buena una suposición sin
 * comprobarla. Si no acertamos, el usuario cae igualmente en el aviso genérico,
 * que también le ofrece entrar — o sea que fallar aquí no le deja tirado.
 */
export function esIdentidadYaVinculada(error) {
  // Guiones bajos a espacios antes de comparar: el mismo motivo llega unas
  // veces como código (`identity_already_exists`) y otras como frase («Manual
  // linking is disabled»). Normalizar evita tener que enumerar las dos formas
  // de cada uno.
  const t = `${error?.code ?? ""} ${error?.description ?? ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return t.includes("already") || t.includes("manual linking");
}

/**
 * Borra los parámetros de error de la barra de direcciones, conservando el
 * resto de la ruta.
 *
 * Imprescindible: sin esto, recargar la página vuelve a disparar el aviso, y el
 * enlace queda con un error pegado para siempre si alguien lo comparte.
 */
export function limpiarErrorAuth() {
  if (typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    for (const k of ["error", "error_code", "error_description", "state"]) {
      u.searchParams.delete(k);
    }
    const limpio = u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "");
    window.history.replaceState({}, document.title, limpio);
  } catch {
    // Si history no está disponible no pasa nada: el aviso ya se mostró y el
    // peor caso es que reaparezca al recargar.
  }
}
