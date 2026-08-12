// src/lib/sesionDiaria.js
// Marca UNA visita por dispositivo y día en el contador `feature_events`
// (evento `sesion`), con la plataforma de origen. Es lo que alimenta la
// gráfica de "accesos app vs web" del panel de Analítica.
//
// POR QUÉ NO LO DA UMAMI. Lo da, y mejor — pero su API es de pago y el panel
// admin lee solo de Supabase, así que la plataforma no llegaba a Postgres por
// ningún lado. Mismo razonamiento y misma tubería que `ranking_open`: una RPC
// SECURITY DEFINER que escribe el contador sin dar permiso de escritura al
// cliente. Ver scripts/2026-08-feature-events-plataforma.sql.
//
// POR QUÉ UNA VEZ AL DÍA Y NO EN CADA ARRANQUE. Un contador de arranques mide
// sobre todo el gesto de volver a la pestaña, que en la app y en la web no se
// parecen en nada (el WebView se reanuda; una pestaña se recarga). Comparar
// esos dos números daría una diferencia que es artefacto de la plataforma, no
// de la gente. Con un tope de una marca por dispositivo y día, la serie se lee
// como "dispositivos activos por día", que sí es comparable entre las dos.
//
// LO QUE NO ES: usuarios únicos. Dos navegadores de la misma persona son dos, y
// borrar los datos del sitio vuelve a contar. Es el mismo trato que hace
// cualquier métrica de DAU basada en dispositivo, y para la pregunta que
// responde —¿cuánto uso viene de la app?— la proporción es lo que importa.

import { supabase } from "../supabaseClient";
import { getMadridDateStr } from "./dates";
import { plataforma } from "./analytics";

// Fecha (Madrid) de la última marca enviada por este dispositivo.
const CLAVE = "ccd_sesion_dia";

/**
 * Registra la sesión del día si no estaba ya registrada.
 *
 * Fire-and-forget y a prueba de todo: si localStorage está bloqueado (modo
 * privado) o la RPC falla, no pasa nada — se pierde una marca de una métrica
 * interna. Jamás debe estorbar al arranque del juego.
 *
 * @param {object} args
 * @param {boolean} args.logueado  Cuenta real, misma convención `auth` que
 *                                 ranking_open/garage_open ("user" | "anon").
 * @param {object} [args.deps]     Inyección para los tests.
 * @returns {boolean} true si se ha enviado la marca (útil en tests).
 */
export function registrarSesionDiaria({ logueado, deps = {} } = {}) {
  const {
    hoy = getMadridDateStr(),
    almacen = typeof localStorage === "undefined" ? null : localStorage,
    cliente = supabase,
    plat = plataforma(),
  } = deps;

  try {
    // Sin almacén no hay tope posible. Preferimos NO contar a contar cada
    // arranque: una serie con un pico raro es peor que una serie con menos.
    if (!almacen) return false;
    if (almacen.getItem(CLAVE) === hoy) return false;

    // El sello se escribe ANTES de la llamada, a propósito: si la RPC falla
    // perdemos una marca, pero si escribiéramos después, un fallo de red en
    // cada arranque dejaría reintentando toda la sesión.
    almacen.setItem(CLAVE, hoy);

    cliente
      .rpc("increment_feature_event", {
        p_event: "sesion",
        p_auth: logueado ? "user" : "anon",
        p_plataforma: plat,
      })
      .then(undefined, () => {});
    return true;
  } catch {
    // localStorage inaccesible o cliente a medio construir: en silencio.
    return false;
  }
}
