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
import { AIRE_HOJA, calcularApartado } from "../lib/escenarioApartado";

/**
 * @param {boolean} abierta ¿hay hoja de selección a la vista?
 * @param {HTMLElement|null} hojaEl el panel de la hoja, cuando ya está montado.
 * @returns {(desplazamiento?: number) => void} `seguir`: recalcula la foto para
 *          una hoja desplazada N píxeles hacia abajo. Lo usa el arrastre, que
 *          mueve la hoja con el dedo y necesita que la foto baje con ella.
 */
export function useEscenarioApartado(abierta, hojaEl) {
  // El puente entre el efecto (que tiene las medidas) y el arrastre (que las
  // pide). Un ref y no un estado: esto se llama en cada `touchmove` y provocar
  // un render por frame sería justamente lo que hace que un arrastre se sienta
  // pastoso.
  const seguirRef = useRef(null);
  const seguir = useCallback((desplazamiento = 0) => {
    seguirRef.current?.(desplazamiento);
  }, []);

  useEffect(() => {
    if (!abierta || !hojaEl || typeof document === "undefined") return;
    const raiz = document.documentElement;
    let pendiente = null;

    function medir(desplazamiento = 0) {
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

      return calcularApartado({
        tope,
        // El desplazamiento del arrastre BAJA el filete de la hoja, así que el
        // hueco de la foto crece con él. Es lo único que hace falta para que la
        // foto vuelva a su sitio siguiendo al dedo.
        suelo: window.innerHeight - hojaEl.offsetHeight - AIRE_HOJA + desplazamiento,
        fotoTop,
        fotoAlto: escenario.offsetHeight,
      });
    }

    function aplicar({ subida, escala }) {
      raiz.style.setProperty("--cdd-escenario-subida", `${subida}px`);
      raiz.style.setProperty("--cdd-escenario-escala", String(escala));
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
    const inicial = medir();
    if (inicial) {
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => aplicar(inicial));
        pendiente = () => cancelAnimationFrame(raf2);
      });
      pendiente = () => cancelAnimationFrame(raf1);
    }

    const remedir = () => {
      const r = medir();
      if (r) aplicar(r);
    };
    seguirRef.current = (desplazamiento) => {
      const r = medir(desplazamiento);
      if (r) aplicar(r);
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
      raiz.style.removeProperty("--cdd-escenario-subida");
      raiz.style.removeProperty("--cdd-escenario-escala");
    };
  }, [abierta, hojaEl]);

  return seguir;
}
