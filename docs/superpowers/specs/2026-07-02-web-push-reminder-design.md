# Diseño — Recordatorio diario por Web Push

**Fecha:** 2026-07-02
**Estado:** Aprobado (pendiente de plan de implementación)
**Origen:** Feedback real en r/coches (2026-07-01). Un usuario: *"lo difícil es acordarse
de volver a visitar la web de forma recurrente."* Es el problema existencial de todo juego
diario, y hoy la web **no tiene ningún mecanismo de retorno**: la infra de notificaciones
existente (`src/lib/notifications.js`, `NotificationOptIn.jsx`) es **exclusivamente nativa
(Capacitor/Android)** — en web todo es no-op. Todo el tráfico de captación (Reddit) es web y
anónimo, y a día de hoy no hay forma de traerlo de vuelta.

## Objetivo

Dar a los usuarios **web** (incluidos los anónimos) un recordatorio diario opt-in mediante
**Web Push**, sin coste (VAPID propio, sin proveedor externo) y sin degradar la experiencia de
quien no lo active.

## Decisiones tomadas (brainstorming)

1. **Momento y tono:** un único envío diario a **~16:00 hora de Madrid** (sobremesa: pilla a
   quien se le olvidó por la mañana y es buen momento para compartir en grupos). Mensaje
   **simple y genérico**, sin gancho de racha en v1.
2. **Opt-in:** pre-aviso suave tras la **1ª partida terminada** (pico de engagement) **+ un
   interruptor en el menú** para activar/desactivar más tarde.
3. **iOS:** el push web en iOS Safari exige que la web esté **instalada como PWA**. En iOS se
   muestra, en vez del botón de push, un **hint "Añade a inicio para recibir el aviso diario"**
   (que de paso deja el icono en su pantalla → retención pasiva). No se excluye al iPhone.
4. **Disparador de las 16:00:** **GitHub Actions** (workflow cron gratuito) que hace `POST` a un
   endpoint protegido `/api/cron/send-push` con un secreto compartido. Esquiva el límite de
   crons del plan Hobby de Vercel, es garantizado gratis, robusto y disparable a mano para
   pruebas.

## Arquitectura

```
NAVEGADOR (solo web, NO app nativa)                  SERVIDOR / INFRA
┌────────────────────────────────┐          ┌─────────────────────────────┐
│ Opt-in UI (tras 1ª partida) ────┼─ POST ──▶│ /api/push/subscribe          │
│  · Android/desktop: botón push  │          │  guarda sub (admin, RLS off) │
│  · iOS: hint "añadir a inicio"  │          │            │                 │
│ Toggle en menú (on/off) ────────┼─ POST ──▶│            ▼                 │
│                                 │          │   tabla push_subscriptions   │
│ service worker (sw.js) ◀────────┼── push ──┤            ▲                 │
│  · push → muestra notif         │          │   /api/cron/send-push        │
│  · click → abre "/"             │          │   (Bearer CRON_SECRET)       │
└────────────────────────────────┘          └────────────▲────────────────┘
                                                          │ POST 16:00 (15:00 UTC)
                                              GitHub Actions (workflow cron)
```

**Convivencia con la app nativa:** todo el código de push web va gateado por
`!Capacitor.isNativePlatform()`. La app Android conserva intactas sus notificaciones locales
(`notifications.js`); el push web es exclusivo del navegador. Cero doble-aviso.

## Componentes nuevos

| Pieza | Fichero | Responsabilidad |
|-------|---------|-----------------|
| Service worker | `public/sw.js` | Escucha `push` → `showNotification`; `notificationclick` → enfoca/abre `/`. Sin caché offline (fuera de alcance). |
| Módulo cliente | `src/lib/webpush.js` (+ `.test.js`) | Gemelo web de `notifications.js`: `isPushSupported()`, `subscribe()`, `unsubscribe()`, registro del SW. **No-op en nativo.** |
| Opt-in (web) | ampliar `src/components/NotificationOptIn.jsx` | Tras 1ª partida: botón de push (si soportado) o hint "añadir a inicio" (iOS no instalado). Persiste la decisión. |
| Toggle | menú (`src/components/HeaderSandwich.jsx`) | Activar/desactivar los avisos más tarde (segunda oportunidad al opt-in). |
| Tabla SQL | `scripts/2026-07-web-push-subscriptions.sql` | `push_subscriptions` + RLS deny-all para anon/authenticated. |
| Alta | `api/push/subscribe.js` | `POST {subscription, locale}`. Upsert vía **admin** por `endpoint` único; adjunta `user_id` (JWT) y/o `anon_id` (anon-session). Rate-limited. |
| Baja | `api/push/unsubscribe.js` | Borra la fila por `endpoint`. |
| Envío | `api/cron/send-push.js` (+ `.test.js`) | Bearer `CRON_SECRET`. Lee subs vía admin, envía con VAPID, localiza por `locale`, purga expiradas, idempotente por día. |
| Disparador | `.github/workflows/daily-push.yml` | Cron `0 15 * * *` (UTC) → `POST` al endpoint con `secrets.CRON_SECRET`. |
| Dependencia | `package.json` | `web-push` (VAPID; sin proveedor externo = gratis). |

## Datos e identidad

