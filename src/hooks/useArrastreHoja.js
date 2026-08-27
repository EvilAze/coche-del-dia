// src/hooks/useArrastreHoja.js
// La hoja de selección se agarra y se mueve: hacia abajo para cerrarla, hacia
// arriba para ver más lista. Y la fotografía la sigue en los dos sentidos, en
// tiempo real.
//
// LA IDEA, Y ES UNA SOLA. La hoja no tiene «una altura», tiene un RECORRIDO, y
// la foto no está en «una posición», está donde la deje la hoja. Son la misma
// composición vista por sus dos extremos, así que el gesto no es «abrir/cerrar»
// sino mover un único número: dónde queda el filete de arriba de la hoja. Todo
// lo demás sale de ahí — cuánto sube la foto, cuánto encoge, cuántas marcas
// caben. Por eso el dedo no dispara estados, los recorre.
//
// EL RECORRIDO, de arriba abajo:
//   · ESTIRADA. El tope lo pone lib/escenarioApartado: justo donde la foto llega
//     a los 78px del recorte flotante. Tirando del todo, la fotografía SE
//     CONVIERTE en el recorte y ni un píxel menos — la promesa de que no se
//     pierde de vista se sostiene hasta el último milímetro del gesto.
//   · EN REPOSO. Donde se abre: la foto entera y la lista debajo.
//   · FUERA. Pasado el 28% de su alto (o con un manotazo), se va.
// Al soltar cae al escalón de al lado: ni se queda a medias ni hay que acertar.
//
// DE DÓNDE SE PUEDE TIRAR. De la cabecera y del tirador, siempre. De la lista,
// solo si está ARRIBA DEL TODO — a media lista el gesto vertical es scroll y
// robárselo sería insufrible; y estando arriba, tirar hacia abajo ya no scrollea
// nada, así que ese gesto está libre. La regla vale para los dos sentidos a
// propósito: «la hoja se agarra por donde no hay lista que mover» se explica en
// una frase, y una regla que se explica en una frase es una que el pulgar
// aprende solo.
//
// Y DE DONDE NO SE PUEDE TIRAR NUNCA: de lo que lleve `data-gesto-propio`. Hay
// piezas dentro de la hoja que ya son dueñas de su vertical —el índice A-Z, que
// se recorre con el dedo— y sus toques llegan hasta aquí igual. Ver `onStart`.
//
// LO QUE NO CRECE ES LO QUE NO TIENE NADA QUE ENSEÑAR. Si el contenido cabe
// entero —los años de una horquilla corta— no hay gesto hacia arriba: estirar
// solo serviría para tapar la foto con papel en blanco. El margen se recorta a
// lo que de verdad sobresale.
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
 * @param {string} p.clave              cambia cuando cambia el contenido (el
 *                                      paso del cupón). Devuelve la hoja a su
 *                                      altura de reposo: una hoja estirada para
 *                                      ochenta marcas es papel en blanco para
 *                                      cinco años.
 * @param {() => void} p.onCerrar       cerrar de verdad (lo decide el caller).
 * @param {(px: number) => void} p.onDesplazar  la hoja va N px más abajo (0 si
 *                                      lo que ha cambiado es su altura).
 * @param {(alturaReposo: number) => number} p.margenParaCrecer  cuánto puede
 *                                      estirarse sin comerse la fotografía.
 */
