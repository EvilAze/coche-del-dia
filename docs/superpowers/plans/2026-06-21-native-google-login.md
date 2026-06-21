# Login Google nativo (v2 · sub-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir login con Google dentro de la app Android (selector de cuenta nativo → sesión Supabase), sin tocar el flujo de login web.

**Architecture:** Un helper unificado `signInWithGoogle()`/`signOut()` ramifica por plataforma: en web mantiene `supabase.auth.signInWithOAuth` (redirect) tal cual; en nativo usa `@capgo/capacitor-social-login` (one-tap) para obtener un `idToken` y lo cambia por sesión con `supabase.auth.signInWithIdToken`. Todo lo nativo va detrás de `Capacitor.isNativePlatform()` → la web no cambia. Una vez hay sesión Supabase, el resto del front (Bearer en las llamadas, perfil/racha/ranking) ya funciona.

**Tech Stack:** React 18 + Vite, Capacitor 8, `@capgo/capacitor-social-login`, Supabase Auth, Vitest.

**Decisiones fijadas:** plugin `@capgo/capacitor-social-login` · sesión vía `signInWithIdToken` · env `VITE_GOOGLE_WEB_CLIENT_ID` (Web client ID que ya usa Supabase) · web intacto · admin fuera de alcance.

**Spec:** `docs/superpowers/specs/2026-06-21-native-google-login-design.md`

**API del plugin (confirmada del README):**
- `SocialLogin.initialize({ google: { webClientId } })`
- `const login = await SocialLogin.login({ provider: "google" });` → `const idToken = login.result?.idToken;`
- `SocialLogin.logout({ provider: "google" })`

---

## Task 1: Instalar el plugin + documentar la env var

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Instalar el plugin**

Run:
```bash
npm install @capgo/capacitor-social-login
```
Expected: se añade a `dependencies` en `package.json` sin errores (peer `@capacitor/core >=8` ya satisfecho).

- [ ] **Step 2: Registrar el plugin en Android (sync)**

Run: `npm run cap:sync`
Expected: `vite build` OK + `cap sync android` → entre los plugins detectados aparece `@capgo/capacitor-social-login`. (El `.env` con `VITE_SUPABASE_*` ya está en el worktree; si `vite build` se queja de Supabase, falta el `.env` — ver `docs/android-build-release.md`.)

- [ ] **Step 3: Documentar `VITE_GOOGLE_WEB_CLIENT_ID` en `.env.example`**

Añade al final de `.env.example`:
```bash
# Login Google NATIVO en la app Android (Capacitor). Es el "Web client ID" del
# OAuth de Google (el mismo que usa Supabase para el login web). No es secreto.
# Sin él, el login en la app no funciona (el juego sigue anónimo); web no lo usa.
VITE_GOOGLE_WEB_CLIENT_ID=
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "build(cap): añadir @capgo/capacitor-social-login + documentar VITE_GOOGLE_WEB_CLIENT_ID

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Si `cap sync` cambió ficheros NO-ignorados bajo `android/`, inclúyelos en este commit. NO añadas `node_modules` ni `build/`.)

---

## Task 2: Wrapper de sign-in nativo (`nativeAuth.js`)

**Files:**
- Create: `src/lib/nativeAuth.js`

- [ ] **Step 1: Crear `src/lib/nativeAuth.js`**

```js
// src/lib/nativeAuth.js
// Sign-in nativo de Google para la app Android (Capacitor). En web NO se usa
// (web va por supabase.auth.signInWithOAuth redirect). El plugin muestra el
// selector de cuenta nativo y devuelve un idToken que cambiamos por una sesión
// Supabase con signInWithIdToken. El plugin se importa de forma PEREZOSA para
// no arrastrarlo en el bundle web.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
let initialized = false;

async function plugin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  return SocialLogin;
}

// Heurística de cancelación: el plugin lanza al cancelar el selector en algunas
// versiones; lo tratamos como no-op (sin error visible).
function isUserCancel(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("cancel"); // cubre "cancel", "canceled", "cancelled"
}

// Inicializa el plugin una sola vez (idempotente). Sin WEB_CLIENT_ID no hace
// nada: el login dará un error controlado y el juego sigue anónimo.
export async function initNativeAuth() {
  if (!Capacitor.isNativePlatform() || initialized || !WEB_CLIENT_ID) return;
  const SocialLogin = await plugin();
  await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID } });
  initialized = true;
}

