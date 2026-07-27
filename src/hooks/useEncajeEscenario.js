// src/hooks/useEncajeEscenario.js
// Encaja la foto del día para que el botón ADIVINAR entre ENTERO en pantalla
// nada más abrir, en cualquier móvil.
//
// EL PROBLEMA: la portada tiene una altura que no controlamos —topbar, masthead
// (completo la primera visita, compacto después), línea de temporada (llega
// asíncrona), folio y la faja de clasificación—, y debajo va la foto y luego el
// cupón. En una pantalla de 667px el conjunto se pasaba de largo y el botón
// quedaba cortado por abajo: el jugador entraba y no veía la acción principal.
//
// LA PALANCA ES EL ANCHO, NO EL ALTO. El marco es 4:3 y esa proporción NO se
// puede tocar: de ella dependen el recorte que calcula el servidor, los `scale`
// del zoom y el lightbox, que replica el marco para enseñar exactamente los
// mismos píxeles y ni uno más (reglas 5 y 7). Si capásemos la ALTURA, el marco
// se volvería más apaisado que 4:3 y `object-fit: cover` recortaría de más —
// cambiaría la dificultad del día. Capando el ANCHO la proporción se mantiene
// intacta y la altura baja sola: la misma foto, más pequeña.
//
// SOLO CUENTA EL PRIMER TURNO. Tras el primer intento aparece la fila viva
// (el último intento) entre la foto y el cupón, que volvería a empujar el botón
// fuera. NO recalculamos por eso a propósito: encoger la foto a mitad de
// partida sería peor que perder el botón de vista, y a esas alturas el jugador
// ya sabe dónde está y viene bajando solo. Por eso `activo` se apaga en cuanto
// hay un intento, y el valor se congela.
//
// La medida sale del DOM real (no de una suma de constantes que se desincroniza
// al primer cambio de CSS), pero excluye deliberadamente la fila viva: se mide
// "lo que hay encima de la foto" + "el cupón", nunca lo que va en medio.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Aire bajo el botón: sin él queda pegado al borde y no se lee como "cabe",
// se lee como "está cortado justo ahí".
const AIRE = 10;
// Suelo de la foto. Por debajo de esto el escenario deja de ser jugable (el
// zoom del primer intento ya enseña un detalle diminuto), así que preferimos
// perder el botón antes que servir un sello de correos. Pantallas así de bajas
// son casi siempre un móvil en horizontal, donde de todas formas se hace scroll.
const ALTO_MINIMO = 168;
// A partir del pliego ancho la foto es la columna central y el cupón vive en su
// propia columna, al lado: no hay nada que encajar.
const PLIEGO = "(min-width: 1100px)";

// La aritmética, aparte del DOM para poder testearla: dado lo que mide cada
// pieza, ¿qué ancho máximo le toca al escenario? Devuelve null = "cabe entero,
// no lo toques".
//
//   altoVentana  alto útil de la ventana
//   arriba       todo lo que va ENCIMA de la sección de la foto
//   extras       lo que ocupa la sección aparte del marco (ladillo, pie)
//   hueco        separación entre bloques del pliego
//   altoJugar    el cupón entero, botón ADIVINAR incluido
//   altoNatural  lo que mediría el marco sin capar (ancho de columna en 4:3)
export function calcularEncaje({
  altoVentana,
  arriba,
  extras,
  hueco,
  altoJugar,
  altoNatural,
}) {
  const disponible = altoVentana - arriba - extras - hueco - altoJugar - AIRE;
  if (disponible >= altoNatural) return null;
  return Math.round((Math.max(disponible, ALTO_MINIMO) * 4) / 3);
}

