# Coche del Día — App Android con Capacitor (v1)

**Fecha:** 2026-06-19
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Autor:** brainstorming Claude + EvilAze

## Contexto y objetivo

Se aparca la mejora de retención web (se deja como está) y se prioriza
**empaquetar la web existente como app Android** para llegar a Google Play y,
sobre todo, poder usar **notificaciones** — el gran hueco de retención de un
juego diario. Filosofía: envío pequeño, validar resultados con la app corriendo,
y ampliar (push de servidor, login nativo) en v2.

No es un *rewrite*. Es **un solo código**: la misma SPA React/Vite que sirve
Vercel, empaquetada en un shell nativo con **Capacitor**. La web sigue
byte-idéntica; todo lo nativo va detrás de `Capacitor.isNativePlatform()`, así
que en web es no-op.

### Decisiones cerradas (v1)

| Decisión | Valor | Motivo |
|----------|-------|--------|
| Enfoque | **Capacitor** | Reutiliza el código; permite notificaciones locales sin backend. (TWA no da notif. locales; React Native = rewrite.) |
| Carga de contenido | **Bundled** (`webDir: build`) | Feel nativo, arranque instantáneo, más seguro para aprobación en Play. |
| Auth en v1 | **Anónimo primero** | Google OAuth se bloquea en WebView (`disallowed_useragent`). El login nativo va a v2. El juego anónimo (localStorage) ya funciona. |
| Notificaciones v1 | **Solo recordatorio diario local** | `@capacitor/local-notifications`, cero backend. Push de servidor (FCM) → v2. |
| `applicationId` | **`com.cochedeldia`** | Reverse-DNS del dominio. Permanente en Play. |
| Hora recordatorio | **10:00 hora local** (por defecto) | Hora amable; se ajustará según resultados con la app corriendo. |
| Repo | **Carpeta `android/` en este mismo repo** | Monorepo, Capacitor está pensado para convivir. |
| Plataforma | **Solo Android** | Usuario en Fedora Linux (Android Studio nativo, sin Mac). iOS fuera. |

### Fuera de alcance (v2, anotado en memoria)

Login Google nativo · push de servidor/FCM · sincronía de cuenta entre
dispositivos · iOS.

## Arquitectura

```
┌──────────────────────────── Android (Capacitor) ────────────────────────────┐
│  WebView origen https://localhost                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Build de React (bundled, webDir: build) — idéntico al de la web     │    │
│  │   · arranque instala shim de fetch (solo nativo) → apiUrl()          │    │
│  │   · CarImage absolutiza src /api/* con apiUrl() (solo nativo)        │    │
│  │   · notifications.js → @capacitor/local-notifications                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│        │ fetch /api/* (reescrito a https://PROD/api/*)   │ <img /api/daily-* │
└────────┼──────────────────────────────────────────────────┼─────────────────┘
         ▼                                                    ▼
   Vercel Functions  ──── applyCors(https://localhost) ────  api/daily-image
         │                                                    (proxy imagen)
         ▼
   Supabase (URL absoluta → intacta, ya es cross-origin desde web)
```

El único cambio conceptual respecto a la web es el **origen**: en bundled pasa de
`https://cochedeldia.com` a `https://localhost`. De ahí salen las dos costuras
(URL de la API y CORS). Todo lo demás es aditivo.

## Unidades

### A. Proyecto y build Capacitor

- **Dependencias:** `@capacitor/core`, `@capacitor/cli` (dev), `@capacitor/android`,
  `@capacitor/local-notifications`, `@capacitor/app` (ciclo de vida + botón atrás),
  `@capacitor/status-bar`, `@capacitor/splash-screen`.
- **`capacitor.config.json`** (raíz):
  - `appId: "com.cochedeldia"`, `appName: "Coche del Día"`, `webDir: "build"`.
  - `server.androidScheme: "https"` → origen de la app `https://localhost`.
