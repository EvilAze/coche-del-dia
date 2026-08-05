// src/lib/deleteAccount.js
// Lado cliente del borrado de cuenta (el servidor es api/delete-account.js).
//
// Son tres cosas encadenadas, y las tres importan:
//   1. Pedir el borrado al servidor con el JWT de la sesión.
//   2. Cerrar sesión (también la del plugin nativo de Google, vía signOut()).
//   3. BORRAR EL RASTRO LOCAL. Este paso es el que se olvida y el que más
//      chirría: el estado de la partida vive en localStorage para que el primer
//      render no espere al servidor, así que sin limpiarlo el jugador que acaba
//      de borrar su cuenta se queda mirando su racha y sus intentos de hoy como
//      si no hubiera pasado nada.
//
// Y luego se recarga. No es pereza: media app tiene estado en hooks montados
// (racha, ranking, logros, sesión) y hay un access token que sigue siendo
// válido hasta que caduque —es un JWT, nadie lo consulta en cada petición—.
// Arrancar de cero es la única forma honesta de dejar la pantalla en el estado
// que le corresponde a alguien sin cuenta.

import { supabase } from "../supabaseClient";
import { signOut } from "./auth";

/**
 * Claves de localStorage que se van con la cuenta. Explícitas y no un barrido
 * de `localStorage.clear()` a propósito: ahí conviven cosas que NO son datos de
 * la cuenta y que borrar sería una grosería (el tema día/noche que el jugador
 * eligió) o directamente ajenas (lo que guarde el propio Supabase, que ya
 * limpia signOut()).
 *
 * Exportada para el test: la lista es justo lo que hay que revisar cuando
 * alguien añada una clave nueva.
 */
export const CLAVES_LOCALES = [
  "cocheDia_state",   // partida y racha del dispositivo (el estado del juego)
  "cd_anon_token",    // sesión anónima firmada: se empieza de cero, no heredada
  "cdd_archive_seen", // qué coches del Archivo ya vio
  "ccd_howto_seen",   // si ya leyó las reglas
  "cd_notif_asked",   // decisión sobre el recordatorio nativo
  "cd_webpush_asked", // decisión sobre el recordatorio web
];

/**
 * Borra del almacenamiento local todo lo que pertenece a la cuenta.
 * Tolerante a fallos: en modo privado o con el almacenamiento lleno,
 * `removeItem` puede lanzar, y eso no debe abortar el resto del borrado.
 *
 * @param {Storage} [storage] Inyectable para el test.
 */
export function limpiarEstadoLocal(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return;
  for (const clave of CLAVES_LOCALES) {
    try {
      store.removeItem(clave);
    } catch {
      /* almacenamiento no disponible: seguimos con las demás claves */
    }
  }
}

/**
 * Pide al servidor el borrado de la cuenta del usuario en sesión.
 *
 * @returns {Promise<{ok: true} | {ok: false, motivo: string}>} `motivo` es el
 *   código del servidor ("rate_limited", "db_error"…) o "sin_sesion"/"red".
 *   Lo traduce quien lo pinta; aquí no entra i18n.
 */
export async function solicitarBorrado() {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch {
    token = null;
  }
  if (!token) return { ok: false, motivo: "sin_sesion" };

  try {
    // Ruta relativa: en la app la absolutiza el shim de lib/apiUrl.js.
    const res = await fetch("/api/delete-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, motivo: body?.error || `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, motivo: "red" };
  }
}

/**
 * El flujo completo: borrar en servidor, cerrar sesión, limpiar local y
 * recargar. Solo devuelve valor cuando FALLA — si sale bien, la página se está
 * recargando y nadie llega a leer el retorno.
 *
 * El cierre de sesión y la limpieza local van con `catch` propio: una vez el
 * servidor ha dicho que sí, la cuenta ya no existe, y dejar al jugador con la
 * pantalla anterior porque el signOut tosió sería peor que recargar igual.
 *
 * @param {{recargar?: () => void}} [deps] Inyectable para el test.
 */
export async function eliminarCuenta(deps = {}) {
  const recargar =
    deps.recargar || (() => window.location.replace(window.location.pathname));

  const res = await solicitarBorrado();
  if (!res.ok) return res;

  try {
    await signOut();
  } catch {
    /* la cuenta ya está borrada en servidor; la recarga termina el trabajo */
  }
  limpiarEstadoLocal();
  recargar();
  return { ok: true };
}