export function useEncajeEscenario({ fotoRef, jugarRef, hojaRef, activo }) {
  const [maxAncho, setMaxAncho] = useState(null);
  // Guardamos el último valor en un ref además del estado para no re-renderizar
  // cuando la medida no ha cambiado (el ResizeObserver dispara con frecuencia).
  const ultimoRef = useRef(null);
  // Alto de ventana CONGELADO. No se lee `window.innerHeight` en cada medida a
  // propósito: con el teclado abierto vale mucho menos, y cualquier remedida
  // disparada mientras el jugador escribe (un error de validación bajo un campo
  // hace crecer el cupón y despierta al ResizeObserver) encogería la foto de
  // golpe. Solo se refresca cuando cambia el ancho de la ventana —girar el
  // móvil o redimensionar en escritorio—, que es cuando de verdad caduca.
  const altoVentanaRef = useRef(
    typeof window === "undefined" ? 0 : window.innerHeight
  );

  const medir = useCallback(() => {
    const foto = fotoRef.current;
    const jugar = jugarRef.current;
    const hoja = hojaRef.current;
    if (!foto || !jugar || !hoja) return;

    if (window.matchMedia(PLIEGO).matches) {
      if (ultimoRef.current !== null) {
        ultimoRef.current = null;
        setMaxAncho(null);
      }
      return;
    }

    // El marco vive dentro de CarImage. Lo buscamos acotados a nuestra propia
    // sección en vez de hacer bajar un ref por ZoomStage y CarImage: CarImage
    // es código sensible (pipeline de imagen y regla 5) y no merece una prop
    // nueva solo para esto. `.cdd-stage-frame` es la pieza pública del sistema.
    const marco = foto.querySelector(".cdd-stage-frame");
    if (!marco) return;

    const rFoto = foto.getBoundingClientRect();
    const rMarco = marco.getBoundingClientRect();
    const rJugar = jugar.getBoundingClientRect();

    // Lo que ocupa la sección de la foto SIN el marco: el ladillo de arriba y
    // el pie con los pips. No depende del cap, así que la resta es estable
    // aunque ya hayamos encogido el marco antes.
    const extras = rFoto.height - rMarco.height;
    // Todo lo que hay por encima de la foto (cabecera + folio + faja + padding
    // del pliego), en coordenadas de documento para que no dependa del scroll.
    const arriba = rFoto.top + window.scrollY;
    // Separación entre bloques del pliego. Se lee del CSS en vez de fijarla a
    // 12: si algún día cambia el `gap-3`, esto sigue cuadrando.
    const hueco = parseFloat(getComputedStyle(hoja).rowGap) || 0;

    // El alto que el marco tendría sin capar: el ancho de la columna en 4:3.
    // Se calcula desde el ancho de la SECCIÓN (nunca del marco, que puede venir
    // ya capado de una medición anterior y nos haría oscilar).
    const altoNatural = (foto.clientWidth * 3) / 4;

    const siguiente = calcularEncaje({
      altoVentana: altoVentanaRef.current,
      arriba,
      extras,
      hueco,
      altoJugar: rJugar.height,
      altoNatural,
    });

    if (siguiente !== ultimoRef.current) {
      ultimoRef.current = siguiente;
      setMaxAncho(siguiente);
    }
  }, [fotoRef, jugarRef, hojaRef]);

  useLayoutEffect(() => {
    // Congelado: pasado el primer intento dejamos de medir y el valor se queda
    // como estaba. Ver la nota de arriba — es la decisión, no un olvido.
    if (!activo) return;
    if (typeof window === "undefined") return;

    // useLayoutEffect: la primera medida entra ANTES del primer pintado, así
    // que el jugador no ve la foto grande y luego encogerse.
    medir();

    // Qué observamos y por qué cada uno:
    //   · la CABECERA, porque la línea de temporada llega asíncrona y la hace
    //     crecer DESPUÉS de la primera medida. Es el caso que más engaña:
    //     crecer la cabecera no cambia el tamaño de la foto, solo su posición,
    //     así que observando solo la foto no nos enteraríamos nunca.
    //   · el CUPÓN, que crece al cargar las fuentes.
    //   · la propia FOTO, para converger tras aplicar el cap.
    // La cabecera se alcanza como primer hijo del pliego en vez de bajando un
    // ref por Header: es la primera sección del periódico por definición, y no
    // merece atravesar la API del componente.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(medir);
      const cabecera = hojaRef.current?.firstElementChild;
      if (cabecera) ro.observe(cabecera);
      if (fotoRef.current) ro.observe(fotoRef.current);
      if (jugarRef.current) ro.observe(jugarRef.current);
    }
    // OJO con `resize`: en Android abrir el teclado lo dispara con un
    // innerHeight mucho menor. Solo damos por caducado el alto de ventana
    // cuando cambia el ANCHO — girar el móvil o redimensionar en escritorio—,
    // que es lo único que invalida de verdad la medida. El teclado nunca lo
    // toca.
    let anchoPrevio = window.innerWidth;
    let raf = 0;
    // Al girar, algunos navegadores disparan el evento ANTES de tener las
    // dimensiones nuevas: refrescamos en el frame siguiente.
    const revalidar = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        anchoPrevio = window.innerWidth;
        altoVentanaRef.current = window.innerHeight;
        medir();
      });
    };
    // `resize` sí pasa por el filtro del ancho (el teclado no debe colarse);
    // `orientationchange` no, porque al dispararse aún puede no haberse
    // actualizado el ancho y el filtro lo descartaría para siempre.
    const alRedimensionar = () => {
      if (window.innerWidth === anchoPrevio) return;
      revalidar();
    };
    window.addEventListener("resize", alRedimensionar);
    window.addEventListener("orientationchange", revalidar);

    return () => {
      ro?.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", alRedimensionar);
      window.removeEventListener("orientationchange", revalidar);
    };
  }, [activo, medir, fotoRef, jugarRef, hojaRef]);

  return maxAncho;
}
