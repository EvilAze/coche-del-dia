# Web Push Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a los usuarios web (incluidos anónimos) un recordatorio diario opt-in por Web Push que a las ~16:00 de España les invite a volver al juego.

**Architecture:** Un service worker recibe el push y muestra la notificación. El cliente se suscribe (tras la 1ª partida o desde el menú) y manda la suscripción a `/api/push/subscribe`, que la guarda en la tabla `push_subscriptions` (admin-only, RLS deny-all). Un workflow cron de GitHub Actions hace `POST` a las 15:00 UTC a `/api/cron/send-push` (protegido con `CRON_SECRET`), que envía a todas las suscripciones con VAPID. Todo el código de push va gateado por `!Capacitor.isNativePlatform()` para no chocar con las notificaciones locales de la app Android.

**Tech Stack:** React 18 (JSX), Vite, Vercel Functions (Node), Supabase (Postgres + RLS), `web-push` (VAPID), Web Push API + Service Worker, GitHub Actions, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-web-push-reminder-design.md`

---

## Notas de entorno (léelas antes de empezar)

1. **`vitest`, no `npm run build`.** En el worktree `@capacitor/core` y `web-push` NO están instalados; `npm run build` falla (limitación conocida). La red de seguridad local es `npx vitest run`. El build real lo hace Vercel Preview.
2. **Tests que tocan `@capacitor/core`** deben usar el patrón `vi.doMock("@capacitor/core", …)` + `import()` dinámico del módulo bajo prueba (igual que `src/lib/notifications.test.js`). NUNCA importes el módulo de forma estática arriba del test si importa capacitor.
3. **La lógica pura testeable vive en `api/_lib/push.js`** (sin importar `web-push` ni supabase). El handler `api/cron/send-push.js` sí importa `web-push`, así que **ningún test lo importa** (se verifica en Preview + disparo manual).
4. **Comentarios en español explicando el porqué** (convención del repo). UTF-8 correcto.
5. **Commits frecuentes**, uno por tarea. Rama: `claude/web-push-reminder` (ya creada desde `origin/main`).

---

## Estructura de ficheros

**Nuevos:**
- `scripts/2026-07-web-push-subscriptions.sql` — tabla + RLS.
- `src/lib/webpush.js` (+ `src/lib/webpush.test.js`) — módulo cliente de suscripción.
- `public/sw.js` — service worker (push + click).
- `src/components/PushToggle.jsx` — interruptor de avisos para el menú.
- `api/push/subscribe.js` — alta de suscripción.
- `api/push/unsubscribe.js` — baja.
- `api/_lib/push.js` (+ `api/_lib/push.test.js`) — lógica pura (payload, copy, clasificación de errores, fecha Madrid).
- `api/cron/send-push.js` — handler de envío.
- `.github/workflows/daily-push.yml` — disparador cron.

**Modificados:**
- `package.json` — dep `web-push`.
- `src/index.jsx` — registro del service worker.
- `src/components/NotificationOptIn.jsx` — rama web (botón push / hint iOS).
- `src/components/HeaderSandwich.jsx` — montar `PushToggle` en el menú.
- `src/i18n/locales/es.json` y `en.json` — copys.

---

## Task 0: Dependencia `web-push` y variables de entorno

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Añadir la dependencia `web-push` a `package.json`**

En el bloque `"dependencies"`, añade (orden alfabético) la línea:

```json
    "web-push": "^3.6.7",
```

- [ ] **Step 2: Documentar las envs necesarias (no se commitean valores)**

Estas envs hay que crearlas en Vercel (Production + Preview) y en GitHub Secrets. NO van a git. Genera las claves VAPID una vez en local con:

```bash
npx web-push generate-vapid-keys
```

Envs resultantes:
- Vercel (server): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (p.ej. `mailto:hola@cochedeldia.com`).
- Vercel (build, cliente): `VITE_VAPID_PUBLIC_KEY` = mismo valor que `VAPID_PUBLIC_KEY` (es pública).
- Ya existentes y reutilizadas: `CRON_SECRET` (protege el endpoint) y `REPESCA_TOKEN_SECRET` (verifica el header anónimo).
- GitHub Secret: `CRON_SECRET` (mismo valor que en Vercel), para el workflow.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(deps): añade web-push para el recordatorio web push"
```

---

## Task 1: Migración SQL — tabla `push_subscriptions` (admin-only, RLS deny-all)

