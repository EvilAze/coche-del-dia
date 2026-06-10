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
import { getMyStats, getMyWonCarIds, persistAchievementUnlocks } from "./statsService";
import { track } from "./analytics";

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

// Helper compartido entre useGame.js y Repesca.jsx: tras ganar una partida,
// refresca stats (que ya están actualizadas server-side por
// record_daily_result_v2 o por la propia /api/repesca/validate), detecta
// logros nuevos y los pinta como toasts staggered. Máximo 3 individuales —
// si hay más, agrega el resto en uno solo para no spamear.
//
// Vive aquí (y no en hooks/) porque NO usa hooks: recibe toast y t por
// parámetro para poder llamarse fuera de un componente React.
export async function notifyAchievementsAfterWin({ toast, t, locale }) {
  try {
    // Refetch stats: la victoria que acaba de pasar ha actualizado al
    // menos current_streak/max_streak/total_wins/total_points + posibles
    // achievements ya persistidos (si el usuario tenía MyStats abierto en
    // sesiones anteriores). Necesitamos el snapshot fresco.
    const { stats } = await getMyStats();
    if (!stats) return;
    const { newlyUnlocked } = await detectAndPersistNewAchievements({ stats });
    if (newlyUnlocked.length === 0) return;

    const MAX_INDIVIDUAL = 3;
    const head = newlyUnlocked.slice(0, MAX_INDIVIDUAL);
    const rest = newlyUnlocked.length - head.length;

    head.forEach((a, i) => {
      const title =
        a.title?.[locale] || a.title?.es || a.title?.en || "Logro";
      track("achievement_unlocked", {
        id: a.id,
        category: a.category,
        tier: a.currentTier || null,
      });
      // Stagger: 600 ms entre toasts. Da tiempo a leer cada uno sin que
      // pisen al anterior (el Toast por defecto dura ~3-4s).
      setTimeout(() => {
        toast.push(`🏅 ${t("achievements.toastUnlocked")} ${title}`, {
          type: "success",
        });
      }, i * 600);
    });

    if (rest > 0) {
      setTimeout(() => {
        toast.push(
          `🏅 ${t("achievements.toastMore", { count: rest })}`,
          { type: "success" }
        );
      }, head.length * 600);
    }
  } catch (err) {
    // No interferir nunca con el flujo de victoria. Si la notificación
    // falla, el usuario verá los logros la próxima vez que abra MyStats.
    console.warn("[achievementsNotifier] post-win:", err);
  }
}
