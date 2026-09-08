// src/hooks/useArrastreHoja.js
// La hoja de selección se agarra y se arrastra HACIA ABAJO para cerrarla. Y la
// fotografía la sigue en tiempo real, porque las dos son la misma composición:
// mover una y no la otra enseña el truco.
//
// EL GESTO VA EN UN SOLO SENTIDO, Y ESO ES UNA CORRECCIÓN. Aquí hubo un
// recorrido de dos tramos: hacia abajo para cerrarla y hacia arriba para
// estirarla y ver más lista, con la foto encogiéndose hasta convertirse en el
// recorte flotante. Sobre el papel encajaba —una sola magnitud, la hoja y la
// foto repartiéndose la pantalla— y en el pulgar era otra cosa:
//
//   · Estando la lista arriba del todo, el gesto natural para BAJAR por ella es
//     empujar hacia arriba. Ese es exactamente el gesto que estiraba la hoja,
//     así que el primer intento de leer la lista nunca scrolleaba: agrandaba la
//     hoja y encogía la fotografía. Hay que soltar y volver a intentarlo, y eso
//     ya no es una interfaz, es un truco que se aprende.
//   · Y encoger la foto es caro por lo que dice la regla 18: el cupón existe
//     para no jugar a ciegas. Un gesto que la achica como efecto secundario de
//     intentar leer una lista trabaja contra el motivo por el que la hoja se
//     recortó.
//
// Con un solo sentido la regla se explica en una frase —«se tira hacia abajo
// para cerrarla»— y el gesto hacia arriba vuelve a ser lo que el pulgar espera:
// scroll nativo, con su inercia, desde el primer píxel.
//
// EL RECORRIDO, entonces:
//   · EN REPOSO. Donde se abre: la foto entera y la lista debajo.
//   · FUERA. Pasado el 28% de su alto (o con un manotazo), se va.
// Al soltar cae a uno de los dos: ni se queda a medias ni hay que acertar.
//
// DE DÓNDE SE PUEDE TIRAR. De la cabecera y del tirador, siempre. De la lista,
// solo si está ARRIBA DEL TODO — a media lista el gesto vertical es scroll y
// robárselo sería insufrible; y estando arriba, tirar hacia abajo ya no scrollea
// nada, así que ese gesto está libre.
//
// Y DE DONDE NO SE PUEDE TIRAR NUNCA: de lo que lleve `data-gesto-propio`. Hay
// piezas dentro de la hoja que ya son dueñas de su vertical —el índice A-Z, que
// se recorre con el dedo— y sus toques llegan hasta aquí igual. Ver `onStart`.
//
// TOUCH Y NO POINTER EVENTS, a propósito: hace falta `preventDefault()` sobre el
// `touchmove` para cortarle el scroll al navegador en el instante en que tomamos
// el mando, y eso obliga a un listener NO pasivo, que se declara al registrar.
// Con pointer events habría que además pelearse con `touch-action`, y la hoja
// solo existe dentro de la app: aquí no hay ratón.

import { useEffect, useRef } from "react";

// Antes de este umbral no pasa nada: evita que un toque con un pelo de
// movimiento —o el arranque de un scroll— se lea como arrastre.
const UMBRAL = 8;
// Cuánto hay que bajarla para que se vaya sola al soltar, en tanto por uno de su
// alto. Un cuarto largo: menos y se cierra sin querer al intentar mirar la lista
// de abajo; más y hay que arrastrarla media pantalla.
const FRACCION_CIERRE = 0.28;
// El atajo del gesto rápido: un manotazo corto y decidido decide el destino sin
// llegar a la mitad del recorrido. px/ms.
const VELOCIDAD = 0.55;
const MINIMO_GESTO_RAPIDO = 24;
// LA VELOCIDAD SE MIDE SOBRE UNA VENTANA, NO SOBRE EL ÚLTIMO TRAMO. Dividir el
// último salto entre su intervalo da números disparatados cuando el intervalo es
// de décimas de milisegundo —y lo es: los eventos táctiles llegan a ráfagas, y
// una pantalla de 120Hz los sirve cada 8ms—, así que un arrastre lento acababa
// leyéndose como un manotazo. Se compara la última muestra con la más antigua
// que quede a 30ms o más; si no hay ninguna, no hay gesto rápido que medir.
const VENTANA_MS = 150;
const MINIMO_VENTANA_MS = 30;
// La misma duración y la misma curva que la entrada de la hoja (index.css) y que
// el marco de la foto: las tres piezas se mueven como una.
const ASENTAR_MS = 200;
const CURVA = "cubic-bezier(.16,1,.3,1)";