**Files:**
- Create: `scripts/2026-07-web-push-subscriptions.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- scripts/2026-07-web-push-subscriptions.sql
-- Suscripciones de Web Push (recordatorio diario web). ADMIN-ONLY: el cliente
-- NUNCA toca esta tabla directamente (todo pasa por /api/push/*), así que RLS
-- queda en deny-all para anon/authenticated. Sin GRANT SELECT (regla 3 de
-- CLAUDE.md): no hay lecturas de cliente, luego no hay grants que mantener.
-- La clave natural es `endpoint` (URL de push del navegador): re-suscribir el
-- mismo navegador hace UPSERT, no fila nueva.

create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  endpoint         text not null unique,
  p256dh           text not null,          -- subscription.keys.p256dh
  auth             text not null,          -- subscription.keys.auth
  user_id          uuid references auth.users(id) on delete cascade, -- si logueado
  anon_id          text,                   -- id de anon-session (best-effort)
  locale           text not null default 'es',
  created_at       timestamptz not null default now(),
  last_notified_at date,                   -- idempotencia por día
  failure_count    int not null default 0
);

-- Índice para el barrido del cron: "no avisadas hoy".
create index if not exists push_subscriptions_last_notified_idx
  on public.push_subscriptions (last_notified_at);

-- RLS ON, sin políticas => deny-all para anon/authenticated. El service role
-- (getSupabaseAdmin) salta RLS y es el único que la lee/escribe.
alter table public.push_subscriptions enable row level security;

-- Blindaje explícito: revoca cualquier grant heredado a los roles públicos.
revoke all on public.push_subscriptions from anon, authenticated;
```

- [ ] **Step 2: Verificación (manual, en Supabase)**

Este SQL lo aplica el usuario en el SQL editor de Supabase (no hay migraciones automáticas). Verificación esperada: la tabla existe, RLS está `enabled`, y no hay políticas. No hay test automático de creación; la cobertura de seguridad la dan `test:rls`/`test:attacks` (Task 12).

- [ ] **Step 3: Commit**

```bash
git add scripts/2026-07-web-push-subscriptions.sql
git commit -m "feat(db): tabla push_subscriptions (admin-only, RLS deny-all)"
```

---

## Task 2: Lógica pura de servidor `api/_lib/push.js` (TDD)

**Files:**
- Create: `api/_lib/push.js`
- Test: `api/_lib/push.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// api/_lib/push.test.js
import { describe, it, expect } from "vitest";
import {
  getPushCopy,
  buildPushPayload,
  classifySendError,
  madridDateStr,
} from "./push.js";

describe("getPushCopy", () => {
  it("devuelve copy en español", () => {
    const c = getPushCopy("es");
    expect(c.title).toMatch(/coche/i);
    expect(typeof c.body).toBe("string");
  });
  it("devuelve copy en inglés", () => {
    expect(getPushCopy("en").body).toMatch(/car|guess/i);
  });
  it("cae a español si el locale es desconocido", () => {
    expect(getPushCopy("xx")).toEqual(getPushCopy("es"));
  });
});

describe("buildPushPayload", () => {
  it("serializa title/body/url a JSON", () => {
    const p = JSON.parse(buildPushPayload({ title: "T", body: "B", url: "/" }));
    expect(p).toEqual({ title: "T", body: "B", url: "/" });
  });
});

describe("classifySendError", () => {
  it("404 y 410 son suscripciones expiradas", () => {
    expect(classifySendError({ statusCode: 404 })).toBe("expired");
    expect(classifySendError({ statusCode: 410 })).toBe("expired");
  });
  it("otros códigos son reintentables", () => {
    expect(classifySendError({ statusCode: 500 })).toBe("retry");
    expect(classifySendError({})).toBe("retry");
  });
});

describe("madridDateStr", () => {
  it("formatea YYYY-MM-DD en zona Madrid", () => {
    // 2026-07-02 00:30 UTC = 02:30 en Madrid (CEST) => sigue siendo día 2.
    const d = new Date("2026-07-02T00:30:00Z");
    expect(madridDateStr(d)).toBe("2026-07-02");
  });
  it("una hora antes de medianoche UTC ya es el día siguiente en Madrid", () => {
    // 2026-07-01 23:30 UTC = 01:30 del día 2 en Madrid (CEST).
    const d = new Date("2026-07-01T23:30:00Z");
    expect(madridDateStr(d)).toBe("2026-07-02");
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run api/_lib/push.test.js`
Expected: FAIL — `Failed to resolve import "./push.js"` (el módulo aún no existe).

- [ ] **Step 3: Implementar `api/_lib/push.js`**

