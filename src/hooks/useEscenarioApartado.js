// src/hooks/useEscenarioApartado.js
// El brazo del cálculo de lib/escenarioApartado: mide la pantalla mientras la
// hoja de selección está abierta y publica el resultado en `<html>` para que lo
// aplique el CSS.
//
// POR QUÉ EN VARIABLES CSS Y NO EN ESTILOS DEL COMPONENTE. Quien tiene que
// moverse (el marco de la foto) y quien sabe cuánto (la hoja) están en ramas
// distintas del árbol y no se conocen: la hoja cuelga de GuessForm y el marco lo
// pinta CarImage tres componentes más arriba. Pasar el dato por props obligaría
// a atravesar Configurator y ZoomStage con una prop que solo existe para esto.
// Dos variables y un atributo en la raíz lo dicen igual, y de paso la
// composición entera queda escrita en el CSS, junto a las demás reglas del
// shell de la app, que es donde se busca.
//
// LO QUE SE MIDE Y LO QUE NO:
//   · La hoja, por `offsetHeight`. Es medida de MAQUETA, así que no se entera
//     ni de la animación de entrada ni del arrastre: los dos son `transform`, y
//     el desplazamiento en vuelo entra por el parámetro `desplazamiento`.
//   · El escenario, por su caja externa `[data-escenario]` (.cdd-stage), que
//     NUNCA se transforma: el `transform` va al marco de dentro. Si midiéramos
//     el elemento transformado, cada recálculo a media animación leería una
//     posición en vuelo y la cuenta se realimentaría sola.
//   · El tope, del `padding-top` del propio pliego. Ahí es donde empieza el
//     contenido bajo la barra de estado, y es un número que ya existe: leerlo
//     evita duplicar aquí el `env(safe-area-inset-top)` (que además no se puede
//     leer desde JS: `getPropertyValue` devuelve el literal, no los píxeles).
//
// SE REMIDE con el teclado, porque es el caso apretado: al subir, Android
// encoge el WebView, la hoja encoge con él (va en `dvh`) y el hueco de arriba
// cambia entero. Lo cazan el ResizeObserver de la hoja y el `resize` de la
// ventana; el propio `transform` no reordena nada, así que no puede realimentar
// al observador.
//
// LA PRIMERA APLICACIÓN VA EN DOBLE rAF, y no es superstición. ModalShell monta
// el panel y espera dos frames antes de encender su clase visible (necesita que
// el navegador pinte el estado inicial o no habría animación de entrada). Este
// hook, en cambio, puede medir en cuanto el nodo existe. Aplicando a pelo, la
// foto arrancaba dos frames ANTES que la hoja: 32ms de desfase entre dos piezas
// que tienen que leerse como una sola. Con el mismo doble rAF los dos cambios de
// estilo caen en el mismo frame y las dos transiciones —misma duración, misma
// curva— salen clavadas. Los recálculos posteriores (teclado, arrastre) se
// aplican en el acto: ahí no hay nada con lo que sincronizarse.

import { useCallback, useEffect, useRef } from "react";
import {
  AIRE_HOJA,
  calcularApartado,
} from "../lib/escenarioApartado";

/**
 * @param {boolean} abierta ¿hay hoja de selección a la vista?
 * @param {HTMLElement|null} hojaEl el panel de la hoja, cuando ya está montado.
 * @returns {{seguir: (desplazamiento?: number) => void}}
 *   `seguir` recalcula la foto para una hoja desplazada N píxeles hacia abajo,
 *   que es el gesto de cierre y el único que hay (ver `useArrastreHoja`).
 */
