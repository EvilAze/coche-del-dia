# Login Google nativo en la app Android (v2 · sub-proyecto 1)

**Fecha:** 2026-06-21
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Contexto previo:** v1 (app Capacitor anónima + notif. local) ya en producción — ver
`docs/superpowers/specs/2026-06-19-android-app-capacitor-v1-design.md`.

## Objetivo

Permitir **iniciar sesión con Google dentro de la app Android**. En web el login ya
funciona con `supabase.auth.signInWithOAuth({ provider: "google" })` (flujo redirect),
pero Google **bloquea ese redirect dentro del WebView** (`disallowed_useragent`), por
eso v1 es anónima. La solución es un **selector de cuenta nativo** (plugin) que
devuelve un `idToken`, que cambiamos por una sesión Supabase con
`signInWithIdToken`.

Es el **sub-proyecto 1 de v2**. El sub-proyecto 2 (push de servidor / FCM) va
después y se apoya en que ya haya usuarios logueados en la app.

### Alcance clave (por qué es pequeño)

El front es **compartido** web/app. Una vez existe una **sesión Supabase**, todo lo
demás ya está hecho: `useGame` adjunta `Authorization: Bearer <token>`, el servidor
usa la rama logueada de `get-daily-car`/`validate-guess`, y `useAuthSession` carga
perfil + racha + ranking. Lo **único nuevo** es el *mecanismo de sign-in en nativo*.
El flujo web no se toca.

### Decisiones cerradas

| Decisión | Valor | Motivo |
|----------|-------|--------|
| Mecanismo | **Plugin nativo one-tap** (no navegador+deep link) | Mejor UX, "app de verdad". El usuario aceptó el coste del setup SHA-1. |
| Plugin | **`@capgo/capacitor-social-login`** (v8.x, peer `@capacitor/core >=8`) | Mantenido y compatible con Capacitor 8. El clásico `@codetrix-studio/capacitor-google-auth` se quedó en Capacitor 6. |
| Sesión Supabase | **`supabase.auth.signInWithIdToken({ provider: "google", token })`** | Convierte el `idToken` nativo en sesión Supabase real (mismo modelo que web). |
| Web | **Intacto** (`signInWithOAuth` redirect) | Funciona en navegador; solo ramificamos en nativo. |

### Fuera de alcance
- Migración del progreso **anónimo → cuenta** (la app hereda el comportamiento actual
  de la web al loguear; no añadimos lógica de merge).
- **Push FCM** (sub-proyecto 2 de v2).
- **iOS** (solo Android).
- **Login en `/admin-tools`** (no se abre dentro de la app; se queda con el redirect web).

## Arquitectura

```
  Botón "Iniciar sesión con Google"
            │  signInWithGoogle()  (src/lib/auth.js — ramifica por plataforma)
   ┌────────┴─────────┐
   ▼ web              ▼ nativo (Capacitor.isNativePlatform())
 supabase.auth         nativeGoogleSignIn()  (src/lib/nativeAuth.js)
 .signInWithOAuth        │ SocialLogin.login({ provider: "google" }) → idToken
 ({provider:"google"})   ▼ supabase.auth.signInWithIdToken({provider:"google", token})
   │                     │
   └──────────┬──────────┘
              ▼ onAuthStateChange → useAuthSession → app logueada
                (a partir de aquí, idéntico a web: Bearer en las llamadas, etc.)
```

## Unidades

### `src/lib/nativeAuth.js` (solo nativo; no-op/irrelevante en web)
- `initNativeAuth()` — llama una vez `SocialLogin.initialize({ google: { webClientId: VITE_GOOGLE_WEB_CLIENT_ID } })`. Se invoca en el arranque (`index.jsx`, bloque nativo). Import perezoso del plugin para no engordar el bundle web.
- `nativeGoogleSignIn()` — `SocialLogin.login({ provider: "google", options: {...} })` → extrae `idToken` → `supabase.auth.signInWithIdToken({ provider: "google", token: idToken })`. Devuelve `{ data, error }` estilo Supabase. Maneja cancelación (devuelve sin error visible).
- `nativeSignOut()` — `SocialLogin.logout({ provider: "google" })` best-effort (no romper si falla).
- Si falta `VITE_GOOGLE_WEB_CLIENT_ID`, `initNativeAuth` no-opea y `nativeGoogleSignIn` devuelve error controlado → el juego sigue anónimo.

