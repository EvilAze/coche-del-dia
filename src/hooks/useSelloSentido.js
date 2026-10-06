// src/hooks/useSelloSentido.js
// El cierre de la partida se SIENTE cuando el sello toca el papel.
//
// El sello del revelado («Resuelto» / «Sin resolver») es el punto final de la
// frase del veredicto: cae con rebote un instante después de abrirse el panel.
// Hasta ahora el háptico del final (`success` / `warning`) sonaba al llegar la
// respuesta del servidor, más de un segundo antes de que el sello existiera, así
// que lo que se sentía y lo que se veía eran dos momentos distintos. Este hook
// ata el háptico a la propia animación del sello.
//
// POR QUÉ `animationstart` Y NO UN TEMPORIZADOR DESDE EL MONTAJE
//   El sello lleva su retardo en el CSS (`--ms-sello`), y el panel puede tardar
//   un frame más o menos en montarse. El evento llega cuando la animación EMPIEZA
//   de verdad, con el retardo ya descontado; desde ahí solo falta el trozo hasta
//   el contacto (lib/veredicto.js, MS_HASTA_IMPACTO_SELLO). Y tiene una
//   consecuencia buena gratis: con movimiento reducido la regla global apaga las
//   animaciones, el evento no llega y no vibra nada — que es justo lo que
//   haptics.js ya hace en ese caso.
//
// `activo` = el panel se ha abierto SOLO, al terminar la partida en esta sesión.
// Reabrirlo con «Ver resultado» vuelve a estampar el sello, pero no vuelve a
// celebrar: el acierto se siente una vez, cuando ocurre.

import { useCallback, useEffect, useRef } from "react";
import { haptic } from "../lib/haptics";
import { MS_HASTA_IMPACTO_SELLO } from "../lib/veredicto";

export function useSelloSentido({ won, activo }) {
  const reloj = useRef(null);
  useEffect(() => () => clearTimeout(reloj.current), []);

  // Devuelve el manejador para el `onAnimationStart` del sello.
  return useCallback(
    (ev) => {
      // Solo la animación del propio sello: un `animationstart` de un hijo
      // burbujearía hasta aquí igual.
      if (!activo || ev.target !== ev.currentTarget) return;
      clearTimeout(reloj.current);
      reloj.current = setTimeout(() => {
        if (won) haptic.success();
        else haptic.derrota();
      }, MS_HASTA_IMPACTO_SELLO);
    },
    [activo, won]
  );
}
