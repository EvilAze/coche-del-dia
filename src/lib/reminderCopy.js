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

  // El copy genérico viaja SIEMPRE, además del que toque. Desde que el
  // recordatorio se programa como una ventana de días sueltos
  // (src/lib/reminderSchedule.js), el número de la racha solo es cierto para el
  // aviso MÁS CERCANO: ese lo protege la racha que hay ahora mismo. El de
  // pasado mañana solo sería correcto si el jugador juega mañana — y si juega,
  // la app se abre, se reprograma la ventana y el número se refresca. Si no
  // juega, la racha está rota y «no pierdas tu racha de 48 días» es mentira.
  //
  // Así que el resto de la ventana va con el genérico. Un recordatorio que
  // miente enseña a ignorar los recordatorios, y ese daño no se deshace.
  const generico = {
    title: t("notif.reminderTitle"),
    body: t("notif.reminderBody"),
  };

  if (typeof streak === "number" && streak >= STREAK_NUDGE_MIN) {
    return {
      ...canal,
      title: t("notif.streakReminderTitle"),
      body: tn("notif.streakReminderBody", streak, { count: streak }),
      generico,
    };
  }
  return {
    ...canal,
    ...generico,
    generico,
  };
}
