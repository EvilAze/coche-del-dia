// src/lib/webpush.js
// Recordatorio diario por WEB PUSH (navegador). Gemelo web de notifications.js
// (que es SOLO nativo). Estrategia anti-intrusiva idéntica: el permiso se pide
// tras la primera partida (NotificationOptIn) o desde el toggle del menú.
//
// GATEADO por !isNativePlatform(): en la app Android nativa el push web se
// desactiva (esa ya notifica en local vía notifications.js) → cero doble-aviso.
// Todo falla en SILENCIO (regla 9): sin push, el juego funciona igual.

import { Capacitor } from "@capacitor/core";
import { anonHeaders } from "./anonSession";

const ASKED_KEY = "cd_webpush_asked";       // ¿ya ofrecimos el opt-in?
const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// La clave VAPID pública viaja en base64url; pushManager.subscribe la quiere
// como Uint8Array. Conversión estándar (padding + url-safe → binario).
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ¿Podemos hacer push web aquí? No en nativo, no sin las APIs, no sin clave.
export function isPushSupported() {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC)
  );
}

// iOS Safari solo permite push si la web está INSTALADA como PWA (standalone).
// Detectamos iOS + no-standalone para mostrar el hint "añadir a inicio".
export function isIosNotInstalled() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  return isIos && !standalone;
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
    /* storage no disponible: peor caso, volvemos a ofrecerlo otro día */
  }
}

// Registra el service worker (idempotente: si ya está, el navegador lo reusa).
async function getRegistration() {
  return navigator.serviceWorker.register("/sw.js");
}

// ¿Está el navegador suscrito ahora mismo? Para pintar el toggle on/off.
export async function isSubscribed() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

// Pide permiso, suscribe con VAPID y manda la suscripción al servidor.
// Devuelve true si quedó suscrito, false en cualquier otro caso (silencioso).
export async function subscribe(locale = "es") {
  if (!isPushSupported()) return false;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await getRegistration();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // exigido por Chrome: todo push debe ser visible
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });

    // Endpoint único /api/push (Edge) con routing por `action`.
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), locale }),
    });
    return res.ok;
  } catch {
    // Permiso denegado, SW no soportado, red caída… nunca rompemos la UX.
    return false;
  }
}

// Cancela la suscripción local y avisa al servidor para borrar la fila.
export async function unsubscribe() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({ action: "unsubscribe", endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}

// "Ya jugué hoy": si este navegador está suscrito, avisa al servidor para que
// marque su suscripción como cubierta hoy y el envío de las 16:00 la salte. Lo
// llama el juego diario al terminar (useGame). No-op si no hay suscripción, y
// falla en silencio: es una optimización anti-molestia, nunca crítica.
export async function markSeenToday() {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({ action: "seen_today", endpoint: sub.endpoint }),
    });
  } catch {
    /* sin suscripción o red caída: la marca es best-effort */
  }
}
