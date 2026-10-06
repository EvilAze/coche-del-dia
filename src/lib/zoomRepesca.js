// src/lib/zoomRepesca.js
// La escala CSS de la foto de la repesca en cada fase (Repesca.jsx).
//
// /api/repesca/image sirve, mientras se juega, el recorte del ÚLTIMO intento
// (el más abierto), y el cliente cierra el resto con una escala: la del
// intento 1 es la más cerrada. Por eso la escala de partida NO puede ser 1.0:
//
// MIENTRAS CARGA, YA CON LA DEL INTENTO 1. Antes era 1.0 hasta que el servidor
// confirmaba la partida, y entonces saltaba a la del intento 1 con la
// transición de la lente (un segundo largo). Si la foto llegaba a tiempo —y
// llega: el sorteo la deja precargada—, aparecía a mitad de ese zoom-in y
// durante un instante se veía el recorte del último intento, el coche casi
// entero y reconocible, antes del primer intento. Arrancando ya cerrada, al
// confirmarse no hay nada que animar; y si la partida resulta ser de más
// intentos o del Modo Veterano, el cambio es hacia FUERA, que es lo que el
// jugador ya tiene ganado.
export function zoomRepesca({ phase, veterano, intentos, niveles }) {
  const ultimo = niveles[niveles.length - 1];
  if (phase === "loading") return niveles[0];
  if (phase === "playing") {
    if (veterano) return ultimo;
    return niveles[Math.min(intentos, niveles.length - 1)];
  }
  // Partida terminada (o error): la foto entera.
  return 1.0;
}
