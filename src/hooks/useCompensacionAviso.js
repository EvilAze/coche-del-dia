// El aviso de la compensación del 15-oct (TVR/Tvr): a quién y cuántas veces.
//
// Las tres garantías, y dónde vive cada una:
//   · SOLO CON SESIÓN. Sin `userId` no se pregunta nada. Y aunque se preguntara,
//     la RPC está revocada para `anon` (scripts/2026-10-15-compensacion-tvr-aviso.sql).
//   · SOLO A LOS AFECTADOS. La RPC devuelve únicamente la fila de auth.uid() en
//     compensacion_tvr_20261015, y en esa tabla solo están las cuentas que
//     jugaron el 15 y eligieron «Tvr». Al resto le contesta null.
//   · UNA VEZ POR CUENTA. La RPC marca el aviso como entregado en la MISMA
//     sentencia que lo lee (UPDATE … RETURNING), así que una segunda petición
//     —otra pestaña, el móvil a la vez, una recarga— ya no lo encuentra. Por eso
//     aquí no hay ninguna marca local: la verdad está en el servidor.
//
// Y una cuarta, la de siempre (regla 9): falla en silencio. Si la red o la RPC
// fallan, la partida carga igual y no se enseña nada.
//
// TEMPORAL: quitar junto a CompensacionAviso.jsx y sus RPC una semana después.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

export function useCompensacionAviso(userId) {
  const [datos, setDatos] = useState(null);
  // Una pregunta por cuenta y por carga de la app. Sin esto, cada re-render que
  // cambiara la identidad de `user` volvería a llamar — inofensivo para el
  // servidor (la segunda ya no encuentra nada) pero trabajo tirado.
  const preguntado = useRef(null);

  useEffect(() => {
    if (!userId || preguntado.current === userId) return;
    preguntado.current = userId;
    // Sin bandera de cancelación A PROPÓSITO: la RPC ya ha GASTADO el aviso al
    // contestar, así que descartar la respuesta sería perderlo para siempre.
    Promise.resolve(supabase.rpc("mi_compensacion_tvr"))
      .then(({ data, error } = {}) => {
        if (!error && data && typeof data === "object") setDatos(data);
      })
      .catch(() => {});
  }, [userId]);

  // Si cierra sesión con el aviso delante, se retira: es suyo, no del siguiente.
  useEffect(() => {
    if (!userId) setDatos(null);
  }, [userId]);

  const cerrar = useCallback(() => {
    setDatos(null);
    // Compatibilidad con el SQL anterior (marcaba al cerrar). Con el nuevo no
    // hace nada, y sobra cuando ya está aplicado; se deja para que la entrega
    // sea segura en cualquier orden (app antes o después del SQL).
    Promise.resolve(supabase.rpc("compensacion_tvr_vista")).catch(() => {});
  }, []);

  return { datos, cerrar };
}