```js
// api/_lib/push.js
// Lógica PURA del recordatorio push, extraída del handler para poder testearla
// sin `web-push` (no instalado en el worktree) ni Supabase. El handler
// (api/cron/send-push.js) orquesta; aquí vive lo determinista.

// Copy del mensaje POR IDIOMA. Server-side no usa el i18n de cliente (useT),
// así que mantenemos aquí un mini-diccionario. GENÉRICO a propósito: NUNCA
// revela marca/modelo/año ni pista del coche (regla 5 de CLAUDE.md).
const PUSH_COPY = {
  es: { title: "El Coche del Día", body: "Ya puedes jugar al coche de hoy 🚗" },
  en: { title: "Car of the Day", body: "Today's car is ready — can you guess it? 🚗" },
};

// Devuelve el copy del locale; cae a español si no existe.
export function getPushCopy(locale) {
  return PUSH_COPY[locale] || PUSH_COPY.es;
}

// Payload que viaja en el push y que lee el service worker (event.data.json()).
export function buildPushPayload({ title, body, url }) {
  return JSON.stringify({ title, body, url });
}

// El navegador/servicio de push devuelve 404/410 cuando la suscripción ya no
// existe (usuario revocó permiso, desinstaló, etc.): esas se BORRAN. El resto
// (5xx, red) son reintentables → contamos fallo, no borramos aún.
export function classifySendError(err) {
  const code = err && err.statusCode;
  return code === 404 || code === 410 ? "expired" : "retry";
}

// Fecha 'YYYY-MM-DD' en horario de Madrid. El envío y la idempotencia por día
// se miden en la zona del juego (el coche cambia a medianoche de Madrid).
export function madridDateStr(date = new Date()) {
  // en-CA da directamente el formato YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run api/_lib/push.test.js`
Expected: PASS (todos los `describe`).

- [ ] **Step 5: Commit**

```bash
git add api/_lib/push.js api/_lib/push.test.js
git commit -m "feat(push): lógica pura del recordatorio (payload, copy, errores, fecha)"
```

---

## Task 3: Módulo cliente `src/lib/webpush.js` (TDD)

**Files:**
- Create: `src/lib/webpush.js`
- Test: `src/lib/webpush.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// src/lib/webpush.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Igual que notifications.test.js: capacitor NO está instalado en el worktree,
// así que lo mockeamos por test y cargamos el módulo con import() dinámico.
describe("webpush", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@capacitor/core");
  });

  it("urlBase64ToUint8Array convierte la clave VAPID", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { urlBase64ToUint8Array } = await import("./webpush.js");
    const out = urlBase64ToUint8Array("BExampleKey_-");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it("isPushSupported es false en nativo (la app usa notif locales)", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { isPushSupported } = await import("./webpush.js");
    expect(isPushSupported()).toBe(false);
  });

  it("isPushSupported es false en web sin PushManager", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { isPushSupported } = await import("./webpush.js");
    // jsdom no trae PushManager ni serviceWorker → debe dar false sin lanzar.
    expect(isPushSupported()).toBe(false);
  });

  it("subscribe no lanza y devuelve false si no hay soporte", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { subscribe } = await import("./webpush.js");
    await expect(subscribe("es")).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run src/lib/webpush.test.js`
Expected: FAIL — `Failed to resolve import "./webpush.js"`.

- [ ] **Step 3: Implementar `src/lib/webpush.js`**

```js
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

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({ subscription: sub.toJSON(), locale }),
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
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...anonHeaders() },
      body: JSON.stringify({ endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run src/lib/webpush.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webpush.js src/lib/webpush.test.js
git commit -m "feat(push): módulo cliente de suscripción web push (gateado en nativo)"
```

---

## Task 4: Service worker `public/sw.js`

**Files:**
- Create: `public/sw.js`

*(No hay test unitario: el SW corre en un contexto distinto. Se verifica en Preview.)*

- [ ] **Step 1: Escribir el service worker**

```js
// public/sw.js
// Service worker MÍNIMO: solo push (sin caché offline, fuera de alcance v1).
// Vite sirve public/ en la raíz → disponible en /sw.js con scope "/".

// Al recibir un push, mostramos la notificación. El payload lo manda el server
// como JSON {title, body, url}. Fallback defensivo si llega vacío/no-JSON.
self.addEventListener("push", (event) => {
  let data = { title: "El Coche del Día", body: "Ya puedes jugar al coche de hoy 🚗", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* payload no-JSON: usamos el fallback */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/web-app-manifest-192x192.png",
      badge: "/web-app-manifest-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Al pulsar la notificación: si ya hay una pestaña del juego, la enfocamos;
// si no, abrimos una nueva en la URL indicada.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Verificación**

No hay test automático. Nota de verificación en Preview (Task 13): activar avisos, disparar el envío manual y comprobar que la notificación aparece y al pulsarla abre el juego.

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(push): service worker de push (mostrar notif + abrir juego)"
```