export function useArrastreHoja({
  hojaEl,
  activo,
  clave,
  onCerrar,
  onDesplazar,
  margenParaCrecer,
}) {
  // LAS FUNCIONES, POR REF Y NO POR DEPENDENCIA. `onCerrar` llega como una
  // flecha nueva en cada render del cupón, así que ponerla en el array de
  // dependencias desmontaría y volvería a montar los listeners cada vez que algo
  // se re-renderiza — y si eso cae A MITAD DE UN GESTO, el arrastre pierde su
  // estado y la hoja se queda colgada donde estuviera el dedo. Con refs, el
  // efecto se monta una vez por apertura y siempre llama a la última versión.
  const cerrarRef = useRef(onCerrar);
  const desplazarRef = useRef(onDesplazar);
  const margenRef = useRef(margenParaCrecer);
  cerrarRef.current = onCerrar;
  desplazarRef.current = onDesplazar;
  margenRef.current = margenParaCrecer;

  useEffect(() => {
    if (!activo || !hojaEl || typeof document === "undefined") return;
    const raiz = document.documentElement;

    // Lo estirada que está la hoja ahora mismo, en px por encima de su altura de
    // reposo. Sobrevive entre gestos: si la dejas arriba, se queda arriba.
    let estirada = 0;
    // Estado del gesto en curso.
    let inicioY = 0;
    let muestras = [];
    let base = 0;
    let margen = 0;
    let offset0 = 0;
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

    // Cuánto contenido queda por debajo del corte. Es el techo real del gesto
    // hacia arriba: estirar más de lo que hay que enseñar solo añade papel.
    // Recorrido en anchura y con tope, porque el scroller de la hoja está a uno
    // o dos niveles del cuerpo pero no siempre en el mismo sitio (la lista de
    // marcas vive dentro de su caja; la rejilla de años, no).
    function sobraDeContenido() {
      const cuerpo = hojaEl.querySelector(".pm-hoja-cuerpo");
      if (!cuerpo) return 0;
      const pila = [...cuerpo.children];
      for (let i = 0; i < pila.length && i < 40; i++) {
        const el = pila[i];
        if (desbordaEnVertical(el)) return el.scrollHeight - el.clientHeight;
        pila.push(...el.children);
      }
      return 0;
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

    // EL ÚNICO SITIO QUE TOCA EL DOM. `offset` es dónde queda el filete de
    // arriba de la hoja respecto a su reposo: negativo = estirada, positivo =
    // empujada hacia fuera. Los dos lados se pintan distinto, y no es capricho —
    // estirarla le cambia el ALTO (la lista tiene que crecer para enseñar más
    // filas) y empujarla fuera es un `transform` (no hay nada nuevo que enseñar,
    // así que no hay por qué recomponer nada).
    function escribir(px) {
      if (px < 0) {
        hojaEl.style.maxHeight = "none";
        hojaEl.style.height = `${base - px}px`;
        hojaEl.style.transform = "translateY(0px)";
        // Sin desplazamiento: el alto nuevo ya está en el nodo y el hook de la
        // composición lo lee de ahí.
        desplazarRef.current?.(0);
        return;
      }
      hojaEl.style.maxHeight = "";
      hojaEl.style.height = "";
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
      base = hojaEl.offsetHeight - estirada;
      offset0 = -estirada;
      offset = offset0;
      // El margen se mide contra el reposo, y la sobra de contenido contra lo
      // que se ve AHORA: sumarle lo ya estirado devuelve el recorrido completo,
      // que es el mismo tanto si el gesto empieza abajo como a medio camino.
      margen = Math.max(
        0,
        Math.min(margenRef.current?.(base) ?? 0, sobraDeContenido() + estirada)
      );
      const scroller = scrollerBajo(e.target);
      permitido = !scroller || scroller.scrollTop <= 0;
    }

    function onMove(e) {
      if (!permitido || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const dy = y - inicioY;

      if (!siguiendo) {
        if (Math.abs(dy) < UMBRAL) return;
        // HACIA ARRIBA SOLO SI HAY SITIO. Si la hoja no puede crecer más, el
        // gesto NO se toca: todavía no se ha llamado a `preventDefault`, así que
        // el navegador se lo queda y la lista scrollea nativa, con su inercia.
        // Robarlo para no hacer nada con él sería lo peor de los dos mundos.
        if (dy < 0 && offset0 <= -margen) {
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
      // engancharse: empieza a moverse desde donde estaba, no desde donde el
      // dedo lleva ya recorrido.
      offset = Math.max(offset0 + dy - Math.sign(dy) * UMBRAL, -margen);
      programar(offset);
    }

    function asentar(destino) {
      cancelAnimationFrame(pintado);
      pintado = 0;
      estirada = Math.max(0, -destino);
      hojaEl.style.transition =
        `height ${ASENTAR_MS}ms ${CURVA}, transform ${ASENTAR_MS}ms ${CURVA}`;
      escribir(destino);
      limpieza = (ev) => {
        if (ev.target !== hojaEl) return;
        cancelarLimpieza();
        // Solo se suelta la transición. El alto y el `transform` SON el reposo
        // nuevo si la hoja se ha quedado estirada; devolverlos a las clases la
        // dejarían caer de golpe.
        hojaEl.style.transition = "";
        if (destino === 0) hojaEl.style.transform = "";
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
        estirada = 0;
        hojaEl.style.transition = `transform ${ASENTAR_MS}ms ${CURVA}`;
        hojaEl.style.transform = "translateY(100%)";
        cerrarRef.current?.();
        return;
      }

      // Entre los dos escalones que quedan manda el impulso; sin impulso, el más
      // cercano. Es lo que hace que un gesto corto y decidido valga tanto como
      // uno largo.
      let destino = 0;
      if (margen > 0) {
        if (velocidad < -VELOCIDAD) destino = -margen;
        else if (velocidad > VELOCIDAD) destino = 0;
        else destino = offset < -margen / 2 ? -margen : 0;
      }
      asentar(destino);
    }

    // `touchcancel` lo dispara el sistema cuando se lleva el gesto (una llamada,
    // el gesto de atrás del borde). Se trata como un final: la hoja se asienta.
    hojaEl.addEventListener("touchstart", onStart, { passive: true });
    hojaEl.addEventListener("touchmove", onMove, { passive: false });
    hojaEl.addEventListener("touchend", onEnd);
    hojaEl.addEventListener("touchcancel", onEnd);

    // Si cambia el tamaño de la ventana —el teclado, girar el móvil— el alto en
    // línea que dejó el gesto ya no vale: se calculó contra otra pantalla. Se
    // suelta y vuelve a mandar el CSS, que es quien sabe rehacer la cuenta.
    const alRedimensionar = () => {
      if (siguiendo || !estirada) return;
      estirada = 0;
      hojaEl.style.height = "";
      hojaEl.style.maxHeight = "";
    };
    window.addEventListener("resize", alRedimensionar);
    window.visualViewport?.addEventListener("resize", alRedimensionar);

    return () => {
      cancelAnimationFrame(pintado);
      cancelarLimpieza();
      hojaEl.removeEventListener("touchstart", onStart);
      hojaEl.removeEventListener("touchmove", onMove);
      hojaEl.removeEventListener("touchend", onEnd);
      hojaEl.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("resize", alRedimensionar);
      window.visualViewport?.removeEventListener("resize", alRedimensionar);
      delete raiz.dataset.arrastrando;
    };
    // `clave` entra en las dependencias para que al cambiar de paso el efecto se
    // rehaga: `estirada` es estado de este efecto, así que remontarlo ES el
    // reset. El alto en línea lo suelta el efecto de abajo.
  }, [hojaEl, activo, clave]);

  // EL ALTO EN LÍNEA NO SOBREVIVE A UN CAMBIO DE PASO: la hoja de los años no
  // mide lo que la de las marcas, y dejarla estirada para cinco décadas es papel
  // en blanco tapando la foto. Va en su propio efecto y no en la limpieza del de
  // arriba porque aquella corre TAMBIÉN al cerrar, y ahí el nodo está en plena
  // animación de salida: tocarle el alto en ese momento se vería como un tirón.
  useEffect(() => {
    if (!hojaEl) return;
    hojaEl.style.height = "";
    hojaEl.style.maxHeight = "";
  }, [hojaEl, clave]);
}