// Login nativo → sesión Supabase. Devuelve { data, error } estilo supabase.
export async function nativeGoogleSignIn() {
  if (!WEB_CLIENT_ID) {
    return { data: null, error: new Error("Falta VITE_GOOGLE_WEB_CLIENT_ID") };
  }
  try {
    await initNativeAuth();
    const SocialLogin = await plugin();
    const login = await SocialLogin.login({ provider: "google" });
    const idToken = login?.result?.idToken;
    if (!idToken) {
      // Sin idToken: normalmente el usuario canceló el selector.
      return { data: null, error: null };
    }
    return await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
  } catch (err) {
    if (isUserCancel(err)) return { data: null, error: null };
    return { data: null, error: err };
  }
}

// Cierre de sesión del plugin (best-effort). La sesión Supabase la cierra
// signOut() en auth.js; aquí solo limpiamos el estado del plugin nativo.
export async function nativeSignOut() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const SocialLogin = await plugin();
    await SocialLogin.logout({ provider: "google" });
  } catch {
    /* best-effort: si el logout del plugin falla, no rompemos el sign-out */
  }
}
```

- [ ] **Step 2: Build sanity (resuelve el import dinámico del plugin)**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...` sin errores de resolución de `@capgo/capacitor-social-login`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/nativeAuth.js
git commit -m "feat(auth): wrapper de sign-in nativo de Google (Capacitor + signInWithIdToken)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Helpers unificados `auth.js` (TDD)

**Files:**
- Create: `src/lib/auth.js`
- Test: `src/lib/auth.test.js`

- [ ] **Step 1: Escribir el test PRIMERO: `src/lib/auth.test.js`**

```js
// src/lib/auth.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Patrón del repo: vi.doMock + vi.resetModules + await import (entorno node).
function setup({ isNative }) {
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOutSb = vi.fn().mockResolvedValue({ error: null });
  const nativeGoogleSignIn = vi.fn().mockResolvedValue({ data: {}, error: null });
  const nativeSignOut = vi.fn().mockResolvedValue();
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => isNative },
  }));
  vi.doMock("../supabaseClient", () => ({
    supabase: { auth: { signInWithOAuth, signOut: signOutSb } },
  }));
  vi.doMock("./nativeAuth", () => ({ nativeGoogleSignIn, nativeSignOut }));
  return { signInWithOAuth, signOutSb, nativeGoogleSignIn, nativeSignOut };
}

describe("auth helpers", () => {
  beforeEach(() => vi.resetModules());

  it("web: signInWithGoogle usa signInWithOAuth de Supabase", async () => {
    const m = setup({ isNative: false });
    const { signInWithGoogle } = await import("./auth");
    await signInWithGoogle();
    expect(m.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
    expect(m.nativeGoogleSignIn).not.toHaveBeenCalled();
  });

  it("nativo: signInWithGoogle usa el flujo nativo", async () => {
    const m = setup({ isNative: true });
    const { signInWithGoogle } = await import("./auth");
    await signInWithGoogle();
    expect(m.nativeGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(m.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("web: signOut solo cierra la sesión Supabase", async () => {
    const m = setup({ isNative: false });
    const { signOut } = await import("./auth");
    await signOut();
    expect(m.signOutSb).toHaveBeenCalledTimes(1);
    expect(m.nativeSignOut).not.toHaveBeenCalled();
  });

  it("nativo: signOut cierra Supabase y además el plugin", async () => {
    const m = setup({ isNative: true });
    const { signOut } = await import("./auth");
    await signOut();
    expect(m.signOutSb).toHaveBeenCalledTimes(1);
    expect(m.nativeSignOut).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test → FAIL (módulo no existe)**

Run: `npx vitest run src/lib/auth.test.js`
Expected: FAIL (`Cannot find module './auth'`).

- [ ] **Step 3: Crear `src/lib/auth.js`**

```js
// src/lib/auth.js
// Helpers de autenticación unificados web/nativo. En web mantienen el flujo
// actual (signInWithOAuth redirect); en la app Android (Capacitor) usan el
// sign-in nativo de Google (selector de cuenta → signInWithIdToken). Centralizar
// aquí evita esparcir el branch por-plataforma en los componentes.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";
import { nativeGoogleSignIn, nativeSignOut } from "./nativeAuth";

