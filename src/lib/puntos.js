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

// Bonus de racha de un día GANADO, dada la racha ya actualizada (contando hoy).
// Mismo escalonado que `streakBonusFor` del servidor; el test de sincronía lo
// compara racha a racha.
export function bonusDeRacha(racha) {
  if (!Number.isFinite(racha)) return 0;
  let bonus = 0;
  for (const escalon of BONUS_RACHA) if (racha >= escalon.dias) bonus = escalon.bonus;
  return bonus;
}

// LA PUNTUACIÓN DEL DÍA, RECONSTRUIDA. El servidor solo la manda en la
// respuesta del intento que cierra la partida; quien vuelve más tarde (recarga,
// otra visita, la app que se recarga sola) recibía «Puntos de hoy —» por algo
// que ya había ganado. Con los intentos y la racha de hoy se rehace exacta: es
// la misma cuenta que record_daily_result, sin datos nuevos. Devuelve null si
// la partida no se ganó o el número de intentos no está en la curva.
export function puntuacionDelDia(intentos, racha) {
  const base = PUNTOS_POR_INTENTO[intentos - 1];
  if (!Number.isFinite(base)) return null;
  const bonus = bonusDeRacha(racha);
  return { basePoints: base, streakBonus: bonus, totalPoints: base + bonus };
}