---

## Task 5: Registro del service worker en `src/index.jsx`

**Files:**
- Modify: `src/index.jsx`

- [ ] **Step 1: Localizar dónde arranca la app**

Run: `grep -n "createRoot\|render\|import" src/index.jsx | head -20`
Expected: ver los imports y el `createRoot(...).render(...)`.

- [ ] **Step 2: Añadir el registro del SW al final del fichero**

Añade al FINAL de `src/index.jsx` (fuera del render, sin bloquear el primer paint):

```jsx
// Registro del service worker para Web Push. Diferido a 'load' para no competir
// con el primer render. Falla en silencio: si el navegador no lo soporta o
// estamos en la app nativa (que usa notif locales), simplemente no pasa nada.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW no disponible: el juego funciona igual, solo sin push web */
    });
  });
}
```

- [ ] **Step 3: Verificar que la suite sigue verde**

Run: `npx vitest run`
Expected: PASS (sin regresiones; este cambio no tiene test propio).

- [ ] **Step 4: Commit**

```bash
git add src/index.jsx
git commit -m "feat(push): registra el service worker en el arranque (diferido a load)"
```

---

## Task 6: Copys i18n (es / en)

**Files:**
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Añadir claves al bloque `notif` de `es.json`**

Dentro del objeto `"notif": { … }` (ya existe, sobre la línea 170), añade estas claves (cuida las comas):

```json
    "webOptInBody": "Te aviso a las 16:00 cuando toque jugar. Sin spam, un aviso al día.",
    "webOptInAccept": "Sí, avísame",
    "webOptInDecline": "Ahora no",
    "iosHintTitle": "¿Quieres el aviso diario?",
    "iosHintBody": "En iPhone, añade la web a tu pantalla de inicio (Compartir → Añadir a inicio) y podrás activar el recordatorio.",
    "menuPushOn": "Avisos diarios: activados",
    "menuPushOff": "Activar avisos diarios"
```

- [ ] **Step 2: Añadir las mismas claves a `en.json`**

Dentro de su bloque `"notif"`:

```json
    "webOptInBody": "I'll remind you at 4pm when it's time to play. One reminder a day, no spam.",
    "webOptInAccept": "Yes, remind me",
    "webOptInDecline": "Not now",
    "iosHintTitle": "Want the daily reminder?",
    "iosHintBody": "On iPhone, add the site to your home screen (Share → Add to Home Screen) to enable the reminder.",
    "menuPushOn": "Daily reminders: on",
    "menuPushOff": "Turn on daily reminders"
```

- [ ] **Step 3: Verificar que el JSON es válido**

Run: `node -e "require('./src/i18n/locales/es.json'); require('./src/i18n/locales/en.json'); console.log('JSON OK')"`
Expected: `JSON OK` (si falla, hay una coma mal puesta).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "i18n(push): copys de opt-in web, hint iOS y toggle de menú"
```

---

## Task 7: Opt-in web en `NotificationOptIn.jsx`

**Files:**
- Modify: `src/components/NotificationOptIn.jsx`

**Contexto:** hoy el componente solo se muestra en NATIVO (`isNative() && !hasAskedOptIn()`) y en web devuelve `null`. Añadimos una rama WEB: si hay soporte de push web y no se ha preguntado, ofrecer activar; si es iOS-no-instalado, mostrar el hint. La rama nativa se conserva intacta.

- [ ] **Step 1: Reescribir el componente conservando la rama nativa**

Reemplaza el contenido completo de `src/components/NotificationOptIn.jsx` por:

```jsx
// src/components/NotificationOptIn.jsx
// Prompt suave tras terminar una partida (pico de engagement) para ofrecer el
// recordatorio diario. Dos mundos:
//   · NATIVO (app Android): notificaciones locales (lib/notifications.js).
//   · WEB (navegador): Web Push (lib/webpush.js). Incluye anónimos.
// En iOS-no-instalado el push no existe → mostramos un hint para "añadir a
// inicio". La decisión se persiste para no volver a preguntar.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import {
  isNative,
  hasAskedOptIn as hasAskedNative,
  markAskedOptIn as markAskedNative,
  ensurePermission,
  scheduleDailyReminder,
} from "../lib/notifications";
import {
  isPushSupported,
  isIosNotInstalled,
  hasAskedOptIn as hasAskedWeb,
  markAskedOptIn as markAskedWeb,
  subscribe as webSubscribe,
} from "../lib/webpush";
import { getLocale } from "../i18n";