export async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    return nativeGoogleSignIn();
  }
  return supabase.auth.signInWithOAuth({ provider: "google" });
}

export async function signOut() {
  const result = await supabase.auth.signOut();
  if (Capacitor.isNativePlatform()) {
    await nativeSignOut();
  }
  return result;
}
```

- [ ] **Step 4: Run test → PASS (4 tests)**

Run: `npx vitest run src/lib/auth.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.js src/lib/auth.test.js
git commit -m "feat(auth): helpers unificados signInWithGoogle/signOut (web + nativo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Cablear el botón de login en `App.jsx`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Importar el helper**

En la cabecera de imports de `src/App.jsx`, añade:
```js
import { signInWithGoogle } from "./lib/auth";
```

- [ ] **Step 2: Usar el helper en el botón de Google (~línea 371)**

Reemplaza:
```js
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
```
por:
```js
          onClick={signInWithGoogle}
```

- [ ] **Step 3: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.
Run: `grep -n "signInWithGoogle" src/App.jsx`
Expected: el import + el `onClick={signInWithGoogle}`.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(auth): el botón de login usa signInWithGoogle (nativo en la app)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Cablear el sign-out en `MyStats.jsx`

**Files:**
- Modify: `src/components/MyStats.jsx`

- [ ] **Step 1: Importar el helper**

En la cabecera de imports de `src/components/MyStats.jsx`, añade:
```js
import { signOut } from "../lib/auth";
```

- [ ] **Step 2: Usar el helper en `handleSignOut` (~línea 177)**

Reemplaza:
```js
    const { error } = await supabase.auth.signOut();
```
por:
```js
    const { error } = await signOut();
```
(El resto de `handleSignOut` —manejo de error, `onSignedOut`, `onClose`— se queda igual; `signOut()` devuelve el mismo `{ error }` de Supabase.)

- [ ] **Step 3: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.
Run: `grep -n "signOut" src/components/MyStats.jsx`
Expected: el import + `await signOut()` (ya no `supabase.auth.signOut`).

- [ ] **Step 4: Commit**

```bash
git add src/components/MyStats.jsx
git commit -m "feat(auth): sign-out unificado (también cierra el plugin nativo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Inicializar el plugin en el arranque (`index.jsx`)

**Files:**
- Modify: `src/index.jsx`

- [ ] **Step 1: Importar `initNativeAuth`**

En `src/index.jsx`, junto a los otros imports de `./lib/...`, añade:
```js
import { initNativeAuth } from "./lib/nativeAuth";
```

- [ ] **Step 2: Llamarlo dentro del bloque nativo existente**

Dentro del `if (Capacitor.isNativePlatform()) { ... }` que ya existe (el de `rearmIfEnabled` + `backButton`), añade como primera línea del bloque:
```js
  // Inicializa el plugin de login nativo (idempotente; no-op sin WEB_CLIENT_ID).
  initNativeAuth().catch(() => {});
```

- [ ] **Step 3: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.
Run: `grep -n "initNativeAuth" src/index.jsx`
Expected: el import + la llamada dentro del bloque nativo.

- [ ] **Step 4: Commit**

```bash
git add src/index.jsx
git commit -m "feat(auth): inicializar el plugin de login nativo en el arranque (solo nativo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Documentar el setup de OAuth (Google Cloud + Supabase + SHA-1)

**Files:**
- Modify: `docs/android-build-release.md`

- [ ] **Step 1: Añadir una sección de login nativo al doc de build**

Añade al final de `docs/android-build-release.md`:
````markdown
## Login Google nativo (v2) — setup de OAuth

La app usa `@capgo/capacitor-social-login` (selector de cuenta nativo) →
`supabase.auth.signInWithIdToken`. Requiere configurar OAuth (una vez):

