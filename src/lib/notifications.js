// src/lib/notifications.js
// Recordatorio diario local del coche del día (Capacitor LocalNotifications).
// Solo nativo: en web todo es no-op. El plugin se importa de forma perezosa
// para no arrastrarlo en el bundle web. Estrategia anti-intrusiva: el permiso
// se pide tras la primera partida (NotificationOptIn), y en cada arranque
// re-armamos la notificación SI el permiso del SO ya está concedido (así,
// activar/desactivar desde los ajustes de Android "manda").

import { Capacitor } from "@capacitor/core";

export const REMINDER_ID = 1;     // id fijo → reprogramar reemplaza, no duplica
// 20:00 hora local del DISPOSITIVO (no de Madrid: `schedule.on` casa contra el
// reloj del móvil, y un jugador de vacaciones prefiere que el aviso siga a su
// día, no al del servidor). Se movió desde las 10:00 porque a media mañana el
// aviso compite con el trabajo y se descarta sin abrirlo; por la tarde-noche
// pilla al que aún no ha jugado y todavía le sobran cuatro horas de margen
// antes de que la edición cierre a medianoche en Madrid.
export const REMINDER_HOUR = 20;
const REMINDER_MINUTE = 0;
const ASKED_KEY = "cd_notif_asked";

// Canal propio del recordatorio (Android 8+). Sin esto el plugin manda todo por
// su canal "default", que se llama literalmente "Default" y no es configurable
// (está a fuego en LocalNotificationManager#createNotificationChannel). En los
// ajustes de notificaciones del móvil el usuario veía "Default" y tenía que
// adivinar que ese interruptor era el del coche del día.
export const REMINDER_CHANNEL_ID = "recordatorio-diario";
// El canal "default" lo crea el plugin al cargarse, pase lo que pase, así que
// no se puede evitar que exista; sí se puede borrar DESPUÉS de crear el nuestro
// para que no quede un interruptor huérfano y mudo en la lista.
const CANAL_HUERFANO = "default";

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

// Carga perezosa del plugin. Devolvemos la PROMESA del import (el módulo), NUNCA
// el proxy del plugin: devolver o await-ear un proxy de Capacitor accede a su
// `.then`, y eso lo interpreta como una llamada nativa → peta con
// "LocalNotifications.then() is not implemented on android".
function loadLN() {
  return import("@capacitor/local-notifications");
}

async function isPermissionGranted() {
  if (!isNative()) return false;
  const { LocalNotifications: LN } = await loadLN();
  const res = await LN.checkPermissions();
  return res.display === "granted";
}

export async function ensurePermission() {
  if (!isNative()) return false;
  const { LocalNotifications: LN } = await loadLN();
  const check = await LN.checkPermissions();
  if (check.display === "granted") return true;
  const req = await LN.requestPermissions();
  return req.display === "granted";
}

// Crea (o actualiza) el canal del recordatorio. Idempotente: Android reusa el
// canal si el id ya existe. OJO: solo se pueden cambiar nombre y descripción de
// un canal ya creado; la importancia la fija el usuario a partir de ahí y la app
// no la puede tocar — por eso el canal nace con importancia 3 (la de siempre) y
// no lo cambiamos en caliente.
//
// Devuelve true SOLO si el canal existe de verdad. Quien llama tiene que
// respetarlo: en Android 8+ mandar una notificación con un `channelId` que no
// existe hace que el sistema la DESCARTE sin avisar, así que un canal a medias
// sería peor que no tener canal. Sin `name` ni siquiera lo intentamos: Android
// exige nombre y fallaría igual.
async function ensureChannel({ name, description }) {
  if (!name) return false;
  const { LocalNotifications: LN } = await loadLN();
  try {
    await LN.createChannel({
      id: REMINDER_CHANNEL_ID,
      name,
      description,
      // LOW (2), no DEFAULT (3): sale en la barra y en la persiana, pero NO
      // suena ni interrumpe con un heads-up. Es un juego casual de dos minutos
      // y el opt-in promete literalmente "sin spam": un pitido a las 20:00 para
      // recordarte un pasatiempo es justo la clase de fricción que hace que la
      // gente desactive las notificaciones del todo, y entonces se pierde el
      // recordatorio entero, no solo el sonido.
      //
      // OJO, esto solo afecta a INSTALACIONES NUEVAS: Android congela la
      // importancia en cuanto el canal existe y a partir de ahí solo la puede
      // cambiar el usuario desde los ajustes. Quien ya tenga el canal creado
      // se queda con la que tuviera. Bajarlo a la fuerza exigiría crear un
      // canal con id nuevo, y eso además borraría cualquier ajuste que el
      // usuario hubiera hecho — no compensa.
      importance: 2,
      visibility: 1, // PUBLIC: el recordatorio no dice nada sensible
    });
  } catch {
    /* Android < 8 no tiene canales, o el plugin no expone la API: seguimos
       igual, la notificación se manda por el canal por defecto del plugin. */
    return false;
  }
  try {
    // Best-effort: quitar el canal "Default" que planta el plugin. Va DESPUÉS
    // del createChannel a propósito — para entonces el plugin ya se ha cargado
    // y ya lo ha creado, así que aquí sí existe algo que borrar. En su propio
    // try: que no se pueda borrar el huérfano no invalida el canal bueno.
    await LN.deleteChannel({ id: CANAL_HUERFANO });
  } catch {
    /* se queda el interruptor huérfano en los ajustes: feo, no roto */
  }
  return true;
}

export async function scheduleDailyReminder({ title, body, channelName, channelDescription }) {
  if (!isNative()) return;
  const { LocalNotifications: LN } = await loadLN();
  const conCanal = await ensureChannel({
    name: channelName,
    description: channelDescription,
  });
  // Cancelar el anterior (mismo id) antes de reprogramar evita acumulación.
  await LN.cancel({ notifications: [{ id: REMINDER_ID }] });
  await LN.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title,
        body,
        // Solo si el canal existe (ver ensureChannel). Omitirlo hace que el
        // plugin use su canal por defecto, que siempre está creado: peor
        // nombre, pero la notificación LLEGA.
        ...(conCanal ? { channelId: REMINDER_CHANNEL_ID } : {}),
        // `on` = repetición diaria al casar hora:minuto del dispositivo.
        schedule: {
          on: { hour: REMINDER_HOUR, minute: REMINDER_MINUTE },
          allowWhileIdle: true,
        },
      },
    ],
  });
}

// (Había también un `cancelDailyReminder()` público. Nadie lo llamaba: apagar
// el recordatorio se hace desde los ajustes de notificaciones de Android, y
// rearmIfEnabled ya respeta esa decisión al no reprogramar sin permiso. El
// cancel que sí hace falta —el de "no acumules duplicados"— lo hace
// scheduleDailyReminder justo antes de programar.)

// Re-arma en cada arranque SI el permiso ya está concedido. Si el usuario lo
// revocó en los ajustes de Android, no reprogramamos (el SO "manda").
export async function rearmIfEnabled({ title, body, channelName, channelDescription }) {
  if (!isNative()) return;
  if (await isPermissionGranted()) {
    await scheduleDailyReminder({ title, body, channelName, channelDescription });
  }
}
