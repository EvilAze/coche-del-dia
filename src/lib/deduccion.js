// src/lib/deduccion.js
// Lo que los intentos ya dicen sobre el PAÍS del coche, aplicado a la lista de
// marcas. Es la lección del teclado de Wordle: las letras descartadas se
// apagan y las confirmadas se pintan, y así nadie gasta un intento en algo que
// ya sabe que no es.
//
// El cupón ya hacía la mitad (las marcas falladas desaparecen de la lista, los
// campos acertados se bloquean, el año acota su horquilla). Faltaba la
// deducción que el jugador nuevo no hace solo y que es justo la que el juego le
// regala: si un intento dio «mismo país», el país ya se sabe; si una marca
// falló sin más, TODAS las de su país quedan descartadas, no solo esa. El 75%
// de los nuevos que abandonan lo hace tras fallar la marca en el intento 1
// (oct-2026): es el momento en que la pista tiene que servir para algo.
//
// No destapa nada que el jugador no sepa: usa el país de las marcas que ÉL ha
// probado (catálogo público, el mismo que pinta las banderas de la lista) y el
// veredicto que ya ve en el tablero. Apagar no es quitar: la marca sigue en su
// sitio y se puede elegir, igual que una letra gris en Wordle se puede volver a
// teclear.
//
// Pura y sin React, para testearla sin montar nada.

/**
 * @param {Array} guesses  Intentos tal cual los sirve el servidor.
 * @param {Record<string,string>} marcaPais  marca → código de país (catálogo).
 * @returns {{ paisSabido: string|null, descartados: Set<string>, pista: (marca: string) => ("pais"|"descartada"|null) }}
 */
export function deducirPais(guesses, marcaPais = {}) {
  const lista = Array.isArray(guesses) ? guesses : [];
  let paisSabido = null;
  const descartados = new Set();

  for (const g of lista) {
    const st = g?.marca?.status;
    const val = g?.marca?.val;
    // El país del intento: el que manda el servidor en el «mismo país» y, si no
    // viene, el del catálogo. Una marca sin país conocido no deduce nada.
    const pais = g?.marca?.pais || (val ? marcaPais[val] : null) || null;
    if (!pais) continue;
    if (st === "partial" || st === "correct") paisSabido = pais;
    else if (st === "wrong") descartados.add(pais);
  }

  function pista(marca) {
    const p = marcaPais[marca];
    if (!p) return null;
    // Sabido el país, todo lo demás está descartado: es la deducción completa,
    // no solo los países que se han probado.
    if (paisSabido) return p === paisSabido ? "pais" : "descartada";
    return descartados.has(p) ? "descartada" : null;
  }

  return { paisSabido, descartados, pista };
}
