// src/lib/puntos.js
// LA CURVA DE PUNTOS Y EL BONUS DE RACHA, tal y como se le ENSEÑAN al jugador
// (Cómo se juega, Cómo se puntúa).
//
// RÉPLICA de api/_lib/score.js, por el mismo motivo que zoom.js: las funciones
// de Vercel no importan desde src/ y el cliente no debería depender de un
// fichero del servidor. `puntos.sync.test.js` falla si las dos se separan —
// una ayuda que promete 6 puntos donde el servidor da 5 es peor que no tener
// ayuda. Solo los cinco intentos que existen: el sexto de la tabla del
// servidor es vestigial (MAX_ATTEMPTS es 5) y enseñarlo confunde.
export const PUNTOS_POR_INTENTO = [10, 6, 4, 3, 2];

// Racha (días seguidos acertando, contando hoy) → bonus del día.
export const BONUS_RACHA = [
  { dias: 2, bonus: 1 },
  { dias: 3, bonus: 2 },
  { dias: 4, bonus: 3 },
];
