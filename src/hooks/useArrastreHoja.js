// src/hooks/useArrastreHoja.js
// Cerrar la hoja de selección deslizándola hacia abajo.
//
// POR QUÉ. El tirador de la hoja lleva desde el primer día diciendo «esto se
// cierra hacia abajo» y no era verdad: era un adorno de tres píxeles. En una app
// eso se nota — el pulgar ya está sobre la hoja, y el gesto que pide una
// superficie anclada al borde inferior es empujarla fuera, no subir hasta la X.
//
// EL GESTO ES CONTINUO, NO UN DISPARADOR. La hoja sigue al dedo píxel a píxel y
// la FOTOGRAFÍA baja con ella (`onDesplazar`), porque las dos son la misma
// composición: la foto está donde está porque la hoja ocupa lo que ocupa. Si al
// arrastrar solo se moviera la hoja, la foto se quedaría suspendida en un sitio
// que ya no le corresponde y el truco se vería. Al soltar, o se va (y la foto
// vuelve entera) o rebota a su sitio; en los dos casos las dos piezas viajan
// juntas.
//
// DE DÓNDE SE PUEDE TIRAR. De cualquier sitio de la hoja MENOS de una lista que
// esté a media altura: ahí el gesto hacia abajo es scroll y robárselo sería
// insufrible. Con la lista arriba del todo, en cambio, tirar hacia abajo ya no
// scrollea nada (`overscroll-behavior: contain`), así que ese gesto está libre y
// es justo el que la gente usa para «salir de aquí». La búsqueda del scroller es
// por altura real y `overflow-y` computado, no por clase: la hoja tiene tres
// contenidos distintos (marcas, modelos, años) y cada uno desplaza lo suyo.
//
// TOUCH Y NO POINTER EVENTS, a propósito: hace falta `preventDefault()` sobre el
// `touchmove` para cortarle el scroll al navegador en el instante en que
// tomamos el mando, y eso obliga a un listener NO pasivo, que es algo que se
// declara al registrar. Con pointer events habría que además pelearse con
// `touch-action`, y la hoja solo existe dentro de la app: aquí no hay ratón.

import { useEffect, useRef } from "react";

// Antes de este umbral no pasa nada: evita que un toque con un pelo de
// movimiento —o el arranque de un scroll— se lea como arrastre.
const UMBRAL = 8;
// Cuánto hay que bajarla para que se vaya sola al soltar, en tanto por uno de su
// alto. Un cuarto largo: menos y se cierra sin querer al intentar mirar la lista
// de abajo; más y hay que arrastrarla media pantalla.
const FRACCION_CIERRE = 0.28;
// El atajo del gesto rápido: un manotazo corto y decidido cierra sin llegar a la
// fracción. px/ms — 0,55 es un gesto claramente intencionado.
const VELOCIDAD_CIERRE = 0.55;
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
const VUELTA_MS = 200;
const CURVA = "cubic-bezier(.16,1,.3,1)";

/**
 * @param {object} p
 * @param {HTMLElement|null} p.hojaEl   panel de la hoja.
 * @param {boolean} p.activo            solo con la hoja abierta.
 * @param {() => void} p.onCerrar       cerrar de verdad (lo decide el caller).
 * @param {(px: number) => void} p.onDesplazar  la hoja va N px más abajo.
 */
