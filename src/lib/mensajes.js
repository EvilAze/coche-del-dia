// src/lib/mensajes.js
// Escribirle al equipo desde dentro del juego.
//
// Va por RPC y no por /api/… por lo mismo que feature_events: el plan Hobby de
// Vercel tiene 12 funciones y ya andamos justos. La RPC es SECURITY DEFINER, así
// que escribe en una tabla que el cliente no puede ni leer
// (scripts/2026-08-buzon-de-mensajes.sql).
//
// LO QUE VALIDA ESTE FICHERO NO ES LA DEFENSA. Las reglas de verdad —tipo de una
// allowlist, longitudes, cuota de 5 por día— viven en la RPC, porque cualquiera
// con la anon key puede llamarla saltándose este formulario. Aquí se comprueba
// lo mismo solo para dar el error al instante, sin viaje de red. Es el mismo
// reparto que en el nick (src/lib/nickname.js).

import { supabase } from "../supabaseClient";
import { plataforma } from "./analytics";

export const TIPOS = ["problema", "reporte", "sugerencia"];

export const CUERPO_MIN = 10;
export const CUERPO_MAX = 4000;

// El mismo patrón que aplica la RPC. Deliberadamente laxo: validar direcciones
// de correo a fondo con un regex es una trampa clásica —hay direcciones válidas
// rarísimas— y aquí el campo es OPCIONAL y solo sirve para poder contestar. Que
// no se cuele un "asdf" basta.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cuerpoValido(cuerpo) {
  const limpio = String(cuerpo ?? "").trim();
  return limpio.length >= CUERPO_MIN && limpio.length <= CUERPO_MAX;
}

export function emailValido(email) {
  const limpio = String(email ?? "").trim();
  if (!limpio) return true; // opcional
  return limpio.length <= 254 && EMAIL_RE.test(limpio);
}

/**
 * Manda el mensaje. Lanza un Error con `code` cuando el servidor rechaza, para
 * que la interfaz pueda decir POR QUÉ en vez de "algo ha fallado":
 *   SIN_SESION   → no hay sesión (ni siquiera anónima)
 *   NO_VALIDO    → tipo, cuerpo o email fuera de rango
 *   CUOTA        → 5 mensajes en 24 h
 */
export async function enviarMensaje({ tipo, cuerpo, email }) {
  const { error } = await supabase.rpc("enviar_mensaje", {
    p_tipo: tipo,
    p_cuerpo: String(cuerpo ?? "").trim(),
    p_email: String(email ?? "").trim() || null,
    p_plataforma: plataforma(),
  });

  if (!error) return true;

  // Los errcode los elige la RPC a propósito para poder distinguirlos aquí.
  const mapa = {
    42501: "SIN_SESION",
    22023: "NO_VALIDO",
    54000: "CUOTA",
  };
  const err = new Error(error.message || "No se pudo enviar");
  err.code = mapa[error.code] || "ERROR";
  throw err;
}