- `npx cap add android` genera la carpeta **`android/`** (proyecto Gradle), que se
  **commitea** en este repo.
- **Scripts npm:** `cap:sync` (`vite build && cap sync android`), `cap:open`
  (`cap open android`).
- **Iconos / splash:** generados desde assets existentes (`web-app-manifest-512.png`,
  `splash-car.jpg`) con `@capacitor/assets`. Splash + status bar en `bg-primary`
  (tema dark).

### B. Costura 1 — base de la API absoluta (`apiUrl()` + shim de fetch)

**Problema:** en bundled el origen es `https://localhost`; las ~20 llamadas
`fetch("/api/...")` y la `<img src="/api/daily-image…">` dejarían de resolver.

**Solución — un único helper como fuente de verdad:**

- **`src/lib/apiUrl.js`**: `apiUrl(path)` →
  - Web: devuelve `path` sin tocar (relativo, comportamiento actual).
  - Nativo (`Capacitor.isNativePlatform()`): antepone `VITE_PROD_ORIGIN`
    (p.ej. `https://www.cochedeldia.com`) a las rutas que empiezan por `/api`.
- **Shim de `fetch`** instalado en el arranque (`src/index.jsx`), **solo en nativo**:
  envuelve `window.fetch` y pasa cualquier URL string por `apiUrl()`. Así no hay
  que tocar los ~20 *call sites* de `fetch`. Deja intactas Supabase (URL absoluta)
  y el resto.
- **Imágenes `/api/*`:** el shim de fetch **no** cubre el `src` de `<img>`. Como
  `CarImage` ya detecta `isApiProxy = src.startsWith("/api/")`, se absolutiza ahí:
  cuando es nativo y el `src` empieza por `/api/`, se pasa por `apiUrl()` antes de
  construir `src`/`srcset`. Es el único consumidor de imágenes `/api/*` conocido;
  el plan incluye **auditar** otros (p.ej. `Garage`, `api/car-image`) y aplicarles
  el mismo `apiUrl()` si los hubiera.
- Assets estáticos relativos del `public/` (`/brands/...`, `/flags/...`) viajan en
  el bundle → resuelven contra `https://localhost/...` sin cambios. No tocar.

### C. Costura 2 — CORS en los endpoints del juego

**Problema:** hoy no hay CORS en `api/`. Desde `https://localhost` las llamadas se
bloquearían.

- **`applyCors(req, res)`** en `api/_lib/http.js`:
  - **Allowlist estricta**: solo `https://localhost` (origen de la app). **Nunca
    `*`.** Echo del `Origin` solo si está en la lista.
  - Maneja **preflight `OPTIONS`** (responde 204 con los headers CORS).
- Se aplica **solo a los endpoints que la app v1 consume**: `get-daily-car`,
  `validate-guess`, `list-cars`, `daily-stats`, `garage`. (`daily-image` se consume
  vía `<img>` → **no** necesita CORS; se confirma en el plan.) **Admin no se toca.**
- No cambia el modelo de RLS/tokens. Regla del proyecto: `test:security`,
  `test:rls`, `test:attacks` **deben seguir verdes**.

### D. Notificación diaria local (motivo del pivote)

- **`src/lib/notifications.js`** envolviendo `@capacitor/local-notifications`:
  `ensurePermission()`, `scheduleDailyReminder()`, `cancelDailyReminder()`,
  `isEnabled()`. Todo no-op en web.
- **Repetición diaria a las 10:00 hora local** (id fijo → reprogramar reemplaza, no
  duplica). Texto vía i18n (`useT()`): "Hoy hay coche nuevo 🚗"; si hay racha en
  localStorage, copy con loss-aversion suave ("Tu racha de N días te espera").
  > Nota: el coche cambia a medianoche **Europe/Madrid**; el recordatorio dispara en
  > hora local del dispositivo. Para usuarios en España coinciden; para otros husos
  > el coche ya está disponible por la mañana → aceptable en v1.