### `src/lib/auth.js` (helpers unificados, web + nativo)
- `signInWithGoogle()` — `Capacitor.isNativePlatform()` ? `nativeGoogleSignIn()` : `supabase.auth.signInWithOAuth({ provider: "google" })`.
- `signOut()` — `await supabase.auth.signOut()`; si nativo, además `await nativeSignOut()` (best-effort).

### Cableado (cambios mínimos en componentes)
- `src/App.jsx` (~línea 371): el botón de Google pasa de `onClick={() => supabase.auth.signInWithOAuth(...)}` a `onClick={signInWithGoogle}`.
- `src/components/MyStats.jsx` (~línea 177): el sign-out pasa a usar el `signOut()` unificado.
- `src/index.jsx`: dentro del bloque `if (Capacitor.isNativePlatform())` del arranque, añadir `initNativeAuth()`.
- (Admin: `AdminTools.jsx` se deja con el redirect web — no entra en la app.)

### Configuración
- `package.json`: añadir `@capgo/capacitor-social-login`; `npm run cap:sync` para registrarlo en Android.
- `.env`: `VITE_GOOGLE_WEB_CLIENT_ID=<web client id>` (no secreto; ya lo usa Supabase para web). Documentar junto a las otras `VITE_*`.
- Android: el plugin se autoregistra vía `cap sync`; verificar en el plan si necesita ajustes en `build.gradle`/Credential Manager (lo gestiona el propio plugin).

## Setup externo (manual del usuario) — la parte frágil

Se documentará paso a paso en `docs/android-build-release.md` (o un doc nuevo de OAuth):

1. **Google Cloud Console** (mismo proyecto que el OAuth web):
   - Crear **OAuth client ID tipo Android**: package `com.cochedeldia` + **SHA-1** del *debug keystore* (para emulador/dispositivo). Obtener con
     `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android` o `./gradlew signingReport`.
   - Para release, añadir además la SHA-1 del *upload key* y la de **Play App Signing** (desde Play Console). Es el clásico "va en debug, rompe en Play" si falta.
   - Anotar el **Web client ID** existente (el que usa Supabase).
2. **Supabase** → Auth → Providers → Google: asegurar que el **Web client ID** está en **"Authorized Client IDs"** (para que acepte el `idToken` nativo cuyo `aud` = web client).
3. Poner `VITE_GOOGLE_WEB_CLIENT_ID=<web client id>` en `.env` y recompilar (`cap:sync`).

## Flujo de datos

1. Usuario pulsa el botón → `signInWithGoogle()`.
2. Nativo: el plugin abre el selector de cuenta de Android (Credential Manager) → `idToken`.
3. `supabase.auth.signInWithIdToken({ provider: "google", token: idToken })` → sesión.
4. `onAuthStateChange` → `useAuthSession` carga user/profile/streak/rank.
5. Las siguientes llamadas (`get-daily-car`, `validate-guess`) ya van con `Bearer` → rama logueada.

## Manejo de errores
- **Cancelación** del selector → no-op silencioso (como cancelar el share nativo).
- **Falta `VITE_GOOGLE_WEB_CLIENT_ID`** o falla el plugin → toast de error, sin romper; el usuario sigue jugando anónimo.
- **`signInWithIdToken` rechazado** (aud no autorizado en Supabase) → error → toast; señal de que falta configurar el client ID en Supabase. Se loguea a Sentry (sin PII).

## Testing
- **Web (Vercel/CI):** sin cambios de comportamiento (el branch web de `signInWithGoogle`/`signOut` es el de hoy). Suites y `vite build` verdes.
- **Unit (Vitest):** test del *branching* de `signInWithGoogle()` y `signOut()` — mock de `@capacitor/core` (isNativePlatform true/false), de `supabase.auth` y del wrapper nativo; verificar que en web llama a `signInWithOAuth` y en nativo a la ruta del plugin + `signInWithIdToken`.
- **App (manual):** una vez configurado el OAuth client + SHA-1, probar en dispositivo/emulador: pulsar login → elegir cuenta → volver logueado → ver racha/ranking; sign-out.

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|--------|------------|
| SHA-1 no coincide (debug vs upload vs Play) → login falla en release | Documentar registrar las 3 SHA-1; probar primero en debug. |
| `idToken` con `aud` no autorizado en Supabase | Añadir el Web client ID a "Authorized Client IDs" en Supabase (paso 2). |
| El plugin engorda el bundle web | Import perezoso + gating `isNativePlatform()`; en web no se carga. |
| Romper el login web | Todo ramificado; el branch web es idéntico al actual; suites como red. |
| `signInWithIdToken` requiere nonce | Detalle del plan: usar el nonce del plugin si aplica, o el flujo sin nonce que soporta @capgo. |
