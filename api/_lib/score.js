// api/_lib/score.js
// Puntuación base por intento del reto diario. Función pura extraída de
// validate-guess.js para poder testearla sin montar request ni BD.
//
// RÉPLICA (CLAUDE.md, mismo criterio que zoom.js): la persistencia "oficial"
// de puntos la calcula record_daily_result_v2 en SQL, y la tabla CASE está
// duplicada en scripts/2026-08-retirar-escudo-racha.sql (la versión vigente de
// record_daily_result) y en supabase-monthly-ranking.sql.
// Esta copia JS gobierna el score que se muestra al cliente y el de los
// anónimos (que no persisten). Si cambias la curva aquí, cámbiala en esos
// dos .sql o el ranking divergirá del número que ve el jugador.
//
// El BONUS DE RACHA (2º día +1, 3º +2, 4º en adelante +3) tiene TRES copias de
// la misma regla: record_daily_result en SQL (la oficial, la que persiste),
// bonus_racha_diaria() para la clasificación
// (scripts/2026-10-bonus-racha-en-clasificacion.sql) y `streakBonusFor` de aquí
// abajo. Si cambias la regla en una, cámbiala en las tres.
//
// Curva descendente a propósito: premia adivinar pronto (10 al primer intento,
// 2 al quinto). El intento 6 es vestigial —MAX_ATTEMPTS es 5— pero se conserva
// para que la tabla sea idéntica byte a byte a la del SQL.
export const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

// Puntos base de un intento. Solo puntúa la victoria; un intento fuera de la
// tabla (0, 7, undefined) cae a 0 — nunca undefined/NaN aguas abajo.
export function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

// Bonus de racha de un día GANADO, dada la racha YA actualizada (la que deja
// record_daily_result: 1 = primer acierto, sin bonus). Existe para una sola
// cosa: reconstruir lo que el SQL habría devuelto cuando su respuesta se pierde
// (ver registro-puntos.js). Con derrota no hay bonus, y una racha fuera de
// rango (0, null, NaN) cae a 0 — nunca undefined/NaN aguas abajo.
export function streakBonusFor(streak, won) {
  if (!won || !Number.isFinite(streak)) return 0;
  if (streak >= 4) return 3;
  if (streak === 3) return 2;
  if (streak === 2) return 1;
  return 0;
}
