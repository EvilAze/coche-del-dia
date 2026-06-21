# App Android con Capacitor (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empaquetar la SPA existente como app Android (Capacitor, bundled, anónimo) con recordatorio diario local, migrando antes la sesión anónima de cookie a token para que funcione cross-origin.

**Architecture:** Un solo código. Fase 1 mueve el anti-trampa anónimo de cookie HttpOnly a un token HMAC en localStorage + header `X-Anon-Session` (verificable 100% en web). Fase 2 añade el shell Capacitor que empaqueta `build/`, absolutiza las URLs `/api/*` en nativo, abre CORS para el origen de la app y programa una notificación local diaria. Todo lo nativo va detrás de `Capacitor.isNativePlatform()` → la web es no-op.

**Tech Stack:** React 18 + Vite 8, Vercel Functions (Node + Edge), Supabase, Capacitor 7 (`@capacitor/android`, `@capacitor/local-notifications`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`), Vitest, scripts de seguridad propios.

**Decisiones fijadas:** `appId = com.cochedeldia` · `VITE_PROD_ORIGIN = https://cochedeldia.com` · recordatorio 10:00 hora local · `android/` commiteada en este repo · v1 anónimo (sin login Google) · notificación local diaria (push FCM = v2).

**Spec:** `docs/superpowers/specs/2026-06-19-android-app-capacitor-v1-design.md`

---

# FASE 1 — Anon-session: cookie → token (web)

Verificable por completo en web/Vercel. Los primitivos HMAC (`signAnonSession`/`verifyAnonSession`) NO cambian; solo cambia el transporte (header+body en vez de cookie).

## Task 1: Primitivo Node anon-session → token

**Files:**
- Modify: `api/_lib/anon-session.js`

- [ ] **Step 1: Reemplazar el cuerpo cookie por lectura de header**

Sustituye TODO el contenido de `api/_lib/anon-session.js` por:

```js
// api/_lib/anon-session.js
// Token firmado con HMAC-SHA256 que tracea el estado del jugador ANÓNIMO del
// coche del día. Antes era una cookie HttpOnly; ahora viaja en localStorage
// del cliente + header `X-Anon-Session`, y el servidor lo devuelve actualizado
// en el body de get-daily-car / validate-guess.
//
// Por qué el cambio: la app Android (Capacitor, origen https://localhost) habla
// con la API en cochedeldia.com → una cookie sería third-party (el WebView no
// las acepta y Chromium las retira). Un token en header no depende del origen y
// mantiene la MISMA garantía anti-trampa: la firma es server-side, el cliente no
// puede bajar `n` ni cambiar `s`.
//
// Contenido firmado: { d: "YYYY-MM-DD", n: 0..5, s: "playing"|"won"|"lost" }
//
// Nota de seguridad: a diferencia de la cookie HttpOnly, el token es legible por
// JS (localStorage). Riesgo acotado: solo gobierna el conteo de intentos de un
// día y sigue siendo infalsificable. Mismo patrón que los reveal/repesca tokens.

import crypto from "crypto";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";
// En Node, req.headers llega siempre en minúsculas.
export const ANON_HEADER_NAME = "x-anon-session";

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url");
}

/**
 * Firma un payload pequeño y devuelve `<body>.<sig>` (URL-safe).
 * Lanza si el secreto no está configurado.
 */
export function signAnonSession(payload) {
  if (!SECRET) throw new Error("REPESCA_TOKEN_SECRET not configured");
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verifica y parsea el token. Devuelve `null` si el secreto no está
 * configurado, si el formato es inválido, o si la firma no coincide.
 */
export function verifyAnonSession(token) {
  if (!SECRET || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  // Comparación constant-time para evitar timing attacks.
  let a, b;
  try {
    a = b64urlDecode(sig);
    b = b64urlDecode(expected);
  } catch {
    return null;
  }
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Lee y verifica el token de sesión anónima del header X-Anon-Session.
 * Devuelve el payload `{d, n, s}` o null.
 */
export function readAnonToken(req) {
  const raw = req?.headers?.[ANON_HEADER_NAME];
  return verifyAnonSession(typeof raw === "string" ? raw : "");
}
```

- [ ] **Step 2: Verificar que no quedan importadores rotos (se arreglan en Tasks 4, 5, 8)**

Run: `grep -rn "buildSetCookie\|setAnonCookie\|readAnonSession\|parseCookies\|ANON_COOKIE_NAME" api/ scripts/ --include=*.js --include=*.mjs | grep -v "edge/anon-session"`
Expected: aparecen referencias en `api/validate-guess.js`, `api/daily-image.js`, `scripts/test-security.mjs`, `scripts/test-attacks.mjs` (se corrigen en sus tasks). NO debe aparecer ninguna en `api/_lib/anon-session.js`.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/anon-session.js
git commit -m "refactor(anon): primitivo Node de sesión anónima de cookie a token (header)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Primitivo Edge anon-session → token

**Files:**
- Modify: `api/_lib/edge/anon-session.js`

- [ ] **Step 1: Sustituir helpers de cookie por lectura de header**

En `api/_lib/edge/anon-session.js`, elimina `ANON_COOKIE_NAME`, `parseCookiesFromHeader`, `readAnonSession` y `buildSetCookie`, y añade el header + lectura. Resultado final del archivo:

```js
// api/_lib/edge/anon-session.js
// Versión Edge-runtime del token de sesión anónima (api/_lib/anon-session.js).
// Mismo formato de wire que la versión Node, así que tokens firmados por una
// los verifica la otra. Diferencias: firma/verificación con Web Crypto
// (asíncrono) y lectura desde `Request` (Fetch API).

import {
  b64urlEncodeString,
  b64urlDecodeToBytes,
  b64urlDecodeToString,
  hmacSha256Base64Url,
  timingSafeEqualBytes,
} from "./crypto.js";

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";
// Mismo nombre lógico que en Node; Request.headers.get() es case-insensitive.
export const ANON_HEADER_NAME = "x-anon-session";

/**
 * Firma `{d, n, s}` y devuelve `<body>.<sig>` (URL-safe).
 * Lanza si el secreto no está configurado.
 */
export async function signAnonSession(payload) {
  const secret = SECRET();
  if (!secret) throw new Error("REPESCA_TOKEN_SECRET not configured");
  const body = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verifica y parsea el token. Devuelve null si el secreto no está configurado,
 * si el formato es inválido, o si la firma no coincide.
 */
export async function verifyAnonSession(token) {
  const secret = SECRET();
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSha256Base64Url(secret, body);
  let a, b;
  try {
    a = b64urlDecodeToBytes(sig);
    b = b64urlDecodeToBytes(expected);
  } catch {
    return null;
  }
  if (!timingSafeEqualBytes(a, b)) return null;
  try {
    return JSON.parse(b64urlDecodeToString(body));
  } catch {
    return null;
  }
}

/**
 * Lee y verifica el token de sesión anónima del header X-Anon-Session de un
 * Request (Fetch API). Devuelve el payload `{d, n, s}` o null.
 */
export async function readAnonTokenFromRequest(request) {
  const raw = request.headers.get(ANON_HEADER_NAME) || "";
  return await verifyAnonSession(raw);
}
```

- [ ] **Step 2: Commit**

```bash
git add api/_lib/edge/anon-session.js
git commit -m "refactor(anon): primitivo Edge de sesión anónima de cookie a token (header)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `get-daily-car` (Edge) — leer token de header, devolver `anonToken` en body

**Files:**
- Modify: `api/get-daily-car.js`

- [ ] **Step 1: Cambiar el import (línea 39)**

Reemplaza:
```js
import { readAnonSession, buildSetCookie } from "./_lib/edge/anon-session.js";
```
por:
```js
import { readAnonTokenFromRequest, signAnonSession } from "./_lib/edge/anon-session.js";
```

- [ ] **Step 2: Reescribir la rama anónima (líneas 210-252)**

Reemplaza todo el bloque `// -------- RAMA ANÓNIMA ----` (desde `if (!user) {` hasta su `return ...;` y la `}` de cierre) por:

```js
  // -------- RAMA ANÓNIMA -------------------------------------------------
  if (!user) {
    // Token de sesión anónima firmado (HMAC). Antes era una cookie HttpOnly;
    // ahora viaja en el body para que la app Android (origen distinto) no
    // dependa de cookies cross-site. El cliente lo guarda en localStorage y lo
    // reenvía en el header X-Anon-Session.
    const incoming = await readAnonTokenFromRequest(request);
    const valid =
      incoming &&
      incoming.d === today &&
      Number.isInteger(incoming.n) &&
      typeof incoming.s === "string";

    const session = valid ? incoming : { d: today, n: 0, s: "playing" };

    let anonToken = null;
    try {
      anonToken = await signAnonSession(session);
    } catch (err) {
      // Si REPESCA_TOKEN_SECRET no está configurado, el usuario juega sin
      // token; validate-guess se quejará pero la home no rompe.
      console.error("[get-daily-car] signAnonSession:", err?.message || err);
    }

    // Asimetría intencional con el caso "lost": solo firmamos revealToken al
    // anónimo que GANÓ, para no regalarle la imagen completa al perdedor.
    let revealToken = null;
    if (valid && session.s === "won") {
      try {
        revealToken = await signRevealToken(today);
      } catch (err) {
        console.error("[get-daily-car] signRevealToken (anon):", err?.message || err);
      }
    }

    return jsonResponse({ ...base, anonToken, revealToken });
  }
```

- [ ] **Step 3: Build sanity (el módulo Edge parsea)**

Run: `npx vite build 2>&1 | tail -5`
Expected: `built in ...` sin errores de import/sintaxis.

- [ ] **Step 4: Commit**

```bash
git add api/get-daily-car.js
git commit -m "refactor(anon): get-daily-car emite anonToken en body en vez de Set-Cookie

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `validate-guess` (Node) — leer token de header, devolver `anonToken` en body

**Files:**
- Modify: `api/validate-guess.js`

- [ ] **Step 1: Cambiar el import (línea 14)**

Reemplaza:
```js
import { readAnonSession, setAnonCookie } from "./_lib/anon-session.js";
```
por:
```js
import { readAnonToken, signAnonSession } from "./_lib/anon-session.js";
```

- [ ] **Step 2: Cambiar la lectura (línea ~170)**

Reemplaza:
```js
      anonSession = readAnonSession(req);
```
por:
```js
      anonSession = readAnonToken(req);
```

- [ ] **Step 3: Sustituir la escritura de cookie por cálculo de token (líneas ~337-344)**

Reemplaza el bloque:
```js
    if (!user && anonSession) {
      try {
        setAnonCookie(res, { d: today, n: attemptNumber, s: newStatus });
      } catch (err) {
        console.error("[validate-guess] setAnonCookie:", err?.message || err);
      }
    }
```
por:
```js
    // Token anónimo actualizado: lo devolvemos en el body (antes era Set-Cookie).
    // El cliente lo persiste en localStorage y lo reenvía en el próximo intento.
    let anonToken = null;
    if (!user && anonSession) {
      try {
        anonToken = signAnonSession({ d: today, n: attemptNumber, s: newStatus });
      } catch (err) {
        console.error("[validate-guess] signAnonSession:", err?.message || err);
      }
    }
```

- [ ] **Step 4: Añadir `anonToken` a la respuesta (línea ~378)**

Reemplaza:
```js
    return res.status(200).json({
      result,
      win: result.win,
      status: newStatus,
      attemptNumber,
      reveal,
      revealToken,
      score,
    });
```
por:
```js
    return res.status(200).json({
      result,
      win: result.win,
      status: newStatus,
      attemptNumber,
      reveal,
      revealToken,
      anonToken,
      score,
    });
```

- [ ] **Step 5: Commit**

```bash
git add api/validate-guess.js
git commit -m "refactor(anon): validate-guess lee token de header y lo devuelve en body

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `daily-image` (Node) — eliminar dependencia de cookie anónima

El reveal del anónimo ganador ya va por el reveal token (`&t=`); la lectura de cookie era defensa redundante.

**Files:**
- Modify: `api/daily-image.js`

- [ ] **Step 1: Quitar el import (línea 29)**

Elimina la línea:
```js
import { readAnonSession } from "./_lib/anon-session.js";
```

- [ ] **Step 2: Eliminar el bloque de reveal por cookie (líneas ~199-209)**

Elimina por completo:
```js
  if (!canReveal) {
    const anon = readAnonSession(req);
    // Asimetría intencional: solo el anónimo que GANÓ desbloquea por cookie.
    // Si perdió (s === "lost"), mantenemos el crop de seguridad: revelarle
    // la imagen completa equivaldría a regalarle el coche, justo el cheat
    // que cerramos en validate-guess (no firmar revealToken al anon-lost).
    // Aquí completamos la defensa: cualquier otra vía a /api/daily-image
    // que dependiera de la cookie también queda bloqueada.
    if (anon && anon.d === today && anon.s === "won") {
      canReveal = true;
    }
  }
```

- [ ] **Step 3: Verificar que `readAnonSession` ya no se referencia**

Run: `grep -n "readAnonSession\|anon" api/daily-image.js`
Expected: sin referencias a `readAnonSession` (puede quedar texto en comentarios de "anon" no relacionados).

- [ ] **Step 4: Commit**

```bash
git add api/daily-image.js
git commit -m "refactor(anon): daily-image deja de leer cookie (reveal va por reveal token)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Cliente — store de token anónimo en localStorage

**Files:**
- Create: `src/lib/anonSession.js`
- Test: `src/lib/anonSession.test.js`

- [ ] **Step 1: Escribir el test (falla primero)**

```js
// src/lib/anonSession.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";

// vitest corre en entorno "node" → no hay localStorage. Lo stubbeamos.
function installLocalStorageStub() {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
}

describe("anonSession", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageStub();
  });

  it("getAnonToken devuelve '' si no hay nada", async () => {
    const { getAnonToken } = await import("./anonSession");
    expect(getAnonToken()).toBe("");
  });

  it("setAnonToken persiste y getAnonToken lo lee", async () => {
    const { getAnonToken, setAnonToken } = await import("./anonSession");
    setAnonToken("body.sig");
    expect(getAnonToken()).toBe("body.sig");
  });

  it("setAnonToken ignora valores vacíos o no-string", async () => {
    const { getAnonToken, setAnonToken } = await import("./anonSession");
    setAnonToken("");
    setAnonToken(null);
    setAnonToken(123);
    expect(getAnonToken()).toBe("");
  });

  it("anonHeaders incluye el header sólo si hay token", async () => {
    const { anonHeaders, setAnonToken, ANON_HEADER } = await import("./anonSession");
    expect(anonHeaders()).toEqual({});
    setAnonToken("body.sig");
    expect(anonHeaders()).toEqual({ [ANON_HEADER]: "body.sig" });
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run src/lib/anonSession.test.js`
Expected: FAIL (`Cannot find module './anonSession'`).

- [ ] **Step 3: Implementar**

```js
// src/lib/anonSession.js
// Token de sesión anónima del coche del día. Lo emite el servidor firmado
// (HMAC) y lo guardamos en localStorage para reenviarlo en el header
// X-Anon-Session en get-daily-car y validate-guess. Sustituye a la cookie
// HttpOnly anterior: la app Android (origen distinto a la API) no puede
// depender de cookies cross-site. Para usuarios logueados no se usa (su estado
// vive server-side en user_guesses).

const STORAGE_KEY = "cd_anon_token";
export const ANON_HEADER = "X-Anon-Session";

export function getAnonToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setAnonToken(token) {
  if (!token || typeof token !== "string") return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // modo privado / storage lleno: el servidor regenerará el token en la
    // próxima petición. No rompemos el juego.
  }
}

/**
 * Cabeceras para una request anónima al API. Objeto vacío si aún no hay token
 * (primera visita): get-daily-car lo creará y devolverá uno.
 */
export function anonHeaders() {
  const token = getAnonToken();
  return token ? { [ANON_HEADER]: token } : {};
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run src/lib/anonSession.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/anonSession.js src/lib/anonSession.test.js
git commit -m "feat(anon): store cliente del token anónimo (localStorage + header)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `useGame` — enviar `X-Anon-Session` y persistir `anonToken`

**Files:**
- Modify: `src/hooks/useGame.js`

- [ ] **Step 1: Añadir el import**

Cerca de los demás imports de `src/hooks/useGame.js`, añade:
```js
import { anonHeaders, setAnonToken } from "../lib/anonSession";
```

- [ ] **Step 2: get-daily-car — añadir header y persistir token (líneas ~275-288)**

Reemplaza:
```js
        const headers = {};
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const res = await fetch("/api/get-daily-car", {
          headers,
          // credentials same-origin: la cookie firmada `cd_anon` que emite
          // el endpoint para anónimos viaja en este round-trip y todas las
          // peticiones posteriores. Sin esto, los anónimos no podrían
          // jugar (validate-guess exige cookie de sesión).
          credentials: "same-origin",
        });
        const daily = await res.json();
```
por:
```js
        // Token anónimo (si lo hay) en el header X-Anon-Session. Sustituye a la
        // cookie cross-site: la app Android habla con la API en otro origen.
        const headers = { ...anonHeaders() };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const res = await fetch("/api/get-daily-car", { headers });
        const daily = await res.json();
        // El servidor devuelve el token (nuevo o renovado): lo persistimos.
        if (daily?.anonToken) setAnonToken(daily.anonToken);
```

- [ ] **Step 3: validate-guess — añadir header y persistir token (líneas ~399-411)**

Reemplaza:
```js
      const headers = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      response = await fetch("/api/validate-guess", {
        method: "POST",
        headers,
        // credentials same-origin: imprescindible para anónimos — la
        // cookie HttpOnly `cd_anon` es la fuente de verdad del contador
        // de intentos server-side. Sin esto el endpoint rechazaría con
        // "Anon session missing".
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
```
por:
```js
      const headers = { "Content-Type": "application/json", ...anonHeaders() };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      response = await fetch("/api/validate-guess", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
```

- [ ] **Step 4: validate-guess — persistir el token devuelto tras parsear `data`**

Justo después del bloque `try { data = await response.json(); } catch (...) {...}` (donde `data` ya está disponible), añade:
```js
    // Token anónimo renovado tras el intento: lo persistimos para el siguiente.
    if (data?.anonToken) setAnonToken(data.anonToken);
```

- [ ] **Step 5: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...` sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useGame.js
git commit -m "feat(anon): useGame envía X-Anon-Session y persiste el anonToken

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Actualizar scripts de seguridad al modelo token

**Files:**
- Modify: `scripts/test-security.mjs`
- Modify: `scripts/test-attacks.mjs`

- [ ] **Step 1: `test-security.mjs` — quitar imports y asserts de cookie**

Reemplaza el import (líneas 19-25):
```js
const {
  signAnonSession,
  verifyAnonSession,
  parseCookies,
  buildSetCookie,
  ANON_COOKIE_NAME,
} = await import("../api/_lib/anon-session.js");
```
por:
```js
const {
  signAnonSession,
  verifyAnonSession,
  readAnonToken,
  ANON_HEADER_NAME,
} = await import("../api/_lib/anon-session.js");
```

- [ ] **Step 2: `test-security.mjs` — sustituir el bloque `buildSetCookie` y el bloque `parseCookies`**

Elimina el bloque que verifica `buildSetCookie` (el `{ const sc = buildSetCookie(...) ... }`) y el bloque siguiente que usa `parseCookies`/`ANON_COOKIE_NAME`, y en su lugar añade un bloque que valida la lectura del token por header:

```js
{
  // El token de sesión anónima ahora viaja por header X-Anon-Session, no por
  // cookie. readAnonToken lee y verifica ese header.
  const token = signAnonSession({ d: "2026-05-20", n: 1, s: "playing" });
  const req = { headers: { [ANON_HEADER_NAME]: token } };
  eq("readAnonToken verifica el header válido", readAnonToken(req), {
    d: "2026-05-20",
    n: 1,
    s: "playing",
  });
  falsy(
    "readAnonToken con header ausente → null",
    readAnonToken({ headers: {} })
  );
  falsy(
    "readAnonToken con token forjado → null",
    readAnonToken({ headers: { [ANON_HEADER_NAME]: "garbage.sig" } })
  );
}
```

- [ ] **Step 3: `test-attacks.mjs` — quitar `ANON_COOKIE_NAME` del import**

Reemplaza (líneas 21-23):
```js
const { signAnonSession, verifyAnonSession, ANON_COOKIE_NAME } = await import(
  "../api/_lib/anon-session.js"
);
```
por:
```js
const { signAnonSession, verifyAnonSession } = await import(
  "../api/_lib/anon-session.js"
);
```

- [ ] **Step 4: `test-attacks.mjs` — alinear ATAQUE 1 con daily-image sin cookie**

`daily-image` ya no concede reveal por sesión anónima (solo por reveal token). Actualiza `computeCanReveal` para eliminar la rama de cookie (deja branch 1 = `t=`), y reemplaza los escenarios B, C, D, "D.bis" y E (los que pasaban `cookieValue`) por una nota + un escenario que confirme que la sesión anónima ya NO revela:

Reemplaza el cuerpo de `computeCanReveal` por:
```js
function computeCanReveal({ tParam = null, today }) {
  // Branch 1: ?t=<reveal token> firmado por nosotros para HOY.
  if (tParam) {
    const tokenDate = verifyRevealToken(tParam);
    if (tokenDate === today) return true;
  }
  // Branch 2: Bearer con user_guesses.status — no testable sin Supabase.
  // (La rama de sesión anónima por cookie se eliminó: el anónimo ganador
  //  revela vía reveal token, igual que el logueado.)
  return false;
}
```

Y sustituye los escenarios B–E de "[ATAQUE 1]" (los que construían `signAnonSession(...)` y los pasaban como `cookieValue`) por:
```js
// La sesión anónima ya NO desbloquea la imagen por sí sola (se migró de cookie
// a token y daily-image dejó de leerla). El único desbloqueo es el reveal token.
check(
  "sesión anónima sola → canReveal=false (sin reveal token)",
  computeCanReveal({ today: TODAY }) === false
);
```

(Los escenarios F en adelante, que usan `?t=` con `signRevealToken`, se mantienen sin cambios.)

- [ ] **Step 5: `test-attacks.mjs` — ATAQUE 3 sigue válido**

El bloque "[ATAQUE 3]" usa `signAnonSession`/`verifyAnonSession` (primitivos intactos) y no menciona la cookie en su lógica — déjalo igual. (El comentario "Cookie anon spoof" es cosmético; opcionalmente cámbialo a "Token anon spoof".)

- [ ] **Step 6: Run ambas suites → PASS**

Run: `npm run test:security && npm run test:attacks`
Expected: ambas terminan con `N/N passed` y exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/test-security.mjs scripts/test-attacks.mjs
git commit -m "test(anon): suites de seguridad al modelo token (header) sin cookie

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Checkpoint Fase 1 — verificación web completa

**Files:** (ninguno; solo verificación)

- [ ] **Step 1: Unit tests**

Run: `npm run test:unit`
Expected: PASS, incluyendo `src/lib/anonSession.test.js`.

- [ ] **Step 2: Suites de seguridad**

Run: `npm run test:security && npm run test:attacks`
Expected: 0 failed en ambas.

- [ ] **Step 3: Build de producción (mismo comando que Vercel: vitest + vite)**

Run: `npx vitest run && npx vite build 2>&1 | tail -5`
Expected: tests verdes + `built in ...`.

- [ ] **Step 4: Grep final — cero referencias muertas a la cookie**

Run: `grep -rn "cd_anon\|buildSetCookie\|setAnonCookie\|ANON_COOKIE_NAME\|readAnonSession\b" api/ src/ scripts/ --include=*.js --include=*.jsx --include=*.mjs`
Expected: sin resultados.

> **Punto de validación en Vercel:** tras pushear hasta aquí, el Preview debe permitir jugar una partida anónima completa (5 intentos, victoria/derrota) en el navegador. La sesión anónima ahora va por token; si esto funciona en web, la Fase 2 solo añade la cáscara.

---

# FASE 2 — App Android (Capacitor, bundled)

## Task 10: Instalar Capacitor y añadir scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar dependencias**

Run:
```bash
npm install @capacitor/core @capacitor/local-notifications @capacitor/app @capacitor/status-bar @capacitor/splash-screen
npm install -D @capacitor/cli @capacitor/android @capacitor/assets
```
Expected: instala sin errores; aparecen en `package.json`.

- [ ] **Step 2: Añadir scripts npm**

En `package.json`, dentro de `"scripts"`, añade:
```json
    "cap:sync": "vite build && cap sync android",
    "cap:open": "cap open android",
    "cap:assets": "capacitor-assets generate --android"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(cap): añadir dependencias Capacitor y scripts cap:sync/open/assets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Config de Capacitor + plataforma Android

**Files:**
- Create: `capacitor.config.json`
- Create: `android/` (generada por `npx cap add android`)

- [ ] **Step 1: Crear `capacitor.config.json`**

```json
{
  "appId": "com.cochedeldia",
  "appName": "Coche del Día",
  "webDir": "build",
  "android": {
    "backgroundColor": "#0d1014"
  },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 800,
      "backgroundColor": "#0d1014",
      "showSpinner": false
    },
    "StatusBar": {
      "style": "DARK",
      "backgroundColor": "#0d1014"
    }
  }
}
```

- [ ] **Step 2: Generar el build y añadir la plataforma Android**

Run:
```bash
npx vite build
npx cap add android
```
Expected: crea la carpeta `android/` (proyecto Gradle) y termina con `cap sync` OK (`Sync finished`).

- [ ] **Step 3: Verificar appId**

Run: `grep -rn "com.cochedeldia" android/app/build.gradle android/app/src/main/ 2>/dev/null | head`
Expected: `applicationId "com.cochedeldia"` y el `namespace`/package en `com.cochedeldia`.

- [ ] **Step 4: Commit (incluye `android/`)**

```bash
git add capacitor.config.json android/
git commit -m "feat(cap): config Capacitor (com.cochedeldia) y plataforma Android bundled

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Helper de CORS compartido + `applyCors` (Node)

**Files:**
- Create: `api/_lib/cors.js`
- Modify: `api/_lib/http.js`
- Test: `api/_lib/http.cors.test.js`

- [ ] **Step 1: Crear `api/_lib/cors.js`**

```js
// api/_lib/cors.js
// Allowlist de orígenes para CORS. Solo la app Android (Capacitor) necesita
// CORS: la web es same-origin. Como la sesión anónima viaja por header
// X-Anon-Session (no por cookie), NO usamos credenciales → nunca "*" pero
// tampoco Allow-Credentials. Módulo puro (edge-safe, sin APIs de Node).

export const ALLOWED_APP_ORIGINS = ["https://localhost"];

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && ALLOWED_APP_ORIGINS.includes(origin);
}

export const CORS_ALLOW_HEADERS = "Content-Type, Authorization, X-Anon-Session";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
```

- [ ] **Step 2: Escribir el test (falla primero)**

```js
// api/_lib/http.cors.test.js
import { describe, it, expect, vi } from "vitest";
import { applyCors } from "./http.js";

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader: (k, v) => (headers[k] = v),
    end: vi.fn(),
  };
}

