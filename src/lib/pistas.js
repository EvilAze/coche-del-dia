// src/lib/pistas.js
// Lo que el jugador YA SABE después de sus intentos, dicho en palabras.
//
// El historial lo cuenta todo, pero en el idioma del corrector: un tachado rojo,
// un subrayado ámbar con bandera, una flecha de 11px junto a la cifra. Para quien
// lleva semanas jugando eso se lee de un vistazo. Para quien acaba de fallar su
// primer intento, la misma fila es una pared de tachones: no ve que la flecha le
// ha regalado media horquilla de años ni que la bandera le dice el país. Lo
// consume la nota de la primera partida (ver Configurator), y solo ella.
//
// Pura y sin React a propósito: recibe `t` y devuelve cadenas, así que se testea
// sin montar nada.

import { yearRange, MIN_YEAR } from "./yearRange";

/**
 * @param {Array} guesses  Intentos tal cual los sirve el servidor.
 * @param {number} tolerance  Margen ± del año.
 * @param {(key: string, vars?: object) => string} t
 * @param {number} [maxYear]
 * @returns {string[]}  Frases cortas en minúscula, listas para unir con « · ».
 */
export function pistasAprendidas(
  guesses,
  tolerance,
  t,
  maxYear = new Date().getFullYear(),
  nombrePais = null
) {
  const lista = Array.isArray(guesses) ? guesses : [];
  const pistas = [];

  // MARCA. Acertada manda sobre «mismo país»: si ya sabes la marca, el país
  // sobra. El país se dice con la marca que lo destapó, que es la que el jugador
  // tiene en la cabeza — «mismo país que Alfa Romeo» se entiende sin saber que
  // la bandera era la italiana.
  //
  // …PERO SE DICE TAMBIÉN EL PAÍS, si se sabe cuál es (`nombrePais` traduce el
  // código del servidor). En la partida del 7-oct, «es del mismo país que
  // Nissan» obligaba a traducir Nissan → Japón cuando la celda ya enseñaba la
  // bandera. «Es de Japón, como Nissan» dice las dos cosas.
  const marcaOk = lista.find((g) => g?.marca?.status === "correct");
  const marcaCerca = lista.find((g) => g?.marca?.status === "partial");
  if (marcaOk?.marca?.val) pistas.push(t("primera.marcaOk", { marca: marcaOk.marca.val }));
  else if (marcaCerca?.marca?.val) {
    const pais = marcaCerca.marca.pais && nombrePais ? nombrePais(marcaCerca.marca.pais) : null;
    pistas.push(
      pais
        ? t("primera.mismoPaisDe", { pais, marca: marcaCerca.marca.val })
        : t("primera.mismoPais", { marca: marcaCerca.marca.val })
    );
  }

  const modeloOk = lista.find((g) => g?.modelo?.status === "correct");
  if (modeloOk?.modelo?.val) pistas.push(t("primera.modeloOk", { modelo: modeloOk.modelo.val }));

  // AÑO. La horquilla es la misma que enseña el cupón (lib/yearRange), así que
  // la nota y el campo no pueden contradecirse.
  const anioOk = lista.find((g) => g?.anio?.status === "correct");
  if (anioOk?.anio?.val != null) {
    pistas.push(t("primera.anioOk", { anio: anioOk.anio.val, n: tolerance }));
  } else {
    const h = yearRange(lista, tolerance, maxYear);
    if (h.acotada) {
      const rango =
        h.min > MIN_YEAR && h.max < maxYear
          ? t("cdd.yearRangeBetween", { min: h.min, max: h.max })
          : h.min > MIN_YEAR
            ? t("cdd.yearRangeFrom", { min: h.min })
            : t("cdd.yearRangeTo", { max: h.max });
      // «Entre 1995 y 2003» es un rótulo que empieza en mayúscula; aquí va a
      // media frase («año entre 1995 y 2003»).
      pistas.push(t("primera.anioRango", { rango: rango.charAt(0).toLowerCase() + rango.slice(1) }));
    }
  }

  return pistas;
}