/**
 * @param {object} p
 * @param {HTMLElement|null} p.hojaEl   panel de la hoja.
 * @param {boolean} p.activo            solo con la hoja abierta.
 * @param {() => void} p.onCerrar       cerrar de verdad (lo decide el caller).
 * @param {(px: number) => void} p.onDesplazar  la hoja va N px más abajo, para
 *                                      que la composición la siga.
 */
export function useArrastreHoja({ hojaEl, activo, onCerrar, onDesplazar }) {
  // LAS FUNCIONES, POR REF Y NO POR DEPENDENCIA. `onCerrar` llega como una
  // flecha nueva en cada render del cupón, así que ponerla en el array de
  // dependencias desmontaría y volvería a montar los listeners cada vez que algo
  // se re-renderiza — y si eso cae A MITAD DE UN GESTO, el arrastre pierde su
  // estado y la hoja se queda colgada donde estuviera el dedo. Con refs, el
  // efecto se monta una vez por apertura y siempre llama a la última versión.
  const cerrarRef = useRef(onCerrar);
  const desplazarRef = useRef(onDesplazar);
  cerrarRef.current = onCerrar;
  desplazarRef.current = onDesplazar;

  useEffect(() => {
    if (!activo || !hojaEl || typeof document === "undefined") return;
    const raiz = document.documentElement;

    // Estado del gesto en curso. La hoja no guarda nada entre gestos: o está en
    // reposo o se ha ido.
    let inicioY = 0;
    let muestras = [];
    let base = 0;
    let offset = 0;
    let permitido = false;
    let siguiendo = false;
    let pintado = 0;
    let objetivo = 0;
    // La devolución de estilos queda pendiente de un `transitionend`, y ese
    // evento puede no llegar nunca: si el dedo vuelve a agarrar la hoja a mitad
    // del asentamiento, la transición se CANCELA (y `transitionend` no se
    // dispara con una cancelación). El oyente huérfano acabaría saltando en la
    // siguiente transición de la hoja —la de salida, por ejemplo— y borraría el
    // `transform` justo cuando hace falta.
    let limpieza = null;

    function cancelarLimpieza() {
      if (!limpieza) return;
      hojaEl.removeEventListener("transitionend", limpieza);
      limpieza = null;
    }

    function desbordaEnVertical(el) {
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      const desborde = getComputedStyle(el).overflowY;
      return desborde === "auto" || desborde === "scroll";
    }

    // El primer ancestro DESPLAZABLE entre el dedo y la hoja. Se para en la
    // propia hoja: lo que haya por encima no es asunto de este gesto.
    function scrollerBajo(nodo) {
      let el = nodo instanceof Element ? nodo : null;
      while (el && el !== hojaEl) {
        if (desbordaEnVertical(el)) return el;
        el = el.parentElement;
      }
      return null;
    }

    // px/ms del final del gesto (positivo = hacia abajo). 0 si no hay recorrido
    // suficiente en el tiempo como para llamarlo velocidad.
    function velocidadFinal() {
      const fin = muestras[muestras.length - 1];
      if (!fin) return 0;
      const desde = muestras.find((m) => fin.t - m.t >= MINIMO_VENTANA_MS);
      if (!desde) return 0;
      return (fin.y - desde.y) / (fin.t - desde.t);
    }

    // EL ÚNICO SITIO QUE TOCA EL DOM. `offset` es cuántos píxeles se ha empujado
    // la hoja hacia fuera desde su reposo, y siempre es >= 0: el gesto va en un
    // solo sentido. Se pinta con `transform` y no tocando el alto porque no hay
    // nada nuevo que enseñar — la hoja se aparta, no se recompone.
    function escribir(px) {
      hojaEl.style.transform = `translateY(${px}px)`;
      desplazarRef.current?.(px);
    }

    // Un pintado por frame como mucho. Los eventos táctiles llegan más deprisa
    // que los frames en muchos móviles, y cada pintado de este cuesta una
    // recomposición de la lista: escribir tres veces para el mismo frame es
    // trabajo tirado, y del caro.
    function programar(px) {
      objetivo = px;
      if (pintado) return;
      pintado = requestAnimationFrame(() => {
        pintado = 0;
        escribir(objetivo);
      });
    }

    function onStart(e) {
      if (e.touches.length !== 1) return;
      // HAY GESTOS QUE NO SON NUESTROS AUNQUE PASEN POR AQUÍ. El índice A-Z de
      // la lista se recorre con el dedo (`.pm-indice`, ver SelectorLista) y usa
      // pointer events; `touch-action: none` le quita el scroll al navegador,
      // pero los eventos TÁCTILES burbujean hasta la hoja igual. Y ahí
      // `scrollerBajo` los daba por buenos, porque entre la tira y la hoja no
      // hay ningún ancestro desplazable —la tira no scrollea, `.pm-lista-caja` y
      // `.pm-hoja-cuerpo` son `overflow: hidden`, y `.pm-lista` es HERMANA, no
      // ancestro—. Resultado: bajar por el índice saltaba de letra Y arrastraba
      // la hoja, y pasado el 28% se la llevaba por delante.
      //
      // Va lo PRIMERO, antes incluso de cancelar la limpieza pendiente: si el
      // gesto no es nuestro, no hay nada que preparar. Y es la misma idea que ya
      // sigue `scrollerBajo` —«esto de aquí no es asunto de este gesto»— solo
      // que declarada por quien lo sabe en vez de deducida de la maqueta.
      if (e.target instanceof Element && e.target.closest("[data-gesto-propio]")) {
        permitido = false;
        return;
      }
      cancelarLimpieza();
      const t = e.touches[0];
      inicioY = t.clientY;
      muestras = [{ y: t.clientY, t: e.timeStamp }];
      siguiendo = false;
      // EL 28% SE MIDE SOBRE LO QUE SE VE, NO SOBRE LA CAJA. Con el teclado a la
      // vista la hoja crece por debajo —se rellena el hueco que el teclado tapa,
      // ver `.pm-hoja` en index.css— y `offsetHeight` cuenta ese relleno. Sin
      // descontarlo, el umbral se calculaba sobre 636px de caja para 300px de
      // hoja visible: había que arrastrarla hasta dejar a la vista menos de la
      // mitad para que se cerrara. Una lectura, y en el primer frame del gesto.
      base =
        hojaEl.offsetHeight -
        (parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--cdd-teclado")
        ) || 0);
      offset = 0;
      const scroller = scrollerBajo(e.target);
      permitido = !scroller || scroller.scrollTop <= 0;
    }

    function onMove(e) {
      if (!permitido || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - inicioY;

      if (!siguiendo) {
        if (Math.abs(dy) < UMBRAL) return;
        // HACIA ARRIBA NO ES NUESTRO, NUNCA. Es el gesto con el que se baja por
        // la lista, y estando arriba del todo era el que estiraba la hoja: el
        // primer intento de leer no scrolleaba, agrandaba la hoja y encogía la
        // fotografía. Se devuelve al navegador soltándolo aquí — todavía no se
        // ha llamado a `preventDefault`, así que se lo queda entero, con su
        // inercia y su rebote.
        if (dy < 0) {
          permitido = false;
          return;
        }
        siguiendo = true;
        // Mientras dura el gesto nada se anima: la hoja y la foto van pegadas al
        // dedo, no persiguiéndolo con 200ms de retraso.
        raiz.dataset.arrastrando = "";
        hojaEl.style.transition = "none";
      }
      // El scroll del navegador, cortado justo aquí y no antes: hasta el umbral
      // el gesto todavía podía ser suyo.
      if (e.cancelable) e.preventDefault();
      muestras.push({ y, t: e.timeStamp });
      while (muestras.length > 2 && e.timeStamp - muestras[0].t > VENTANA_MS) {
        muestras.shift();
      }
      // El umbral se descuenta para que la hoja no dé un salto de 8px al
      // engancharse. Y el suelo es 0: por encima de su reposo no sube.
      offset = Math.max(dy - UMBRAL, 0);
      programar(offset);
    }

    // Volver al reposo: el gesto no llegó a cerrarla, así que la hoja regresa a
    // su sitio y la fotografía con ella.
    function volverAlSitio() {
      cancelAnimationFrame(pintado);
      pintado = 0;
      hojaEl.style.transition = `transform ${ASENTAR_MS}ms ${CURVA}`;
      escribir(0);
      limpieza = (ev) => {
        if (ev.target !== hojaEl) return;
        cancelarLimpieza();
        // Se sueltan los dos estilos en línea y vuelve a mandar el CSS.
        hojaEl.style.transition = "";
        hojaEl.style.transform = "";
      };
      hojaEl.addEventListener("transitionend", limpieza);
    }

    function onEnd() {
      if (!siguiendo) {
        permitido = false;
        return;
      }
      siguiendo = false;
      permitido = false;
      cancelAnimationFrame(pintado);
      pintado = 0;
      delete raiz.dataset.arrastrando;

      const velocidad = velocidadFinal();
      if (
        offset > base * FRACCION_CIERRE ||
        (velocidad > VELOCIDAD && offset > MINIMO_GESTO_RAPIDO)
      ) {
        // Se termina el viaje que el dedo dejó a medias. `onCerrar` desmonta la
        // hoja por la vía de siempre (ModalShell y su animación de salida), y la
        // limpieza del hook de la foto la devuelve a su sitio a la vez: el mismo
        // gesto, las dos piezas.
        hojaEl.style.transition = `transform ${ASENTAR_MS}ms ${CURVA}`;
        hojaEl.style.transform = "translateY(100%)";
        cerrarRef.current?.();
        return;
      }

      // No ha dado para cerrarla: vuelve. Ya no hay «el escalón de al lado» que
      // elegir — con un solo sentido, o se va o se queda donde estaba.
      volverAlSitio();
    }

    // `touchcancel` lo dispara el sistema cuando se lleva el gesto (una llamada,
    // el gesto de atrás del borde). Se trata como un final: la hoja se asienta.
    hojaEl.addEventListener("touchstart", onStart, { passive: true });
    hojaEl.addEventListener("touchmove", onMove, { passive: false });
    hojaEl.addEventListener("touchend", onEnd);
    hojaEl.addEventListener("touchcancel", onEnd);

    // (Aquí había un oyente de `resize` que soltaba el alto en línea al subir el
    // teclado o girar el móvil. Existía porque el gesto hacia arriba escribía un
    // `height` calculado contra la ventana de ese momento; sin ese gesto, este
    // hook ya no toca el alto de nada y no hay nada que soltar.)

    return () => {
      cancelAnimationFrame(pintado);
      cancelarLimpieza();
      hojaEl.removeEventListener("touchstart", onStart);
      hojaEl.removeEventListener("touchmove", onMove);
      hojaEl.removeEventListener("touchend", onEnd);
      hojaEl.removeEventListener("touchcancel", onEnd);
      delete raiz.dataset.arrastrando;
    };
    // Sin `clave` en las dependencias: existía para REINICIAR lo estirada que
    // estuviera la hoja al cambiar de paso del cupón, y ya no hay nada que
    // reiniciar — entre gestos la hoja está en reposo o se ha ido.
  }, [hojaEl, activo]);
}
