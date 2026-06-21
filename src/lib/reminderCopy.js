// src/lib/reminderCopy.js
// Copy del recordatorio diario local según la racha del usuario. Para un
// logueado con racha activa (>= STREAK_NUDGE_MIN) usamos loss-aversion
// ("¡No pierdas tu racha de N días!"); si no, el copy genérico de siempre.
//
// Función PURA: recibe t/tn como argumentos en vez de importar el i18n global,
// así es testeable sin Capacitor ni el módulo i18n. Los usuarios anónimos
// tienen racha 0 en este sistema → siempre caen al copy genérico.

export const STREAK_NUDGE_MIN = 2;

export function reminderCopy(t, tn, streak = 0) {
  if (typeof streak === "number" && streak >= STREAK_NUDGE_MIN) {
    return {
      title: t("notif.streakReminderTitle"),
      body: tn("notif.streakReminderBody", streak, { count: streak }),
    };
  }
  return {
    title: t("notif.reminderTitle"),
    body: t("notif.reminderBody"),
  };
}
