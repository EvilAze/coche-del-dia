// src/lib/achievementsNotifier.js
// Orquestación de detección + persistencia de logros nuevos.
//
// Lo usan dos sitios:
//   1. Achievements.jsx (al abrir MyStats): asegura que el snapshot
//      persistido esté al día con el estado natural del usuario.
//   2. useGame.js / Repesca.jsx (tras ganar una partida): detecta
//      desbloqueos inmediatos y devuelve la lista para que el caller
//      pueda mostrar toasts celebratorios.
//
// Función pura de orquestación: NO conoce React, no toca toasts. El
// caller decide cómo presentar `newlyUnlocked` al usuario.

import { computeAchievements, buildPersistDiff } from "./achievements";
import { loadCatalog } from "../data/catalog";
import { getMyWonCarIds, persistAchievementUnlocks } from "../hooks/useStats";

/**
 * Carga catálogo + wins del usuario, computa logros, detecta diff vs el
 * snapshot persistido, persiste el diff (si lo hay) y devuelve los logros
 * nuevos para que el caller los pinte como notificaciones.
 *
 * @param {object} input
 * @param {object} input.stats Stats actuales del usuario (incluye
 *   achievements_unlocked).
 * @returns {Promise<{items: Array, newlyUnlocked: Array}>}
 *   - items: lista completa de logros computados (para Achievements UI).
 *   - newlyUnlocked: solo los logros que han pasado a desbloqueados o
 *     han subido de tier en esta llamada. Vacío si no hay nada nuevo.
 */
export async function detectAndPersistNewAchievements({ stats }) {
  const [catalog, wonCarIds] = await Promise.all([
    loadCatalog(),
    getMyWonCarIds(),
  ]);
  const persistedUnlocks = stats?.achievements_unlocked || {};

  const items = computeAchievements({
    cars: catalog?.cars || [],
    wonCarIds: wonCarIds || [],
    stats: stats || {},
    persistedUnlocks,
  });

  const diff = buildPersistDiff(items, persistedUnlocks);
  if (Object.keys(diff).length === 0) {
    return { items, newlyUnlocked: [] };
  }

  // Persistimos sincrónicamente: si fallara, mejor saberlo antes de
  // mostrar el toast (evita falso positivo "has desbloqueado X" sin que
  // quede guardado en servidor).
  try {
    await persistAchievementUnlocks(diff);
  } catch (err) {
    console.warn("[achievementsNotifier] persist failed:", err);
    // Aun así devolvemos newlyUnlocked: la próxima sesión re-detectará
    // y reintentará. Mejor mostrar la medalla al usuario aunque el save
    // haya fallado este turno.
  }

  const newlyUnlocked = items.filter((a) => diff[a.id] !== undefined);
  return { items, newlyUnlocked };
}