// Decide qué variante mostrar en el primer render (síncrono, sin parpadeo):
//   "native" | "web" | "ios-hint" | null
function initialMode() {
  if (isNative()) return hasAskedNative() ? null : "native";
  if (isPushSupported()) return hasAskedWeb() ? null : "web";
  if (isIosNotInstalled()) return hasAskedWeb() ? null : "ios-hint";
  return null;
}

export default function NotificationOptIn() {
  const { t } = useT();
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    // Coherencia ante carreras de StrictMode.
    if (isNative() && hasAskedNative()) setMode(null);
  }, []);

  if (!mode) return null;

  // --- NATIVO (comportamiento original) ---
  async function acceptNative() {
    haptic.impactLight();
    markAskedNative();
    setMode(null);
    const granted = await ensurePermission();
    if (granted) {
      await scheduleDailyReminder({
        title: t("notif.reminderTitle"),
        body: t("notif.reminderBody"),
      });
    }
  }

  // --- WEB ---
  async function acceptWeb() {
    haptic.impactLight();
    markAskedWeb();
    setMode(null);
    await webSubscribe(getLocale());
  }

  function decline() {
    haptic.impactLight();
    if (isNative()) markAskedNative();
    else markAskedWeb();
    setMode(null);
  }

  function dismissHint() {
    haptic.impactLight();
    markAskedWeb();
    setMode(null);
  }

  // iOS no instalado: solo informamos (no hay botón que funcione).
  if (mode === "ios-hint") {
    return (
      <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
        <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
          {t("notif.iosHintTitle")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/90">
          {t("notif.iosHintBody")}
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={dismissHint}
            className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
          >
            {t("notif.webOptInDecline")}
          </button>
        </div>
      </div>
    );
  }

  const isWeb = mode === "web";
  const accept = isWeb ? acceptWeb : acceptNative;

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
      <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
        {t("notif.optInTitle")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-white/90">
        {isWeb ? t("notif.webOptInBody") : t("notif.optInBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={accept}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary transition hover:brightness-110 active:scale-[0.98]"
        >
          {isWeb ? t("notif.webOptInAccept") : t("notif.optInAccept")}
        </button>
        <button
          type="button"
          onClick={decline}
          className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
        >
          {isWeb ? t("notif.webOptInDecline") : t("notif.optInDecline")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que la suite sigue verde**

Run: `npx vitest run`
Expected: PASS. (jsdom: `isPushSupported()` da false y `isNative()` da false → `initialMode()` devuelve null o "ios-hint" según UA; el componente no rompe el render de nada que ya se testee.)

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationOptIn.jsx
git commit -m "feat(push): opt-in web y hint iOS en NotificationOptIn"
```

---

## Task 8: Toggle de avisos en el menú (`PushToggle.jsx` + `HeaderSandwich.jsx`)

**Files:**
- Create: `src/components/PushToggle.jsx`
- Modify: `src/components/HeaderSandwich.jsx`

- [ ] **Step 1: Crear `PushToggle.jsx`**

```jsx
// src/components/PushToggle.jsx
// Interruptor de "avisos diarios" para el menú. Segunda oportunidad al opt-in:
// quien dijo "ahora no" (o quiere apagarlo) lo gestiona aquí. Solo se pinta si
// el navegador soporta push web (en nativo e iOS-no-instalado no aparece).

import { useEffect, useState } from "react";
import { useT, getLocale } from "../i18n";
import { haptic } from "../lib/haptics";
import { isPushSupported, isSubscribed, subscribe, unsubscribe } from "../lib/webpush";

export default function PushToggle() {
  const { t } = useT();
  const supported = isPushSupported();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    isSubscribed().then(setOn);
  }, [supported]);

  if (!supported) return null;

  async function toggle() {
    if (busy) return;
    haptic.impactLight();
    setBusy(true);
    try {
      if (on) {
        await unsubscribe();
        setOn(false);
      } else {
        const ok = await subscribe(getLocale());
        setOn(ok);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-white/90 transition hover:bg-white/5 active:scale-[0.99] disabled:opacity-50"
    >
      <span>{on ? t("notif.menuPushOn") : t("notif.menuPushOff")}</span>
      <span
        className={
          "ml-3 h-2.5 w-2.5 shrink-0 rounded-full " +
          (on ? "bg-accent shadow-[0_0_8px_#7af0c8]" : "bg-muted-foreground/30")
        }
        aria-hidden="true"
      />
    </button>
  );
}
```

- [ ] **Step 2: Montar `PushToggle` en el menú de `HeaderSandwich.jsx`**

Añade el import junto a los demás imports del fichero (arriba):

```jsx
import PushToggle from "./PushToggle";
```

Localiza el bloque de botones del menú (el tercer `<button>` es "ranking", termina sobre la línea 232). JUSTO DESPUÉS del cierre `</button>` de ese último botón del menú, añade:

```jsx
          <PushToggle />
```

Run para confirmar la posición exacta antes de editar:
`grep -n "onOpenRanking\|</button>\|PushToggle" src/components/HeaderSandwich.jsx`

- [ ] **Step 3: Verificar que la suite sigue verde**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/PushToggle.jsx src/components/HeaderSandwich.jsx
git commit -m "feat(push): toggle de avisos diarios en el menú"
```

---

## Task 9: Endpoint de alta `api/push/subscribe.js`

**Files:**
- Create: `api/push/subscribe.js`

*(Sin test unitario en worktree: importa supabase admin. Se verifica en Preview + Task 12.)*

- [ ] **Step 1: Escribir el endpoint**

```js
// api/push/subscribe.js
// Alta/actualización de una suscripción Web Push. ADMIN-ONLY: escribimos con el
// service role (la tabla es deny-all para anon/authenticated). Identidad:
//   · endpoint = clave natural (upsert, un navegador = una fila).
//   · user_id  = si viene JWT de Supabase válido (best-effort).
//   · anon_id  = del header x-anon-session verificado (best-effort).
// Node runtime: web-push/crypto y supabase admin no van en Edge.

import { applyCors, methodGuard, parseBody } from "../_lib/http.js";
import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "../_lib/supabase.js";
import { readAnonToken } from "../_lib/anon-session.js";
import { checkRateLimit } from "../_lib/ratelimit.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;              // responde preflight OPTIONS
  if (methodGuard(req, res, ["POST"])) return;  // 405 si no es POST

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[push/subscribe] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }

  // Rate limit por IP: alta no debería llamarse en ráfaga. En runtime Node la
  // IP viene en x-forwarded-for (getClientIpEdge es solo para Edge/Request).
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = await checkRateLimit(`push-sub:${ip}`, { max: 20, windowSec: 60, prefix: "rl" });
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const body = parseBody(req) || {};
  const sub = body.subscription;
  const locale = body.locale === "en" ? "en" : "es";
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: "invalid_subscription" });
  }

  // Identidad best-effort. Ninguna es obligatoria (los anónimos son bienvenidos).
  let userId = null;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token) {
    try {
      const { data } = await createAuthClient(token).auth.getUser();
      userId = data?.user?.id ?? null;
    } catch {
      /* token inválido → tratamos como anónimo */
    }
  }
  let anonId = null;
  try {
    const payload = readAnonToken(req); // {d, n, s} o null
    anonId = payload?.n ?? null;
  } catch {
    /* sin sesión anónima válida */
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_id: userId,
      anon_id: anonId,
      locale,
      failure_count: 0,       // reset: re-suscribirse limpia fallos previos
      last_notified_at: null, // que reciba el próximo envío
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("[push/subscribe] upsert falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }
  return res.status(200).json({ ok: true });
}
```

- [ ] **Step 2: Verificar que la suite sigue verde (no rompe imports)**

Run: `npx vitest run`
Expected: PASS (ningún test importa este handler; solo confirmamos que no hemos roto nada).

- [ ] **Step 3: Commit**

```bash
git add api/push/subscribe.js
git commit -m "feat(push): endpoint de alta de suscripción (admin, anon+user)"
```

---

## Task 10: Endpoint de baja `api/push/unsubscribe.js`

**Files:**
- Create: `api/push/unsubscribe.js`

- [ ] **Step 1: Escribir el endpoint**

```js
// api/push/unsubscribe.js
// Baja de una suscripción por endpoint. ADMIN-ONLY (delete con service role).
// No exige identidad: el endpoint es un secreto de facto (URL única de push),
// y borrarlo solo afecta a ese navegador. Node runtime.

import { applyCors, methodGuard, parseBody } from "../_lib/http.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import { checkRateLimit } from "../_lib/ratelimit.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (methodGuard(req, res, ["POST"])) return;

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[push/unsubscribe] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = await checkRateLimit(`push-unsub:${ip}`, { max: 20, windowSec: 60, prefix: "rl" });
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const body = parseBody(req) || {};
  const endpoint = body.endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "invalid_endpoint" });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) {
    console.error("[push/unsubscribe] delete falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }
  return res.status(200).json({ ok: true });
}
```

- [ ] **Step 2: Verificar suite verde**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/push/unsubscribe.js
git commit -m "feat(push): endpoint de baja de suscripción"
```

---

## Task 11: Handler de envío `api/cron/send-push.js`

**Files:**
- Create: `api/cron/send-push.js`

*(Sin test unitario: importa `web-push` (no instalado en worktree). Lógica pura ya testeada en Task 2. Se verifica en Preview con disparo manual.)*

- [ ] **Step 1: Escribir el handler**

```js
// api/cron/send-push.js
// Envío diario del recordatorio Web Push. Lo dispara GitHub Actions a las 15:00
// UTC (~16:00/17:00 Madrid) con Authorization: Bearer CRON_SECRET (mismo patrón
// que warm-daily.js). Node runtime (web-push usa crypto de Node).
//
// Idempotencia por día: solo envía a subs con last_notified_at != hoy, y las
// marca al enviar → un re-disparo manual no duplica. Purga las expiradas (404/
// 410) y cuenta fallos (borra tras 3). Sentry captura errores SIN PII.

import webpush from "web-push";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import {
  getPushCopy,
  buildPushPayload,
  classifySendError,
  madridDateStr,
} from "../_lib/push.js";

const BATCH = 100; // enviar en lotes para no saturar

export default async function handler(req, res) {
  // --- AUTH: mismo esquema que los crons existentes ---
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/send-push] CRON_SECRET no configurado");
    return res.status(500).json({ error: "server_misconfigured" });
  }
  if ((req.headers.authorization || "") !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // --- ENVS ---
  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[cron/send-push] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error("[cron/send-push] envs VAPID ausentes");
    return res.status(500).json({ error: "server_misconfigured" });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = getSupabaseAdmin();
  const today = madridDateStr();

  // Subs pendientes de aviso hoy (nunca avisadas o avisadas otro día).
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failure_count")
    .or(`last_notified_at.is.null,last_notified_at.neq.${today}`);
  if (error) {
    console.error("[cron/send-push] query falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }

  const notifiedIds = [];
  const expiredIds = [];
  const failBump = []; // { id, failure_count }

  for (let i = 0; i < (subs?.length || 0); i += BATCH) {
    const slice = subs.slice(i, i + BATCH);
    await Promise.allSettled(
      slice.map(async (s) => {
        const copy = getPushCopy(s.locale);
        const payload = buildPushPayload({ title: copy.title, body: copy.body, url: "/" });
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          notifiedIds.push(s.id);
        } catch (err) {
          if (classifySendError(err) === "expired") expiredIds.push(s.id);
          else failBump.push({ id: s.id, failure_count: (s.failure_count || 0) + 1 });
        }
      })
    );
  }

  // Marcar enviadas hoy (idempotencia).
  if (notifiedIds.length) {
    await admin
      .from("push_subscriptions")
      .update({ last_notified_at: today, failure_count: 0 })
      .in("id", notifiedIds);
  }
  // Borrar expiradas.
  if (expiredIds.length) {
    await admin.from("push_subscriptions").delete().in("id", expiredIds);
  }
  // Subir contador de fallos; borrar las que llegan a 3.
  for (const f of failBump) {
    if (f.failure_count >= 3) {
      await admin.from("push_subscriptions").delete().eq("id", f.id);
    } else {
      await admin.from("push_subscriptions").update({ failure_count: f.failure_count }).eq("id", f.id);
    }
  }

  return res.status(200).json({
    ok: true,
    sent: notifiedIds.length,
    expired: expiredIds.length,
    failed: failBump.length,
  });
}
```

- [ ] **Step 2: Verificar suite verde**

Run: `npx vitest run`
Expected: PASS (ningún test importa este handler).

- [ ] **Step 3: Commit**

```bash
git add api/cron/send-push.js
git commit -m "feat(push): handler de envío diario (idempotente, purga expiradas)"
```

---

## Task 12: Disparador GitHub Actions `.github/workflows/daily-push.yml`

**Files:**
- Create: `.github/workflows/daily-push.yml`

- [ ] **Step 1: Escribir el workflow**

```yaml
# .github/workflows/daily-push.yml
# Dispara el recordatorio Web Push diario. Cron a las 15:00 UTC (~16:00 invierno
# / 17:00 verano en Madrid; ambas caen en sobremesa). Hace POST al endpoint
# protegido con el secreto compartido. Gratis y desacoplado del límite de crons
# del plan Hobby de Vercel. Se puede lanzar a mano (workflow_dispatch) para probar.
name: daily-push

on:
  schedule:
    - cron: "0 15 * * *"
  workflow_dispatch: {}

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - name: POST /api/cron/send-push
        run: |
          code=$(curl -s -o /tmp/out.txt -w "%{http_code}" -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://cochedeldia.com/api/cron/send-push)
          echo "HTTP $code"; cat /tmp/out.txt
          test "$code" = "200"
```

- [ ] **Step 2: Verificación**

No hay test automático (es infra). Verificación real: tras el deploy, lanzar el workflow a mano desde la pestaña Actions de GitHub (`workflow_dispatch`) y comprobar que responde `HTTP 200` y `{"ok":true,...}`. Requiere que el secret `CRON_SECRET` esté configurado en GitHub y las envs VAPID en Vercel.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-push.yml
git commit -m "ci(push): workflow diario que dispara el envío a las 15:00 UTC"
```

---

## Task 13: Cobertura de seguridad, suite final y PR

**Files:**
- Modify (si aplica): script de `test:rls` / `test:attacks` bajo `scripts/`

- [ ] **Step 1: Localizar las suites de seguridad**

Run: `cat package.json | grep -A2 "test:rls\|test:attacks"` y luego abrir el script referenciado (bajo `scripts/`).

- [ ] **Step 2: Añadir aserción de que `push_subscriptions` es inaccesible**

En el script de RLS/attacks, junto a las comprobaciones de otras tablas, añade una que verifique que un cliente `anon` y uno `authenticated` reciben error/0 filas al intentar `select`/`insert` sobre `public.push_subscriptions`. Sigue el patrón EXACTO que el script ya usa para otras tablas (mismo helper de cliente, mismo estilo de aserción). Ejemplo conceptual (adáptalo al helper real del script):

```js
// push_subscriptions debe ser opaca para roles públicos (admin-only).
await expectDenied(anonClient.from("push_subscriptions").select("*"));
await expectDenied(authClient.from("push_subscriptions").select("*"));
```

- [ ] **Step 3: Ejecutar toda la red de seguridad**

Run: `npx vitest run`
Expected: PASS (los 107 previos + `push.test.js` + `webpush.test.js`).

Run (si hay credenciales de test configuradas): `npm run test:rls && npm run test:attacks`
Expected: PASS, incluida la nueva aserción. (Si estas suites requieren envs que no están en el worktree, anótalo y déjalas para verificación en Preview.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(push): verifica que push_subscriptions es inaccesible para anon/authenticated"
```

- [ ] **Step 5: Push y PR**

```bash
git push -u origin claude/web-push-reminder
gh pr create --base main --head claude/web-push-reminder \
  --title "feat(push): recordatorio diario por Web Push (retención web)" \
  --body "Implementa el spec docs/superpowers/specs/2026-07-02-web-push-reminder-design.md. Nace del feedback en r/coches: la web no tenía forma de traer de vuelta al usuario. Web push opt-in (incl. anónimos), envío ~16:00 Madrid vía GitHub Actions, gateado para no chocar con la app nativa. Requiere configurar envs VAPID en Vercel y CRON_SECRET en GitHub."
```

- [ ] **Step 6: Post-merge (recordar al usuario, NO es código)**

Tras mergear, el usuario debe: (1) aplicar `scripts/2026-07-web-push-subscriptions.sql` en Supabase; (2) generar claves VAPID y añadir `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`VITE_VAPID_PUBLIC_KEY` en Vercel; (3) añadir `CRON_SECRET` como GitHub Secret; (4) lanzar el workflow a mano para la primera prueba.

---

## Self-review (cobertura del spec)

- Envío único ~16:00 Madrid → Task 11 (`madridDateStr`, idempotencia) + Task 12 (cron 15:00 UTC). ✓
- Opt-in tras 1ª partida + toggle en menú → Task 7 + Task 8. ✓
- Hint iOS "añadir a inicio" → Task 3 (`isIosNotInstalled`) + Task 6 + Task 7. ✓
- Disparador GitHub Actions con CRON_SECRET → Task 12. ✓
- Anónimos vía header x-anon-session → Task 9 (`readAnonToken`). ✓
- Tabla admin-only + RLS deny-all, sin GRANTs → Task 1. ✓
- Mensaje genérico (regla 5) → Task 2 (`PUSH_COPY`). ✓
- Convivencia con nativo (gate) → Task 3 (`isPushSupported`/`isNative`) + Task 7. ✓
- Purga de expiradas + idempotencia → Task 11. ✓
- Fallo en silencio / 500 controlado sin envs → Tasks 9-11. ✓
- Tests: pura (Task 2), cliente (Task 3), seguridad RLS (Task 13). ✓
- Dep web-push + envs VAPID → Task 0. ✓

**Fuera de alcance confirmado (no hay tareas, correcto):** zonas horarias, gancho de racha, email, caché offline, segundo aviso.
