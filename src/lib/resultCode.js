// src/lib/resultCode.js
// Codificación de una partida en un puñado de caracteres, para que quepa en la
// URL que se comparte y el servidor pueda dibujarla en la tarjeta OG.
//
// RÉPLICA DE api/_lib/result-code.js — mantener las dos en sync (misma regla
// que zoom.js, y con el mismo tipo de test: resultCode.sync.test.js compara las
// dos implementaciones sobre una batería de casos). El cliente CODIFICA al
// construir el enlace; el servidor DECODIFICA al pintar la tarjeta. Si divergen,
// el jugador comparte una rejilla y sus amigos ven otra.
//
// EL FORMATO
// Un carácter por intento, dígito 0-7, tres bits:
//     bit 2 (4) → marca acertada
//     bit 1 (2) → modelo acertado
//     bit 0 (1) → año acertado
// Así, "047" = tres intentos: nada, solo el año, y los tres.
//
// Por qué dígitos y no base64 ni JSON: la URL se pega en un chat y se lee de un
// vistazo. Cinco caracteres de 0 a 7 no tienen mayúsculas que se pierdan al
// copiar, ni símbolos que algún cliente escape, ni nada que parezca un token.
//
// BINARIO A PROPÓSITO, igual que hacía la rejilla de texto: el "mismo país"
// (marca partial) cuenta como fallo. La marca ES incorrecta; el matiz con
// bandera vive dentro del juego, no en lo que se comparte.

/** Máximo de intentos que caben en un código. Igual que el juego. */
export const MAX_INTENTOS = 5;

const acierto = (celda) => (celda?.status === "correct" ? 1 : 0);

/**
 * Partida → código compartible.
 * @param {Array} guesses intentos con la forma { marca, modelo, anio }
 * @returns {string} p.ej. "047" (cadena vacía si no hay intentos válidos)
 */
export function encodeResult(guesses) {
  return (Array.isArray(guesses) ? guesses : [])
    .slice(0, MAX_INTENTOS)
    .map((g) => String(acierto(g?.marca) * 4 + acierto(g?.modelo) * 2 + acierto(g?.anio)))
    .join("");
}

/**
 * Código → partida, para dibujarla.
 *
 * Tolerante con la basura A PROPÓSITO: este valor llega de una URL pública que
 * cualquiera puede teclear a mano. Los caracteres que no sean 0-7 se descartan
 * y el resto se recorta a MAX_INTENTOS. Nunca lanza: como mucho devuelve [].
 *
 * @param {string} code
 * @returns {Array<{marca: boolean, modelo: boolean, anio: boolean}>}
 */
export function decodeResult(code) {
  return String(code ?? "")
    .split("")
    .filter((c) => c >= "0" && c <= "7")
    .slice(0, MAX_INTENTOS)
    .map((c) => {
      const n = Number(c);
      return { marca: (n & 4) !== 0, modelo: (n & 2) !== 0, anio: (n & 1) !== 0 };
    });
}