export function useArrastreHoja({ hojaEl, activo, onCerrar, onDesplazar }) {
  // LAS DOS FUNCIONES, POR REF Y NO POR DEPENDENCIA. `onCerrar` llega como una
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

    let inicioY = 0;
    let muestras = [];
    let recorrido = 0;
    let permitido = false;
    let siguiendo = false;
    // La devolución de estilos queda pendiente de un `transitionend`, y ese
    // evento puede no llegar nunca: si el dedo vuelve a agarrar la hoja a mitad
    // del rebote, la transición se CANCELA (y `transitionend` no se dispara con
    // una cancelación). El oyente huérfano se quedaría esperando y acabaría
    // saltando en la siguiente transición de la hoja —la de salida, por
    // ejemplo—, borrando el `transform` justo cuando hace falta. Se guarda para
    // poder retirarlo a mano.
    let limpieza = null;

    function cancelarLimpieza() {
      if (!limpieza) return;
      hojaEl.removeEventListener("transitionend", limpieza);
      limpieza = null;
    }

    // El primer ancestro DESPLAZABLE entre el dedo y la hoja. Se para en la
    // propia hoja: lo que haya por encima no es asunto de este gesto.
    function scrollerBajo(nodo) {
      let el = nodo instanceof Element ? nodo : null;
      while (el && el !== hojaEl) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const desborde = getComputedStyle(el).overflowY;
          if (desborde === "auto" || desborde === "scroll") return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function mover(px) {
      hojaEl.style.transition = "none";
      hojaEl.style.transform = `translateY(${px}px)`;
      desplazarRef.current?.(px);
    }

    function soltarElMando() {
      // Devuelve la hoja a sus clases: a partir de aquí manda ModalShell otra
      // vez. Sin esto, el `transform` en línea se quedaría puesto y la siguiente
      // animación de entrada no tendría desde dónde salir.
      hojaEl.style.transition = "";
      hojaEl.style.transform = "";
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

    function onStart(e) {
      if (e.touches.length !== 1) return;
      cancelarLimpieza();
      const t = e.touches[0];
      inicioY = t.clientY;
      muestras = [{ y: t.clientY, t: e.timeStamp }];
      recorrido = 0;
      siguiendo = false;
      const scroller = scrollerBajo(e.target);
      permitido = !scroller || scroller.scrollTop <= 0;
    }

    function onMove(e) {
      if (!permitido || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - inicioY;
      // Hacia arriba no se arrastra: la hoja está anclada abajo y subirla
      // despegaría su borde inferior del borde de la pantalla.
      if (!siguiendo) {
        if (dy < UMBRAL) return;
        siguiendo = true;
        // Mientras dura el gesto, el marco de la foto va SIN transición: tiene
        // que ir pegado al dedo, no persiguiéndolo con 200ms de retraso.
        raiz.dataset.arrastrando = "";
      }
      // El scroll del navegador, cortado justo aquí y no antes: hasta el umbral
      // el gesto todavía podía ser un scroll de la lista.
      if (e.cancelable) e.preventDefault();
      muestras.push({ y, t: e.timeStamp });
      while (muestras.length > 2 && e.timeStamp - muestras[0].t > VENTANA_MS) {
        muestras.shift();
      }
      recorrido = Math.max(0, dy - UMBRAL);
      mover(recorrido);
    }

    function onEnd() {
      if (!siguiendo) {
        permitido = false;
        return;
      }
      siguiendo = false;
      permitido = false;
      delete raiz.dataset.arrastrando;

      const alto = hojaEl.offsetHeight || 1;
      const cierra =
        recorrido > alto * FRACCION_CIERRE ||
        (velocidadFinal() > VELOCIDAD_CIERRE && recorrido > MINIMO_GESTO_RAPIDO);

      hojaEl.style.transition = `transform ${VUELTA_MS}ms ${CURVA}`;
      if (cierra) {
        // Se termina el viaje que el dedo dejó a medias. `onCerrar` desmonta la
        // hoja por la vía de siempre (ModalShell y su animación de salida), y la
        // limpieza del hook de la foto la devuelve a su sitio a la vez: el
        // mismo gesto, las dos piezas.
        hojaEl.style.transform = "translateY(100%)";
        cerrarRef.current?.();
        return;
      }
      hojaEl.style.transform = "translateY(0px)";
      desplazarRef.current?.(0);
      limpieza = (ev) => {
        if (ev.target !== hojaEl) return;
        cancelarLimpieza();
        soltarElMando();
      };
      hojaEl.addEventListener("transitionend", limpieza);
    }

    // `touchcancel` lo dispara el sistema cuando se lleva el gesto (una llamada,
    // el gesto de atrás del borde). Se trata como un final: la hoja vuelve.
    hojaEl.addEventListener("touchstart", onStart, { passive: true });
    hojaEl.addEventListener("touchmove", onMove, { passive: false });
    hojaEl.addEventListener("touchend", onEnd);
    hojaEl.addEventListener("touchcancel", onEnd);

    return () => {
      cancelarLimpieza();
      hojaEl.removeEventListener("touchstart", onStart);
      hojaEl.removeEventListener("touchmove", onMove);
      hojaEl.removeEventListener("touchend", onEnd);
      hojaEl.removeEventListener("touchcancel", onEnd);
      delete raiz.dataset.arrastrando;
    };
  }, [hojaEl, activo]);
}
