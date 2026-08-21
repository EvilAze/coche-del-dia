// src/lib/escenarioApartado.js
// La cuenta de «cuánto tiene que apartarse la fotografía para que la hoja de
// selección no la tape».
//
// POR QUÉ EXISTE. En la app el cupón se rellena eligiendo, no tecleando (regla
// 18), y esa hoja se comía la pantalla entera: 86dvh de lista sobre un velo al
// 72%. O sea que en el momento EXACTO de decidir —«¿esta parrilla es de un Alfa
// o de un Lancia?»— el jugador se quedaba sin lo único que hay que mirar. Es el
// mismo agujero que en su día tapó el recorte flotante (PhotoPeek) para el
// teclado de la web, aquí reaparecido por la puerta de al lado.
//
// LA IDEA: la hoja deja de ser una pantalla y pasa a ser una BANDA que sube
// hasta donde empieza la fotografía. El CSS le reserva a la foto su hueco
// (`--pm-hueco-foto` en .pm-hoja) y esta cuenta encaja la foto DENTRO de ese
// hueco moviéndola, no recortándola.
//
// DOS PALANCAS Y EN ESTE ORDEN, que es lo que hace que en un móvil normal la
// foto no encoja ni un píxel:
//   1. SUBIR. Encima de la foto solo hay cromo (la cabecera y el ladillo de la
//      pista), y mientras se elige ese cromo no se usa: se apaga y la foto
//      ocupa su sitio. Son ~100px gratis, que es justo el desajuste típico.
//   2. ENCOGER, y solo con lo que la subida no haya resuelto. Encoger es el
//      último recurso porque cuesta detalle, que es la materia prima del juego.
//
// SEGURIDAD (regla 5): encoger es `scale` sobre el marco entero, o sea LOS
// MISMOS píxeles que ya servía el servidor para este intento, más pequeños. Ni
// uno más. Es exactamente lo que hace el recorte flotante, que replica el marco
// 4:3 por el mismo motivo. El 4:3 tampoco se toca (regla 7): el escalado es
// uniforme.
//
// Aparte del DOM para poder probarla, igual que `calcularEncaje` en
// useEncajeEscenario — son primas hermanas: aquella protege el botón ADIVINAR
// al abrir la partida, esta protege la fotografía al abrir la hoja.

// EL SUELO ES EL DEL RECORTE FLOTANTE, y por eso es un alto en píxeles y no un
// factor de escala: 78px es exactamente lo que mide el `.cdd-peek` que la web
// enseña cuando la fotografía se sale del viewport, o sea el tamaño que este
// proyecto ya da por bueno como «referencia con la que decidir». Por debajo, la
// foto deja de servir para nada y preferimos que asome por debajo de la hoja
// antes que encogerla hasta callarla. Solo se alcanza con el teclado abierto en
// un móvil bajo, que es el caso más apretado que existe.
const ALTO_MINIMO = 78;

// Aire entre el borde de abajo de la foto y el filete de arriba de la hoja. Sin
// él las dos piezas se tocan y se leen como una sola. Se exporta porque lo usan
// los dos consumidores de esta cuenta —el hook que mide en la app y el banco de
// maqueta que la verifica— y un banco que midiera con otro aire estaría dando
// verde a una composición distinta de la que ve el jugador.
export const AIRE_HOJA = 10;

/**
 * @param {object} m
 * @param {number} m.tope    y donde empieza el contenido del pliego (bajo el
 *                           inset del sistema). Es hasta donde puede subir la
 *                           foto: por encima está la barra de estado.
 * @param {number} m.suelo   y del borde superior de la hoja, menos su aire.
 * @param {number} m.fotoTop y natural del marco (sin apartar).
 * @param {number} m.fotoAlto alto natural del marco.
 * @returns {{subida: number, escala: number}} px a subir y factor de escala.
 *          `{0, 1}` = «no hay nada que hacer», que es el caso bueno: la hoja es
 *          corta (el año con la horquilla acotada) y la foto ya cabe entera.
 */
export function calcularApartado({ tope, suelo, fotoTop, fotoAlto }) {
  // Sin medidas creíbles no se toca nada. Mover la foto a ciegas es peor que
  // dejarla donde estaba: el fallo se ve, y se ve en la única pieza que importa.
  if (!(fotoAlto > 0) || !(suelo > tope)) return { subida: 0, escala: 1 };

  const exceso = fotoTop + fotoAlto - suelo;
  if (exceso <= 0) return { subida: 0, escala: 1 };

  // Se sube lo que haga falta, nunca más: si con 20px basta, la foto se mueve
  // 20px y la cabecera ni se entera. El techo es el tope del pliego.
  const subida = Math.min(exceso, Math.max(0, fotoTop - tope));
  const disponible = suelo - (fotoTop - subida);
  // El suelo en píxeles se traduce a escala AQUÍ, con el alto real del marco: el
  // mismo 78px vale 0.31 en un Pixel y 0.42 en un móvil bajo, que es justo lo
  // que se quiere — el límite es lo que se VE, no cuánto encoge.
  const escalaMinima = Math.min(1, ALTO_MINIMO / fotoAlto);
  const escala = Math.min(1, Math.max(disponible / fotoAlto, escalaMinima));

  return {
    subida: Math.round(subida),
    // Tres decimales: más es ruido en una matriz de transformación y menos se
    // nota como un salto al recalcular con el teclado subiendo.
    escala: Math.round(escala * 1000) / 1000,
  };
}