1. **Google Cloud Console** (mismo proyecto que el OAuth web de Supabase):
   - APIs y servicios → Credenciales → Crear ID de cliente de OAuth → **Android**.
     - Nombre del paquete: `com.cochedeldia`.
     - **SHA-1** de la clave que firma el APK que pruebas:
       - Debug (emulador/dispositivo): `./gradlew signingReport` (en `android/`) o
         `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.
       - Release: añade también la SHA-1 del *upload key* y la de **Play App
         Signing** (Play Console → Configuración → Integridad de la app). Sin la
         SHA-1 correcta, el login falla solo en release ("va en debug, rompe en Play").
   - Anota el **Web client ID** existente (tipo "Aplicación web", el que usa Supabase).

2. **Supabase** → Authentication → Providers → **Google**:
   - Asegúrate de que el **Web client ID** está como Client ID, y añádelo a
     **"Authorized Client IDs"** (lista separada por comas) para que acepte el
     `idToken` nativo (cuyo `aud` = Web client ID).

3. **`.env`** (en el dir de build): `VITE_GOOGLE_WEB_CLIENT_ID=<web client id>` y
   recompila con `npm run cap:sync`.

> Sin `VITE_GOOGLE_WEB_CLIENT_ID` la app arranca igual pero el botón de login da
> error controlado y el juego sigue anónimo (no rompe).

**Prueba:** en el dispositivo, pulsa "Iniciar sesión" → elige cuenta → vuelves
logueado (ves tu racha/ranking). Sign-out desde "Mis estadísticas".
````

- [ ] **Step 2: Commit**

```bash
git add docs/android-build-release.md
git commit -m "docs(auth): guía de setup OAuth para el login Google nativo (SHA-1, Supabase)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Verificación final + PR

**Files:** (ninguno; verificación e integración)

- [ ] **Step 1: Suite completa verde**

Run: `npx vitest run && npm run test:security && npm run test:attacks`
Expected: 0 failed (incluye `src/lib/auth.test.js`).

- [ ] **Step 2: Build de producción**

Run: `npx vitest run && npx vite build 2>&1 | tail -5`
Expected: tests verdes + `built in ...`.

- [ ] **Step 3: Coherencia — web no cambia su login**

Run: `grep -rn "signInWithOAuth" src/`
Expected: aparece SOLO dentro de `src/lib/auth.js` (rama web) y en `src/admin/AdminTools.jsx` (admin, fuera de alcance). NO debe quedar en `src/App.jsx`.

- [ ] **Step 4: Sync del build dentro de android (para el AAB/prueba)**

Run: `npm run cap:sync 2>&1 | tail -4`
Expected: `Sync finished`, con `@capgo/capacitor-social-login` entre los plugins.

- [ ] **Step 5: Push y abrir el PR (claude/native-google-login → main)**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(auth): login Google nativo en la app Android (v2 sub-1)" \
  --body "$(cat <<'EOF'
## Resumen
Login con Google **dentro de la app Android**: helper unificado `signInWithGoogle()`/`signOut()` que en web mantiene `signInWithOAuth` (redirect) y en nativo usa `@capgo/capacitor-social-login` (selector nativo) → `supabase.auth.signInWithIdToken`. Todo gateado por `Capacitor.isNativePlatform()` → **la web no cambia**.

## Cambios
- `src/lib/nativeAuth.js` (sign-in nativo + init perezoso del plugin), `src/lib/auth.js` (helpers unificados) + test.
- Cableado: botón de login (`App.jsx`), sign-out (`MyStats.jsx`), init en arranque (`index.jsx`).
- `@capgo/capacitor-social-login` añadido; `VITE_GOOGLE_WEB_CLIENT_ID` documentado.
- Guía de setup OAuth (Google Cloud Android client + SHA-1 + Supabase Authorized Client IDs) en `docs/android-build-release.md`.

## Verificación
- `vitest` (incl. branching de auth), `test:security`, `test:attacks`, `vite build` verdes.
- Web: login sin cambios.
- App: requiere setup OAuth manual (doc) + prueba en dispositivo.

## Fuera de alcance
Push FCM (v2 sub-2) · iOS · migración progreso anónimo→cuenta · login en /admin.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR creado. Avisar "listo para mergear".

---

## Notas de ejecución
- **Verificación web** por `vite build` + suites + Preview de Vercel; el login nativo se prueba en Android Studio (no en el Preview) y requiere el setup OAuth del usuario (Task 7).
- El plugin se importa de forma **perezosa** y todo va detrás de `isNativePlatform()` → el bundle web no carga el plugin.
- `.env` debe tener `VITE_SUPABASE_*` (build) y, para el login, `VITE_GOOGLE_WEB_CLIENT_ID`. Sin este último, la app no rompe (login da error controlado).
- UTF-8 en comentarios/strings (regla 14).