describe("applyCors", () => {
  it("origen permitido → setea headers CORS", () => {
    const res = mockRes();
    const handled = applyCors({ method: "GET", headers: { origin: "https://localhost" } }, res);
    expect(handled).toBe(false);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("X-Anon-Session");
  });

  it("origen NO permitido (web same-origin) → no añade ACAO", () => {
    const res = mockRes();
    const handled = applyCors({ method: "GET", headers: { origin: "https://cochedeldia.com" } }, res);
    expect(handled).toBe(false);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("preflight OPTIONS desde origen permitido → 204 y handled=true", () => {
    const res = mockRes();
    const handled = applyCors({ method: "OPTIONS", headers: { origin: "https://localhost" } }, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test → FAIL**

Run: `npx vitest run api/_lib/http.cors.test.js`
Expected: FAIL (`applyCors is not a function`).

- [ ] **Step 4: Añadir `applyCors` a `api/_lib/http.js`**

Al principio del archivo (tras la cabecera de comentarios) añade el import:
```js
import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./cors.js";
```
Y al final del archivo añade:
```js
/**
 * Aplica CORS para la app Android (origen https://localhost). En web
 * (same-origin) el Origin no está en la allowlist → no añade nada. Llamar
 * ANTES de methodGuard. Devuelve true si ya respondió el preflight OPTIONS
 * (el handler debe `return` inmediatamente).
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @returns {boolean}
 */
export function applyCors(req, res) {
  const origin = req?.headers?.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Run test → PASS**

Run: `npx vitest run api/_lib/http.cors.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add api/_lib/cors.js api/_lib/http.js api/_lib/http.cors.test.js
git commit -m "feat(cap): helper CORS compartido + applyCors para la app Android

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Aplicar CORS a los endpoints Node del juego

**Files:**
- Modify: `api/validate-guess.js`, `api/list-cars.js`, `api/daily-stats.js`, `api/garage.js`

- [ ] **Step 1: Importar `applyCors` en cada uno**

En cada archivo, en la línea de import desde `./_lib/http.js`, añade `applyCors`. Ejemplos:
- `api/validate-guess.js`: `import { parseBody, methodGuard, applyCors } from "./_lib/http.js";`
- `api/list-cars.js`: `import { methodGuard, applyCors } from "./_lib/http.js";`
- `api/daily-stats.js`: `import { methodGuard, applyCors } from "./_lib/http.js";`
- `api/garage.js`: `import { methodGuard, applyCors } from "./_lib/http.js";`

- [ ] **Step 2: Llamar `applyCors` ANTES de `methodGuard` en cada handler**

En cada `export default ... handler(req, res) {`, como PRIMERA línea del cuerpo (antes del `methodGuard`), añade:
```js
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
```
Por ejemplo en `api/list-cars.js`:
```js
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (methodGuard(req, res, "GET")) return;
```
(Idéntico patrón en los otros tres, respetando los métodos que ya declara cada `methodGuard`.)

- [ ] **Step 3: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.

- [ ] **Step 4: Suites de seguridad siguen verdes**

Run: `npm run test:security && npm run test:attacks`
Expected: 0 failed (CORS es aditivo, no cambia la lógica de juego).

- [ ] **Step 5: Commit**

```bash
git add api/validate-guess.js api/list-cars.js api/daily-stats.js api/garage.js
git commit -m "feat(cap): CORS en endpoints Node del juego para el origen de la app

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Aplicar CORS al endpoint Edge `get-daily-car`

**Files:**
- Modify: `api/get-daily-car.js`

- [ ] **Step 1: Importar helpers CORS**

Junto a los demás imports, añade:
```js
import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./_lib/cors.js";
```

- [ ] **Step 2: Añadir un helper local de headers CORS (junto a `jsonResponse`)**

```js
// CORS para la app Android (origen https://localhost). En web (same-origin)
// devuelve {} → no añade headers.
function corsHeadersFor(request) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}
```

- [ ] **Step 3: Preflight + wrapper de respuesta al inicio del handler**

Como PRIMERAS líneas dentro de `export default async function handler(request) {`:
```js
  // Preflight CORS de la app Android.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  }
  const cors = corsHeadersFor(request);
  // respond(): como jsonResponse pero mezclando los headers CORS.
  const respond = (body, init = {}) =>
    jsonResponse(body, { ...init, headers: { ...cors, ...(init.headers || {}) } });
```

- [ ] **Step 4: Usar `respond` en todos los returns del handler**

Dentro de `handler`, reemplaza cada `return jsonResponse(` por `return respond(`. (Son los returns de error 500, 429, el de la rama anónima y el final de la rama logueada.) Deja la definición de `jsonResponse` intacta.

- [ ] **Step 5: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.

- [ ] **Step 6: Commit**

```bash
git add api/get-daily-car.js
git commit -m "feat(cap): CORS + preflight en get-daily-car (Edge) para la app Android

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: Helper `apiUrl()` + shim de fetch

**Files:**
- Create: `src/lib/apiUrl.js`
- Test: `src/lib/apiUrl.test.js`

- [ ] **Step 1: Escribir el test (falla primero)**

```js
// src/lib/apiUrl.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("apiUrl", () => {
  beforeEach(() => vi.resetModules());

  it("web (no nativo): deja las rutas /api relativas", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { apiUrl } = await import("./apiUrl");
    expect(apiUrl("/api/get-daily-car")).toBe("/api/get-daily-car");
  });

  it("nativo: absolutiza /api con el origen de producción", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { apiUrl, PROD_ORIGIN } = await import("./apiUrl");
    expect(apiUrl("/api/get-daily-car")).toBe(`${PROD_ORIGIN}/api/get-daily-car`);
  });

  it("nativo: no toca URLs que no empiezan por /api", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { apiUrl } = await import("./apiUrl");
    expect(apiUrl("https://x.supabase.co/rest")).toBe("https://x.supabase.co/rest");
    expect(apiUrl("/brands/audi.png")).toBe("/brands/audi.png");
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run src/lib/apiUrl.test.js`
Expected: FAIL (`Cannot find module './apiUrl'`).

- [ ] **Step 3: Implementar**

```js
// src/lib/apiUrl.js
// En la app Android (Capacitor) el build viaja empaquetado y el origen del
// WebView es https://localhost, así que las rutas relativas `/api/*` no
// resuelven. apiUrl() las absolutiza al dominio de producción SOLO en nativo;
// en web son no-op (siguen relativas, como hoy). installApiFetchShim() aplica
// lo mismo de forma transparente a window.fetch para no tocar los ~20 call
// sites. Las URLs de imagen `/api/*` (CarImage, preload) usan apiUrl()
// directamente porque el shim no afecta al `src` de <img>.

import { Capacitor } from "@capacitor/core";

export const PROD_ORIGIN =
  import.meta.env.VITE_PROD_ORIGIN || "https://cochedeldia.com";

export function apiUrl(path) {
  if (typeof path !== "string") return path;
  if (Capacitor.isNativePlatform() && path.startsWith("/api")) {
    return PROD_ORIGIN + path;
  }
  return path;
}

export function installApiFetchShim() {
  if (!Capacitor.isNativePlatform()) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api")) {
      return orig(PROD_ORIGIN + input, init);
    }
    return orig(input, init);
  };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run src/lib/apiUrl.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/apiUrl.js src/lib/apiUrl.test.js
git commit -m "feat(cap): apiUrl() + shim de fetch para absolutizar /api en nativo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Instalar el shim en el arranque

**Files:**
- Modify: `src/index.jsx`

- [ ] **Step 1: Importar e instalar el shim antes del render**

En `src/index.jsx`, junto a los imports de `initSentry`/`reportWebVitals`, añade:
```js
import { installApiFetchShim } from "./lib/apiUrl";
```
Y justo después de `initSentry();` (línea 14), añade:
```js
// En la app Android (Capacitor) reescribe las rutas /api relativas al dominio
// de producción. En web es no-op.
installApiFetchShim();
```

- [ ] **Step 2: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.

- [ ] **Step 3: Commit**

```bash
git add src/index.jsx
git commit -m "feat(cap): instalar el shim de fetch /api en el arranque (solo nativo)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 17: `CarImage` — absolutizar URLs de imagen `/api/*`

**Files:**
- Modify: `src/components/CarImage.jsx`

- [ ] **Step 1: Importar `apiUrl`**

En la cabecera de imports de `src/components/CarImage.jsx`, añade:
```js
import { apiUrl } from "../lib/apiUrl";
```

- [ ] **Step 2: Calcular `proxBase` junto a `isApiProxy` (línea ~136)**

Justo después de:
```js
  const isApiProxy = typeof src === "string" && src.startsWith("/api/");
```
añade:
```js
  // En nativo, las URLs del proxy se absolutizan al dominio de producción
  // (el <img> no pasa por el shim de fetch). `isApiProxy` se calcula sobre el
  // `src` ORIGINAL relativo, así la detección no se rompe al absolutizar.
  const proxBase = isApiProxy ? apiUrl(src) : src;
```

- [ ] **Step 3: Usar `proxBase` en los constructores de srcSet/src**

Reemplaza `${src}` por `${proxBase}` en TODAS las plantillas que construyen `srcSet`/`src` del `<picture>` y del lightbox (líneas ~289, 296, 306-309, 472, 479, 484). Ejemplo (línea 289):
```js
            srcSet={`${proxBase}&f=avif&w=640 640w, ${proxBase}&f=avif&w=1280 1280w, ${proxBase}&f=avif&w=1920 1920w`}
```
y el `src` JPEG fallback (línea 306):
```js
          src={isApiProxy ? `${proxBase}&f=jpeg&w=1280` : src}
```
(NO cambies los usos de `src` en efectos/deps/`Boolean(src)`/`!src` — esos siguen con `src`.)

- [ ] **Step 4: Verificar que no quedan `${src}` en plantillas de URL**

Run: `grep -n '\${src}&f=' src/components/CarImage.jsx`
Expected: sin resultados (todas migradas a `${proxBase}`).

- [ ] **Step 5: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.

- [ ] **Step 6: Commit**

```bash
git add src/components/CarImage.jsx
git commit -m "feat(cap): CarImage absolutiza las URLs /api de imagen en nativo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 18: `App.jsx` — absolutizar el preload de imagen

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Importar `apiUrl`**

En la cabecera de imports de `src/App.jsx`, añade:
```js
import { apiUrl } from "./lib/apiUrl";
```

- [ ] **Step 2: Absolutizar el `imageSrcset` del preload (línea ~297)**

Reemplaza:
```js
    link.imageSrcset = `${car.img}&f=avif&w=640 640w, ${car.img}&f=avif&w=1280 1280w, ${car.img}&f=avif&w=1920 1920w`;
```
por:
```js
    // En nativo el preload debe apuntar al dominio de producción (igual que
    // CarImage), o el navegador descarga una URL que no existe en localhost.
    const preBase = apiUrl(car.img);
    link.imageSrcset = `${preBase}&f=avif&w=640 640w, ${preBase}&f=avif&w=1280 1280w, ${preBase}&f=avif&w=1920 1920w`;
```

- [ ] **Step 3: Build sanity**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(cap): App preload de imagen absolutiza /api en nativo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 19: Wrapper de notificaciones locales

**Files:**
- Create: `src/lib/notifications.js`
- Test: `src/lib/notifications.test.js`

- [ ] **Step 1: Escribir el test (falla primero)**

```js
// src/lib/notifications.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("notifications", () => {
  beforeEach(() => vi.resetModules());

  it("en web (no nativo) las operaciones son no-op y no lanzan", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const n = await import("./notifications");
    expect(n.isNative()).toBe(false);
    await expect(n.scheduleDailyReminder({ title: "t", body: "b" })).resolves.toBeUndefined();
    await expect(n.rearmIfEnabled({ title: "t", body: "b" })).resolves.toBeUndefined();
    expect(n.REMINDER_HOUR).toBe(10);
  });

  it("nativo + permiso concedido: rearmIfEnabled programa con id fijo", async () => {
    const schedule = vi.fn().mockResolvedValue();
    const cancel = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        schedule,
        cancel,
      },
    }));
    const n = await import("./notifications");
    await n.rearmIfEnabled({ title: "Hoy hay coche", body: "Juega" });
    expect(schedule).toHaveBeenCalledTimes(1);
    const arg = schedule.mock.calls[0][0].notifications[0];
    expect(arg.id).toBe(n.REMINDER_ID);
    expect(arg.schedule.on).toEqual({ hour: 10, minute: 0 });
  });

  it("nativo + permiso denegado: rearmIfEnabled NO programa", async () => {
    const schedule = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "denied" }),
        requestPermissions: vi.fn(),
        schedule,
        cancel: vi.fn().mockResolvedValue(),
      },
    }));
    const n = await import("./notifications");
    await n.rearmIfEnabled({ title: "t", body: "b" });
    expect(schedule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `npx vitest run src/lib/notifications.test.js`
Expected: FAIL (`Cannot find module './notifications'`).

- [ ] **Step 3: Implementar**

```js
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
```

- [ ] **Step 4: Run test → PASS**

Run: `npx vitest run src/lib/notifications.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.js src/lib/notifications.test.js
git commit -m "feat(cap): wrapper de notificación local diaria (Capacitor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 20: Strings i18n de notificaciones

**Files:**
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Añadir la clave `notif` en `es.json`**

Añade como nueva clave top-level (mismo nivel que `result`):
```json
  "notif": {
    "optInTitle": "¿Te aviso del coche nuevo?",
    "optInBody": "Te mando un recordatorio diario a las 10:00 cuando haya coche nuevo. Sin spam.",
    "optInAccept": "Sí, avísame",
    "optInDecline": "Ahora no",
    "reminderTitle": "Hoy hay coche nuevo 🚗",
    "reminderBody": "Adivina el coche del día y mantén tu racha."
  }
```

- [ ] **Step 2: Añadir la clave `notif` en `en.json`**

```json
  "notif": {
    "optInTitle": "Want a heads-up for the new car?",
    "optInBody": "I'll send one daily reminder at 10:00 when a new car is up. No spam.",
    "optInAccept": "Yes, remind me",
    "optInDecline": "Not now",
    "reminderTitle": "New car today 🚗",
    "reminderBody": "Guess the car of the day and keep your streak."
  }
```

- [ ] **Step 3: Verificar JSON válido (UTF-8, sin romper el archivo)**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/es.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "feat(cap): strings i18n para el opt-in y el recordatorio de notificación

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 21: Opt-in tras la primera partida + re-arme en arranque + botón atrás

**Files:**
- Create: `src/components/NotificationOptIn.jsx`
- Modify: `src/components/ResultPanel.jsx`
- Modify: `src/index.jsx`

- [ ] **Step 1: Crear `NotificationOptIn.jsx`**

```jsx
// src/components/NotificationOptIn.jsx
// Prompt suave (solo nativo) que aparece UNA vez tras terminar una partida
// para ofrecer el recordatorio diario. No se pide permiso al abrir la app
// (intrusivo); se pide aquí, en el pico de engagement. La elección se persiste
// (markAskedOptIn) para no volver a preguntar. En web devuelve null.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import {
  isNative,
  hasAskedOptIn,
  markAskedOptIn,
  ensurePermission,
  scheduleDailyReminder,
} from "../lib/notifications";

export default function NotificationOptIn() {
  const { t } = useT();
  // Decisión inicial síncrona: solo se muestra en nativo y si no se preguntó ya.
  const [visible, setVisible] = useState(() => isNative() && !hasAskedOptIn());

  // Si por carrera (StrictMode) cambiara, mantenemos coherencia.
  useEffect(() => {
    if (isNative() && hasAskedOptIn()) setVisible(false);
  }, []);

  if (!visible) return null;

  async function accept() {
    haptic.impactLight();
    markAskedOptIn();
    setVisible(false);
    const granted = await ensurePermission();
    if (granted) {
      await scheduleDailyReminder({
        title: t("notif.reminderTitle"),
        body: t("notif.reminderBody"),
      });
    }
  }

  function decline() {
    haptic.impactLight();
    markAskedOptIn();
    setVisible(false);
  }

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
      <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
        {t("notif.optInTitle")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-white/90">
        {t("notif.optInBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={accept}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary transition hover:brightness-110 active:scale-[0.98]"
        >
          {t("notif.optInAccept")}
        </button>
        <button
          type="button"
          onClick={decline}
          className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
        >
          {t("notif.optInDecline")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Renderizar el opt-in en `ResultPanel`**

En `src/components/ResultPanel.jsx`, añade el import:
```js
import NotificationOptIn from "./NotificationOptIn";
```
Y renderízalo tras la card de compartir (después del bloque `{shareText && ( ... )}`, antes de `{showDailyStats && <DailyStats .../>}`):
```jsx
      <NotificationOptIn />
```
(El componente se auto-gatea: en web o si ya se preguntó, devuelve null.)

- [ ] **Step 3: Re-armar la notificación y enganchar el botón atrás en el arranque**

En `src/index.jsx`, añade los imports:
```js
import { Capacitor } from "@capacitor/core";
import { rearmIfEnabled } from "./lib/notifications";
import { t } from "./i18n";
```
Y tras `installApiFetchShim();` añade:
```js
// Solo nativo (Capacitor): re-armar el recordatorio si el permiso ya está
// concedido, y enganchar el botón físico "atrás" de Android.
if (Capacitor.isNativePlatform()) {
  rearmIfEnabled({
    title: t("notif.reminderTitle"),
    body: t("notif.reminderBody"),
  }).catch(() => {});

  import("@capacitor/app").then(({ App: CapApp }) => {
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
  });
}
```

- [ ] **Step 4: Build sanity + unit tests**

Run: `npx vite build 2>&1 | tail -3 && npx vitest run`
Expected: `built in ...` y tests verdes.

- [ ] **Step 5: Commit**

```bash
git add src/components/NotificationOptIn.jsx src/components/ResultPanel.jsx src/index.jsx
git commit -m "feat(cap): opt-in de notificación tras la 1ª partida + re-arme y botón atrás

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 22: Iconos y splash de la app

**Files:**
- Create: `resources/icon.png` (1024×1024)
- Create: `resources/splash.png` (2732×2732)
- Modify: `android/` (assets generados)

- [ ] **Step 1: Preparar las imágenes fuente**

Coloca en `resources/`:
- `icon.png`: 1024×1024, el logo de la app sobre fondo `#0d1014` (o transparente).
- `splash.png`: 2732×2732, logo centrado sobre `#0d1014`.

> Si no hay un icono de 1024 a mano, parte de `public/web-app-manifest-512x512.png` reescalado a 1024. (Paso de diseño manual del usuario; el resto del task es mecánico.)

- [ ] **Step 2: Generar los assets de Android**

Run: `npm run cap:assets`
Expected: genera mipmaps/drawables en `android/app/src/main/res/...` y la config del splash.

- [ ] **Step 3: Commit**

```bash
git add resources/ android/
git commit -m "feat(cap): iconos y splash de la app Android desde assets del proyecto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 23: Sincronizar el build dentro de la app

**Files:**
- Modify: `android/` (web assets sincronizados)

- [ ] **Step 1: Build + sync**

Run: `npm run cap:sync`
Expected: `vite build` OK + `cap sync android` → `Sync finished` (copia `build/` a `android/app/src/main/assets/public`).

- [ ] **Step 2: Commit**

```bash
git add android/
git commit -m "chore(cap): sync del build web dentro del proyecto Android

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 24: Documentación de build y publicación

**Files:**
- Create: `docs/android-build-release.md`

- [ ] **Step 1: Escribir la guía**

````markdown
# App Android — build y publicación (v1)

App Capacitor que empaqueta la web (`webDir: build`). v1 es **anónima** (sin
login Google) con **recordatorio diario local**.

## Requisitos (una vez)
- Android Studio (Linux/Fedora nativo; no hace falta Mac).
- JDK 17 (lo trae Android Studio) y Android SDK + plataforma reciente.
- Cuenta **Google Play Developer** (25 $, pago único).
- Variable de build `VITE_PROD_ORIGIN=https://cochedeldia.com` (por defecto ya
  apunta ahí en `src/lib/apiUrl.js`).

## Comprobación previa importante
El apex `cochedeldia.com` debe servir la API **sin redirigir a www** (un 30x
complicaría las llamadas desde la app):

```bash
curl -sI https://cochedeldia.com/api/health | head -5
```
Espera `HTTP/2 200` (no `301/302` a `www.cochedeldia.com`). Si redirige, usa el
host final como `VITE_PROD_ORIGIN`.

## Build local y prueba en emulador/dispositivo
```bash
npm run cap:sync     # vite build + copia a android/
npm run cap:open     # abre Android Studio
```
En Android Studio: elige un emulador o un móvil con depuración USB y pulsa Run.
Smoke test: jugar una partida anónima completa (5 intentos), terminar, aceptar
el recordatorio, y comprobar que queda programado. Para ver disparar la
notificación, ajusta la hora del dispositivo cerca de las 10:00.

## Firma (release)
Genera un keystore una sola vez y **guárdalo a buen recaudo** (sin él no puedes
publicar updates):
```bash
keytool -genkey -v -keystore cochedeldia-release.keystore \
  -alias cochedeldia -keyalg RSA -keysize 2048 -validity 10000
```
Configura la firma en `android/app/build.gradle` (bloque `signingConfigs`) o vía
`android/keystore.properties` (NO commitear el keystore ni las contraseñas;
añádelos a `.gitignore`).

## AAB para Play
```bash
cd android
./gradlew bundleRelease
# salida: android/app/build/outputs/bundle/release/app-release.aab
```
Sube el `.aab` a **Play Console** → empieza por el track de **Internal testing**.
Rellena ficha, privacidad (ya existe la política en /privacidad) y data safety
(v1 anónima: sin login, sin recogida de datos personales identificables).

## Actualizar la app
Para cambios de UI hay que **resubir** (es bundled): `npm run cap:sync`, sube
`versionCode`/`versionName` en `android/app/build.gradle`, `./gradlew
bundleRelease`, nueva release en Play. (La API/contenido del coche del día sí se
actualiza solo, viene de Vercel.)
````

- [ ] **Step 2: Commit**

```bash
git add docs/android-build-release.md
git commit -m "docs(cap): guía de build, firma y publicación de la app Android

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 25: Verificación final + PR

**Files:** (ninguno; verificación e integración)

- [ ] **Step 1: Suite completa verde**

Run: `npx vitest run && npm run test:security && npm run test:attacks`
Expected: 0 failed en todo.

- [ ] **Step 2: Build de producción (igual que Vercel)**

Run: `npx vitest run && npx vite build 2>&1 | tail -5`
Expected: `built in ...`.

- [ ] **Step 3: Coherencia — sin restos de cookie ni `${src}` en URLs de imagen**

Run: `grep -rn "cd_anon\|setAnonCookie\|buildSetCookie\|ANON_COOKIE_NAME" api/ src/ scripts/ ; grep -n '\${src}&f=' src/components/CarImage.jsx`
Expected: ambos sin resultados.

- [ ] **Step 4: Push y abrir el PR (rama claude/… → main)**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: app Android (Capacitor v1) + anon-session por token" \
  --body "$(cat <<'EOF'
## Resumen
- **Fase 1 (web):** migra la sesión anónima de cookie HttpOnly a token HMAC en localStorage + header `X-Anon-Session` (devuelto en el body de get-daily-car/validate-guess). `daily-image` deja de leer la cookie (el reveal anónimo ya va por reveal token). Suites de seguridad actualizadas.
- **Fase 2 (app):** Capacitor Android **bundled** (`com.cochedeldia`), `apiUrl()`+shim para absolutizar `/api` en nativo, CORS para el origen de la app (sin credenciales), `CarImage`/preload absolutizados, y **recordatorio diario local** (10:00) con opt-in tras la 1ª partida y re-arme en arranque.

## Verificación
- `vitest`, `test:security`, `test:attacks` verdes; `vite build` OK.
- Web: jugar partida anónima completa en el Preview de Vercel.
- App: build local en Android Studio (ver `docs/android-build-release.md`) — verificación manual del usuario (no pasa por el Preview de Vercel).

## Fuera de alcance (v2)
Login Google nativo · push de servidor (FCM) · sincronía de cuenta · iOS.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR creado claude/… → main. Avisar al usuario: "listo para mergear" tras revisar el Preview.

---

## Notas de ejecución

- **`vercel dev` no aplica:** verificación web por `vite build` + suites + Preview de Vercel; la app Android se prueba en Android Studio (no en el Preview).
- **`android/` se commitea**, pero el **keystore** y `keystore.properties` NO (añádelos a `.gitignore` en Task 24 si aún no están).
- **UTF-8:** los JSON de i18n y los comentarios en español llevan acentos; guarda en UTF-8 (regla 14).
- **Réplicas zoom:** este plan no toca `zoom.js`; si algún paso lo requiriera, mantener server/cliente en sync (regla 7).
- Tras Tasks que tocan `android/` (11, 22, 23), recuerda re-`cap:sync` si cambió el build antes de generar el AAB.