export function useEscenarioApartado(abierta, hojaEl) {
  // El puente entre el efecto (que tiene las medidas) y el arrastre (que las
  // pide). Refs y no estado: esto se llama en cada `touchmove` y provocar un
  // render por frame sería justamente lo que hace que un arrastre se sienta
  // pastoso.
  const seguirRef = useRef(null);
  const seguir = useCallback((desplazamiento = 0) => {
    seguirRef.current?.(desplazamiento);
  }, []);

  useEffect(() => {
    if (!abierta || !hojaEl || typeof document === "undefined") return;
    const raiz = document.documentElement;
    let pendiente = null;

    // El contexto de una medida: qué escenario hay y dónde empieza el pliego.
    function contexto() {
      // El escenario puede no existir: la hoja también se abre desde pantallas
      // sin fotografía (la repesca antes de sortear) y, sobre todo, en los
      // tests. Sin foto no hay nada que apartar.
      const escenario = document.querySelector("[data-escenario]");
      if (!escenario || !hojaEl.isConnected) return null;
      const fotoTop = escenario.getBoundingClientRect().top;

      // EL TOPE, Y SU CASO SIN SHELL. Dentro de la pantalla de juego el tope es
      // donde empieza el contenido del pliego, y de ahí sale el margen para
      // subir la foto: lo que hay por encima es cromo que se apaga.
      //
      // La repesca monta las MISMAS piezas (ZoomStage y este cupón) en una
      // página que se lee bajando, sin ese shell. Allí no hay cromo que apagar
      // —encima de la foto va contenido de verdad, y una página que scrollea no
      // tiene una «posición» que respetar—, así que el tope es la propia foto:
      // subida cero y solo encoge. Vale menos, pero nunca se pinta encima de
      // nada, que es lo que importa cuando no controlas lo que hay arriba.
      const pliego = escenario.closest(".app-pantalla");
      const tope = pliego
        ? pliego.getBoundingClientRect().top +
          (parseFloat(getComputedStyle(pliego).paddingTop) || 0)
        : fotoTop;

      return {
        tope,
        fotoTop,
        fotoAlto: escenario.offsetHeight,
        // El marco, para escribirle a ÉL las variables (ver `aplicar`).
        marco: escenario.querySelector(".cdd-stage-frame"),
      };
    }

    // LA GEOMETRÍA SE CONGELA MIENTRAS DURA UN GESTO, y esto es lo que decide si
    // el arrastre se siente de seda o de goma.
    //
    // El bucle era: `useArrastreHoja` ESCRIBE el transform de la hoja y acto
    // seguido llama aquí, que LEE `getBoundingClientRect` dos veces,
    // `getComputedStyle` una y `offsetHeight` otra. Leer layout justo después de
    // escribir estilo obliga al navegador a recalcularlo en el acto —layout
    // síncrono forzado— y eso pasaba en CADA FRAME del arrastre. A 60Hz se
    // disimula; a 120Hz el presupuesto por frame es de 8,3ms y ahí está la
    // diferencia entre seguir al dedo y perseguirlo.
    //
    // Y no hacía falta ni una de esas lecturas: durante el gesto la hoja se
    // mueve con un `transform`, que no toca el layout de nadie. El escenario
    // sigue donde estaba, el pliego también, y el alto de la hoja es el mismo
    // (desde que el gesto va en un solo sentido, ni siquiera cambia al
    // estirarla, porque ya no se estira). Lo único que varía es el
    // desplazamiento, que llega por argumento. Así que se mide UNA vez al
    // empezar y el resto del gesto es aritmética.
    let gesto = null;

    function medir(desplazamiento = 0, congelado = null) {
      const c = congelado ? congelado.ctx : contexto();
      if (!c) return null;
      return calcularApartado({
        tope: c.tope,
        // DOS FORMAS DE MOVER EL FILETE DE LA HOJA, y las dos entran por aquí:
        //   · El desplazamiento del arrastre hacia abajo la baja sin cambiarla
        //     de tamaño, así que hay que sumarlo a mano.
        //   · Estirarla hacia arriba le cambia el ALTO, y eso ya lo dice
        //     `offsetHeight` — por eso ahí el desplazamiento es cero.
        // En los dos casos la cuenta que sale es la misma: dónde queda el borde
        // de arriba de la hoja y cuánto hueco deja.
        suelo:
          window.innerHeight -
          (congelado ? congelado.alturaHoja : hojaEl.offsetHeight) -
          AIRE_HOJA +
          desplazamiento,
        fotoTop: c.fotoTop,
        fotoAlto: c.fotoAlto,
      });
    }

    // LAS DOS VARIABLES SE ESCRIBEN EN EL MARCO, NO EN LA RAÍZ, y esto es una
    // medida y no una opinión: durante un arrastre se reescriben en cada frame,
    // y una propiedad personalizada SE HEREDA — cambiarla en `:root` obliga al
    // navegador a revisar el estilo de todo el documento, ochenta filas de
    // marcas con sus banderas incluidas. Medido en el emulador con el protocolo
    // de DevTools: 2,6 ms de recálculo de estilo por frame, que a 120Hz es un
    // tercio del presupuesto entero (8,3 ms) gastado en repasar estilo de cosas
    // que no se mueven.
    //
    // Escritas en el marco, el `var()` de la regla las resuelve desde el propio
    // elemento y la invalidación se queda en él. La regla del CSS no cambia:
    // sigue siendo `.cdd-stage-frame { transform: … var(--cdd-escenario-subida) }`,
    // solo cambia de dónde saca el valor. Si el marco no existiera todavía se
    // cae a la raíz, que es el comportamiento de siempre.
    function aplicar({ subida, escala }, marco) {
      const destino = marco || raiz;
      destino.style.setProperty("--cdd-escenario-subida", `${subida}px`);
      destino.style.setProperty("--cdd-escenario-escala", String(escala));
      // EL CROMO NO PARPADEA MIENTRAS SE ARRASTRA. Durante el gesto la subida
      // baja hasta cero, y actualizar el atributo aquí encendería la cabecera de
      // golpe a mitad de recorrido — un parpadeo justo detrás de la hoja que se
      // está yendo. Se queda como estaba y lo resuelve el final del gesto: si la
      // hoja se cierra, la limpieza; si vuelve, el recálculo de después.
      if (raiz.hasAttribute("data-arrastrando")) return;
      // Dos estados y no uno: el cromo de encima solo se apaga si la foto le va
      // a pisar el sitio. Con la hoja corta —el año— la cabecera y la pista se
      // quedan, y no se mueve nada en pantalla.
      raiz.dataset.eligiendo = subida > 0 ? "apartada" : "abierta";
    }

    // La medida de apertura se calcula ya (el nodo está montado y maquetado) y
    // se APLICA dos frames después, a la vez que ModalShell enciende la hoja.
    const ctxInicial = contexto();
    const inicial = ctxInicial
      ? medir(0, { ctx: ctxInicial, alturaHoja: hojaEl.offsetHeight })
      : null;
    if (inicial) {
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => aplicar(inicial, ctxInicial.marco));
        pendiente = () => cancelAnimationFrame(raf2);
      });
      pendiente = () => cancelAnimationFrame(raf1);
    }

    const remedir = () => {
      // Cambió la ventana (teclado, giro): lo congelado ya no vale.
      gesto = null;
      const c = contexto();
      if (!c) return;
      const r = medir(0, { ctx: c, alturaHoja: hojaEl.offsetHeight });
      if (r) aplicar(r, c.marco);
    };
    seguirRef.current = (desplazamiento) => {
      // `data-arrastrando` lo pone useArrastreHoja al pasar el umbral y lo quita
      // al soltar: es la misma señal que ya usa el CSS para quitarle la
      // transición al marco, así que no hay un estado nuevo que mantener.
      if (!raiz.hasAttribute("data-arrastrando")) {
        gesto = null;
        const c = contexto();
        if (!c) return;
        const r = medir(desplazamiento, { ctx: c, alturaHoja: hojaEl.offsetHeight });
        if (r) aplicar(r, c.marco);
        return;
      }
      if (!gesto) {
        const ctx = contexto();
        if (!ctx) return;
        // La ÚNICA lectura de layout del gesto entero, y cae en su primer frame.
        gesto = { ctx, alturaHoja: hojaEl.offsetHeight };
      }
      const r = medir(desplazamiento, gesto);
      if (r) aplicar(r, gesto.ctx.marco);
    };
    // ResizeObserver falta en algún WebView viejo y en jsdom: sin él sigue
    // habiendo composición, solo que no se refina al subir el teclado (mejora
    // progresiva, regla 9).
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remedir);
    ro?.observe(hojaEl);
    window.addEventListener("resize", remedir);
    // En un WebView redimensionable los dos eventos dicen lo mismo, pero no en
    // todos: si el sistema decide superponer el teclado en vez de encoger la
    // ventana, el único que se entera es este.
    window.visualViewport?.addEventListener("resize", remedir);

    return () => {
      pendiente?.();
      seguirRef.current = null;
      ro?.disconnect();
      window.removeEventListener("resize", remedir);
      window.visualViewport?.removeEventListener("resize", remedir);
      // Al cerrar se sueltan las tres cosas A LA VEZ: el `transform` calculado
      // vuelve a `none` y la transición del CSS lo devuelve a su sitio mientras
      // la hoja se va. Son el mismo gesto, así que van al mismo tiempo.
      delete raiz.dataset.eligiendo;
      delete raiz.dataset.arrastrando;
      // Se limpian los DOS sitios posibles: el marco, que es donde se escriben,
      // y la raíz, por si alguna vez se cayó al respaldo (o por si quedan
      // restos de una versión anterior en una pestaña que no se recargó).
      const marcoFinal = document.querySelector(".cdd-stage-frame");
      for (const nodo of [marcoFinal, raiz]) {
        if (!nodo) continue;
        nodo.style.removeProperty("--cdd-escenario-subida");
        nodo.style.removeProperty("--cdd-escenario-escala");
      }
    };
  }, [abierta, hojaEl]);

  return { seguir };
}
