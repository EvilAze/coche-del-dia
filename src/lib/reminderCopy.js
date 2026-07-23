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
  // Nombre y descripción del CANAL de Android. Van fuera del if porque el canal
  // es uno solo: el título del aviso cambia con la racha, pero el interruptor
  // que el usuario ve en los ajustes del móvil es siempre el mismo y no puede
  // llamarse "¡Tu racha está en juego!" unos días y otra cosa otros.
  const canal = {
    channelName: t("notif.channelName"),
    channelDescription: t("notif.channelDescription"),
  };

  if (typeof streak === "number" && streak >= STREAK_NUDGE_MIN) {
    return {
      ...canal,
      title: t("notif.streakReminderTitle"),
      body: tn("notif.streakReminderBody", streak, { count: streak }),
    };
  }
  return {
    ...canal,
    title: t("notif.reminderTitle"),
    body: t("notif.reminderBody"),
  };
}
