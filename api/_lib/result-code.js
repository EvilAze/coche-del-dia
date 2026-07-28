// api/_lib/result-code.js
// RÉPLICA de src/lib/resultCode.js — mantener las dos en sync.
//
// Existen dos copias por la misma razón que zoom.js: el cliente es un bundle de
// Vite y el servidor son funciones de Vercel, y no hay un paquete compartido
// entre ambos. `src/lib/resultCode.sync.test.js` importa las dos y compara su
// comportamiento sobre una batería de casos, así que una divergencia rompe los
// tests en vez de romper una tarjeta en producción.
//
// El servidor solo necesita DECODIFICAR (el cliente construye el enlace), pero
// se mantienen ambas funciones para que la comparación del test sea simétrica y
// para que nadie tenga que reconstruir el formato leyendo la otra copia.
//
// EL FORMATO
// Un carácter por intento, dígito 0-7, tres bits:
//     bit 2 (4) → marca acertada
//     bit 1 (2) → modelo acertado
//     bit 0 (1) → año acertado
// "047" = tres intentos: nada, solo el año, y los tres.

/** Máximo de intentos que caben en un código. Igual que el juego. */
export const MAX_INTENTOS = 5;

const acierto = (celda) => (celda?.status === "correct" ? 1 : 0);

/**
 * Partida → código compartible.
 * @param {Array} guesses intentos con la forma { marca, modelo, anio }
 * @returns {string}
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