- **Opt-in no intrusivo:** el permiso **no** se pide al abrir. Tras **terminar la
  primera partida**, un prompt suave una sola vez ("¿Te aviso cuando haya coche
  nuevo?"). Sí → permiso del SO (Android 13+ requiere `POST_NOTIFICATIONS`) →
  programa. La elección se persiste en localStorage para no insistir.
- **Re-arme** en cada apertura/resume (`@capacitor/app`) para mantenerlo activo.
- **Toggle** en el Configurator para activar/desactivar.
- Todo detrás de `isNativePlatform()` → en web no aparece nada.

### E. Acabado nativo (barato)

- **Botón atrás** de Android (`@capacitor/app` `backButton`): en home → salir; si no
  → navegar atrás (el router manual usa `history`).
- **Status bar + splash** en tema dark (`bg-primary`). Sin más cambios de UI.

## Flujo de datos (app)

1. Arranque → `index.html` bundled en `https://localhost` → React monta.
2. Shim de `fetch` activo (nativo) → `/api/get-daily-car` reescrito a
   `https://PROD/api/get-daily-car`.
3. `applyCors` permite `https://localhost` → respuesta OK.
4. Se juega **anónimo** (localStorage + anon-session token) igual que en web.
5. `CarImage` pinta `https://PROD/api/daily-image?...` (absolutizado).
6. Al terminar la 1ª partida → prompt opt-in → permiso → `scheduleDailyReminder()`.
7. Al día siguiente a las 10:00 local, el SO dispara "coche nuevo".

## Manejo de errores

- **Offline al arrancar:** el shell pinta, pero jugar necesita red (coche/validación
  vienen de la API) → caen los estados de error existentes. Aceptable en v1.
- **Permiso de notificación denegado:** sin recordatorio; el toggle refleja el
  estado; nunca se vuelve a insistir.
- **CORS mal configurado / origen incorrecto:** falla evidente en la prueba en
  dispositivo (se detecta en verificación manual).

## Testing y verificación

- **Web (Vercel Preview + CI):** los cambios web son **no-op/aditivos** en web (shim
  y `apiUrl` gateados por nativo; CORS solo añade headers). `npm run build` y las
  suites (`npm test`, `test:security`/`test:rls`/`test:attacks`) deben seguir verdes.
  Añadir tests unitarios para `apiUrl()` (web vs nativo, mockeando Capacitor) y para
  el wrapper de notificaciones.
- **App Android (manual, local):** **no** se puede verificar en el Preview de Vercel.
  Flujo: `npm run cap:sync` → Android Studio → emulador/dispositivo → jugar una
  partida → aceptar recordatorio → comprobar que queda programado (y, ajustando la
  hora del dispositivo cerca de las 10:00, que dispara). Luego AAB firmado → Play
  Console (empezar por *internal testing*). Trabajo manual del usuario; el código y
  la documentación quedan listos.

## Requisitos externos (usuario)

- **Cuenta Google Play Developer:** 25 $, pago único.
- **Android Studio** en Fedora (nativo, sin Mac).
- **Keystore de firma** para el AAB de release (se documenta en el plan).
- **`VITE_PROD_ORIGIN`** apuntando al dominio de producción real.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Play rechaza apps "solo web" | Bundled (no carga remota) + función nativa real (notificaciones) → es una app legítima. |
| Romper la web al añadir el shim | Todo gateado por `isNativePlatform()`; CORS solo añade headers. CI/suites de seguridad como red. |
| Algún `/api/*` consumido como imagen se nos escapa | Auditar consumidores de `/api/*` (fetch + img) en el plan; `apiUrl()` centraliza el fix. |
| Notificación dispara en hora local, no Madrid | Aceptable v1 (el coche ya está disponible por la mañana en cualquier huso). |
| Mojibake en strings con tildes | Escribir UTF-8; en regex usar formas escapadas (regla 14 del proyecto). |
