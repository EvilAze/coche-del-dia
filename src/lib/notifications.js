// src/lib/notifications.js
// Recordatorio diario local del coche del día (Capacitor LocalNotifications).
// Solo nativo: en web todo es no-op. El plugin se importa de forma perezosa
// para no arrastrarlo en el bundle web. Estrategia anti-intrusiva: el permiso
// se pide tras la primera partida (NotificationOptIn), y en cada arranque
// re-armamos la notificación SI el permiso del SO ya está concedido (así,
// activar/desactivar desde los ajustes de Android "manda").

import { Capacitor } from "@capacitor/core";

export const REMINDER_ID = 1;     // id fijo → reprogramar reemplaza, no duplica
export const REMINDER_HOUR = 10;  // 10:00 hora local del dispositivo
export const REMINDER_MINUTE = 0;
const ASKED_KEY = "cd_notif_asked";

export function isNative() {
  return Capacitor.isNativePlatform();
}

export function hasAskedOptIn() {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAskedOptIn() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* storage no disponible: peor caso, volvemos a preguntar otro día */
  }
}

// Import perezoso del plugin (solo se ejecuta en nativo).
async function plugin() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return LocalNotifications;
}

export async function isPermissionGranted() {
  if (!isNative()) return false;
  const LN = await plugin();
  const res = await LN.checkPermissions();
  return res.display === "granted";
}

export async function ensurePermission() {
  if (!isNative()) return false;
  const LN = await plugin();
  const check = await LN.checkPermissions();
  if (check.display === "granted") return true;
  const req = await LN.requestPermissions();
  return req.display === "granted";
}

export async function scheduleDailyReminder({ title, body }) {
  if (!isNative()) return;
  const LN = await plugin();
  // Cancelar el anterior (mismo id) antes de reprogramar evita acumulación.
  await LN.cancel({ notifications: [{ id: REMINDER_ID }] });
  await LN.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title,
        body,
        // `on` = repetición diaria al casar hora:minuto del dispositivo.
        schedule: {
          on: { hour: REMINDER_HOUR, minute: REMINDER_MINUTE },
          allowWhileIdle: true,
        },
      },
    ],
  });
}

export async function cancelDailyReminder() {
  if (!isNative()) return;
  const LN = await plugin();
  await LN.cancel({ notifications: [{ id: REMINDER_ID }] });
}

// Re-arma en cada arranque SI el permiso ya está concedido. Si el usuario lo
// revocó en los ajustes de Android, no reprogramamos (el SO "manda").
export async function rearmIfEnabled({ title, body }) {
  if (!isNative()) return;
  if (await isPermissionGranted()) {
    await scheduleDailyReminder({ title, body });
  }
}