**Claves VAPID** (generadas una vez con `web-push generate-vapid-keys`):
- Server: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`).
- Cliente: `VITE_VAPID_PUBLIC_KEY` (es pública por diseño; seguro exponerla en el bundle).

**Tabla `push_subscriptions`:**

| Columna | Tipo | Nota |
|---------|------|------|
| `id` | `uuid` PK `default gen_random_uuid()` | |
| `endpoint` | `text` **UNIQUE NOT NULL** | clave natural del navegador; upsert por aquí |
| `p256dh` | `text NOT NULL` | clave pública del cliente (de `subscription.keys`) |
| `auth` | `text NOT NULL` | secreto de auth (de `subscription.keys`) |
| `user_id` | `uuid NULL` | FK `auth.users(id)` si está logueado |
| `anon_id` | `text NULL` | identificador de `anon-session` si es anónimo |
| `locale` | `text NOT NULL default 'es'` | idioma del mensaje (`es`/`en`) |
| `created_at` | `timestamptz default now()` | |
| `last_notified_at` | `date NULL` | idempotencia por día |
| `failure_count` | `int NOT NULL default 0` | purga tras 3 fallos no-expiración |

- **Anónimos incluidos** (son el tráfico de Reddit): sub asociada al `anon_id` de `anon-session`;
  si además está logueado, también al `user_id`. Un mismo navegador = una fila (upsert por
  `endpoint`). El endpoint de alta lee el identificador anónimo de la **cookie de sesión** que
  ya emite `anon-session` (no hace falta que el cliente lo mande).

**Runtime:** `api/push/subscribe.js`, `api/push/unsubscribe.js` y `api/cron/send-push.js` son
funciones **Node** (no Edge): `web-push` necesita el `crypto` de Node, y el envío usa
`getSupabaseAdmin()`. Coherente con los crons existentes (`warm-daily.js` es Node).

## Seguridad (reglas CLAUDE.md)

- **Regla 5 — no filtrar el coche:** el mensaje es genérico (*"Ya puedes jugar al coche de hoy
  🚗"*). **Nunca** marca, modelo, año, pista ni imagen.
- **Regla 3 — GRANTs:** la tabla es **admin-only**. El cliente **nunca** la toca directamente
  (todo pasa por `api/push/*`). RLS deny-all para `anon`/`authenticated` → no hay `GRANT SELECT`
  que mantener y es más seguro. Los scripts `test:rls`/`test:attacks` deben verificar que
  anon/authenticated no pueden leer ni escribir la tabla.
- **Endpoint de envío:** mismo patrón `Authorization: Bearer ${CRON_SECRET}` que los crons
  actuales (`warm-daily.js`). `401` si no coincide o falta el secreto.
- **Secretos:** `VAPID_PRIVATE_KEY` solo en env server. El workflow de GitHub usa
  `secrets.CRON_SECRET`.
- **Sentry:** fallos de envío como error, **sin PII** (no logear endpoints ni tokens).
- **Idempotencia:** `send-push` marca `last_notified_at = hoy` y salta las ya avisadas hoy → un
  re-disparo manual (para pruebas) no duplica avisos.

## Errores y resiliencia

- Sub expirada (web-push devuelve **404/410**) → **borrar** la fila.
- Otros errores de envío → `failure_count++`; borrar tras **3**.
- Envío en **lotes** con `Promise.allSettled` (un fallo no tumba el resto del envío).
- Cliente: permiso denegado / SW no soportado / cualquier fallo → **silencioso** (regla 9: no
  degradar la web). El juego funciona igual sin push.
- Falta de envs VAPID → el endpoint responde `500` controlado (patrón `getMissingAdminEnvs`).
- **DST:** `0 15 * * *` UTC ≈ 16:00 en invierno (CET) y 17:00 en verano (CEST). Aceptable para
  v1 (ambas horas caen en sobremesa); no se implementa ajuste por horario de verano.

## Tests

- `src/lib/webpush.test.js`: no-op en nativo, detección de soporte, forma de la suscripción
  enviada al endpoint.
- `api/cron/send-push` (unit): localización del mensaje según `locale`, purga en `410`,
  idempotencia por día, rechazo `401` sin `CRON_SECRET`.
- `test:rls` / `test:attacks`: anon/authenticated **no** pueden leer ni escribir
  `push_subscriptions`.
- Toda la suite `vitest` (107 tests actuales) sigue en verde.

## Fuera de alcance (v1 — YAGNI)

- Envío por zona horaria (un único envío global a hora de España).
- Gancho de racha / aversión a la pérdida en el mensaje.
- Email de respaldo para iOS.
- Caché offline / funcionamiento PWA completo (solo se registra el SW para el push).
- Segundo aviso vespertino a quien no jugó.
- Notificaciones enriquecidas (imagen, acciones).

## Criterios de éxito

1. Un usuario web (anónimo o logueado) en Android/desktop puede activar avisos tras su 1ª
   partida y recibir, a las ~16:00 de España, una notificación que al pulsarla abre el juego.
2. Un usuario iOS ve el hint de "añadir a inicio" en vez de un botón que no funcionaría.
3. La app nativa Android **no** cambia su comportamiento (sigue con notificaciones locales).
4. Las suscripciones expiradas se purgan solas; no hay duplicados por re-disparo.
5. `anon`/`authenticated` no pueden tocar `push_subscriptions`; suites de seguridad en verde.
6. Sin envs VAPID/CRON_SECRET, todo falla en silencio o con 500/401 controlado — la web no se
   degrada.
