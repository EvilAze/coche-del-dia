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
//     ni de la animación de entrada de ModalShell (que la desplaza 8px) ni de
//     ninguna transformación.
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

import { useEffect } from "react";
import { AIRE_HOJA, calcularApartado } from "../lib/escenarioApartado";

/**
 * @param {boolean} abierta ¿hay hoja de selección a la vista?
 * @param {HTMLElement|null} hojaEl el panel de la hoja, cuando ya está montado.
 */
export function useEscenarioApartado(abierta, hojaEl) {
  useEffect(() => {
    if (!abierta || !hojaEl || typeof document === "undefined") return;
    const raiz = document.documentElement;

    function medir() {
      // El escenario puede no existir: la hoja también se abre desde pantallas
      // sin fotografía (la repesca antes de sortear) y, sobre todo, en los
      // tests. Sin foto no hay nada que apartar.
      const escenario = document.querySelector("[data-escenario]");
      if (!escenario || !hojaEl.isConnected) return;
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

      const { subida, escala } = calcularApartado({
        tope,
        suelo: window.innerHeight - hojaEl.offsetHeight - AIRE_HOJA,
        fotoTop,
        fotoAlto: escenario.offsetHeight,
      });

      raiz.style.setProperty("--cdd-escenario-subida", `${subida}px`);
      raiz.style.setProperty("--cdd-escenario-escala", String(escala));
      // Dos estados y no uno: el cromo de encima solo se apaga si la foto le va
      // a pisar el sitio. Con la hoja corta —el año— la cabecera y la pista se
      // quedan, y no se mueve nada en pantalla.
      raiz.dataset.eligiendo = subida > 0 ? "apartada" : "abierta";
    }

    medir();

    // ResizeObserver falta en algún WebView viejo y en jsdom: sin él sigue
    // habiendo composición, solo que no se refina al subir el teclado (mejora
    // progresiva, regla 9).
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    ro?.observe(hojaEl);
    window.addEventListener("resize", medir);
    // En un WebView redimensionable los dos eventos dicen lo mismo, pero no en
    // todos: si el sistema decide superponer el teclado en vez de encoger la
    // ventana, el único que se entera es este.
    window.visualViewport?.addEventListener("resize", medir);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", medir);
      window.visualViewport?.removeEventListener("resize", medir);
      // Al cerrar se sueltan las tres cosas A LA VEZ: el `transform` calculado
      // vuelve a `none` y la transición del CSS lo devuelve a su sitio mientras
      // la hoja se va. Son el mismo gesto, así que van al mismo tiempo.
      delete raiz.dataset.eligiendo;
      raiz.style.removeProperty("--cdd-escenario-subida");
      raiz.style.removeProperty("--cdd-escenario-escala");
    };
  }, [abierta, hojaEl]);
}
