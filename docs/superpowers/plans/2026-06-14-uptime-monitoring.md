# Monitorización de uptime (C3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un endpoint `/api/health` (Edge) que comprueba la conexión a Supabase, más un runbook para configurar dos monitores en Better Stack con alertas a Telegram.

**Architecture:** La lógica de chequeo (query + timeout) vive en un helper puro `api/_lib/health.js` con tests Vitest que mockean el cliente Supabase. El endpoint `api/health.js` (Edge, `fra1`) cablea `getSupabasePublic()` + el helper y construye la respuesta 200/503. La configuración de Better Stack es manual (runbook).

**Tech Stack:** Vercel Edge Functions, `@supabase/supabase-js` (cliente anónimo), Vitest, Better Stack (externo).

---

## File Structure

- `api/_lib/health.js` — helper puro `checkDbHealth(client, opts)`: corre una lectura trivial contra una carrera con timeout y devuelve `true`/`false`. Sin construir respuestas HTTP (testeable aislado).
- `api/_lib/health.test.js` — tests Vitest del helper, mockeando el cliente Supabase (sano / error de DB / excepción / timeout).
- `api/health.js` — endpoint Edge `fra1`: `getSupabasePublic()` + `checkDbHealth` → `Response` 200 `{status:"ok",db:"up"}` / 503 `{status:"error",db:"down"}`.
- `docs/runbooks/uptime-monitoring.md` — pasos de Better Stack (2 monitores) + Telegram.

Sin cambios en `vercel.json` (el rewrite del SPA ya excluye `/api/`).

---

## Task 1: Helper `checkDbHealth` (lógica de chequeo + timeout)

**Files:**
- Create: `api/_lib/health.js`
- Test: `api/_lib/health.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `api/_lib/health.test.js`:

```js
// api/_lib/health.test.js
// Tests del helper de health-check. Mockean el cliente Supabase para cubrir
// los cuatro caminos: DB sana, error de DB, excepción de red y timeout.
import { describe, it, expect } from "vitest";
import { checkDbHealth } from "./health.js";

// Cliente falso: from().select().limit() devuelve `result` (promise o
// thenable) que controla cada test. Replica la cadena que usa el helper.
function fakeClient(result) {
  return {
    from: () => ({
      select: () => ({
        limit: () => result,
      }),
    }),
  };
}

describe("checkDbHealth", () => {
  it("DB responde sin error → true", async () => {
    const client = fakeClient(Promise.resolve({ data: [{ id: 1 }], error: null }));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(true);
  });

  it("DB devuelve error → false", async () => {
    const client = fakeClient(Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(false);
  });

  it("la query lanza (red caída) → false", async () => {
    const client = fakeClient(Promise.reject(new Error("network")));
    expect(await checkDbHealth(client, { timeoutMs: 1000 })).toBe(false);
  });

  it("la query no resuelve antes del timeout → false", async () => {
    const client = fakeClient(new Promise(() => {})); // nunca resuelve
    expect(await checkDbHealth(client, { timeoutMs: 30 })).toBe(false);
  });

  it("cliente null (envs ausentes) → false", async () => {
    expect(await checkDbHealth(null, { timeoutMs: 1000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verque falla**

Run: `npx vitest run api/_lib/health.test.js`
Expected: FALLA (no existe `./health.js`).

- [ ] **Step 3: Implementar `api/_lib/health.js`**

Create `api/_lib/health.js`:

```js
// api/_lib/health.js
// Lógica del health-check usada por /api/health. Separada del endpoint para
// poder testearla aislada (mockeando el cliente Supabase), porque la parte
// frágil es la CARRERA contra el timeout, no el envoltorio HTTP.
//
// Devuelve true si Supabase responde a una lectura trivial dentro del plazo;
// false si hay error de DB, excepción de red, timeout o cliente ausente. No
// lanza nunca: el endpoint traduce el booleano a 200/503.

/**
 * @param {object|null} client  Cliente Supabase (anónimo). null si faltan envs.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function checkDbHealth(client, { timeoutMs = 4000 } = {}) {
  // Sin cliente (envs ausentes) la app no puede hablar con la DB: no sano.
  if (!client) return false;

  // Sentinel para distinguir "ganó el timeout" de un resultado real.
  const TIMEOUT = Symbol("timeout");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });

  try {
    // Lectura mínima por el mismo camino anon (RLS) que un jugador. limit(1)
    // lee como mucho una fila; NO usamos pick_daily_car (no filtrar el coche).
    const result = await Promise.race([
      client.from("cars").select("id").limit(1),
      timeout,
    ]);
    if (result === TIMEOUT) {
      console.error("[health] timeout consultando Supabase");
      return false;
    }
    if (result?.error) {
      // No propagamos el detalle al body; sí a los logs de Vercel.
      console.error("[health] error de Supabase:", result.error?.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[health] excepción consultando Supabase:", err?.message || err);
    return false;
  } finally {
    // Liberamos el timer para no dejar el handler vivo esperando al setTimeout.
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Ejecutar el test y verque pasa**

Run: `npx vitest run api/_lib/health.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/health.js api/_lib/health.test.js
git commit -m "feat(health): helper checkDbHealth con carrera contra timeout + tests"
```

---

## Task 2: Endpoint Edge `/api/health`

**Files:**
- Create: `api/health.js`

- [ ] **Step 1: Implementar `api/health.js`**

Create `api/health.js`:

```js
// api/health.js
// Endpoint público de health para monitorización externa (Better Stack).
// Comprueba que Supabase responde y devuelve 200/503 en consecuencia.
//
// HARDENING: público (el monitor debe alcanzarlo) pero inofensivo — lectura
// trivial vía cliente anónimo, sin secretos, sin escritura, sin pistas del
// coche del día. El body no expone detalle del error (solo db:"down"); el
// detalle real va a console.error (logs de Vercel).
//
// Runtime Edge `fra1`: cold-start bajo (el chequeo mide la salud real de
// Supabase, no el ruido de arranque) y no consume un slot de función
// serverless del plan Hobby.

import { getSupabasePublic } from "./_lib/supabase.js";
import { checkDbHealth } from "./_lib/health.js";

export const config = {
  runtime: "edge",
  regions: ["fra1"],
};

export default async function handler() {
  const client = getSupabasePublic();
  const ok = await checkDbHealth(client, { timeoutMs: 4000 });

  const body = ok ? { status: "ok", db: "up" } : { status: "error", db: "down" };
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Smoke test del cableado (sin envs → 503)**

Sin variables de entorno de Supabase, `getSupabasePublic()` devuelve null y el
handler debe responder 503 sin lanzar. Esto verifica el envoltorio Edge
completo (import, `Response`, status) end-to-end.

Run:
```bash
node --input-type=module -e "import('./api/health.js').then(m=>m.default()).then(r=>{console.log('status', r.status); return r.text();}).then(t=>console.log('body', t))"
```
Expected:
```
status 503
body {"status":"error","db":"down"}
```

- [ ] **Step 3: Commit**

```bash
git add api/health.js
git commit -m "feat(health): endpoint Edge /api/health (200 up / 503 down)"
```

---

## Task 3: Runbook de Better Stack + Telegram

**Files:**
- Create: `docs/runbooks/uptime-monitoring.md`

- [ ] **Step 1: Escribir el runbook**

Create `docs/runbooks/uptime-monitoring.md`:

```markdown
# Runbook — Monitorización de uptime

Health endpoint propio (`/api/health`) + Better Stack pingueándolo. Ver diseño
en `docs/superpowers/specs/2026-06-14-uptime-monitoring-design.md`.

## Qué detecta

- `/api/health` devuelve **503** si Supabase no responde (timeout 4 s) → caza
  "Supabase caído" aunque la home estática siga sirviéndose.
- También caza función/deploy caídos (no responde / 5xx).
- Un segundo monitor a `/` caza el sitio totalmente caído (DNS, Vercel, dominio).

## Comprobar el endpoint a mano

```bash
curl -i https://cochedeldia.com/api/health
# Sano:    HTTP/2 200  →  {"status":"ok","db":"up"}
# DB mal:  HTTP/2 503  →  {"status":"error","db":"down"}
```

## Configurar Better Stack

1. Crear cuenta en Better Stack (Uptime). **Monitors → Create monitor**.
2. **Monitor A — API/DB:**
   - URL: `https://cochedeldia.com/api/health`
   - Check frequency: 3 minutos
   - Expected HTTP status: `200`
   - "Required keyword" (body contains): `ok`
3. **Monitor B — Home:**
   - URL: `https://cochedeldia.com/`
   - Check frequency: 3 minutos
   - Expected HTTP status: `200`

## Alertas a Telegram

1. En Better Stack: **Integrations → Telegram** (o al crear el monitor,
   sección de notificaciones).
2. Sigue el flujo: Better Stack da un enlace/bot; ábrelo en Telegram y pulsa
   **Start** en el chat donde quieras los avisos.
3. Asigna esa integración como canal de notificación de **ambos** monitores.

## Verificar que la alerta llega

- En el monitor, usa **"Send test notification"** (o pausa el monitor y cambia
  temporalmente la URL a una inexistente para forzar un incidente real).
- Debe llegarte el mensaje a Telegram. Restaura la URL después.

## Opcional (fuera del alcance actual)

- **Status page** pública de Better Stack (Monitors → Status pages).
- Check **synthetic** con navegador (Checkly/WebKit) para cazar roturas de JS
  específicas de Safari móvil.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/uptime-monitoring.md
git commit -m "docs(uptime): runbook de Better Stack + alertas Telegram"
```

---

## Task 4: PR y verificación viva

**Precondición (usuario):** el endpoint solo da `200` en un deploy con las envs
`SUPABASE_URL`/`SUPABASE_ANON_KEY` presentes (ya lo están en producción). Better
Stack y Telegram los configura el usuario tras el deploy.

- [ ] **Step 1: Abrir el PR `claude/uptime-monitoring` → `main`**

```bash
git push -u origin claude/uptime-monitoring
gh pr create --base main --head claude/uptime-monitoring \
  --title "feat(uptime): health endpoint + monitorización Better Stack (C3)" \
  --body "Implementa docs/superpowers/specs/2026-06-14-uptime-monitoring-design.md. Pasos de Better Stack/Telegram en docs/runbooks/uptime-monitoring.md."
```
Expected: URL del PR.

- [ ] **Step 2: (Usuario) verificar el endpoint en producción tras merge/deploy**

```bash
curl -i https://cochedeldia.com/api/health
```
Expected: `HTTP 200` + `{"status":"ok","db":"up"}`.

- [ ] **Step 3: (Usuario) configurar los 2 monitores + Telegram**

Seguir `docs/runbooks/uptime-monitoring.md`. Forzar una notificación de prueba y
confirmar que llega a Telegram.

- [ ] **Step 4: Confirmar**

Con el endpoint en verde y la alerta de prueba recibida, C3 queda cerrado.

---

## Self-Review (cobertura del spec)

- Health endpoint que comprueba Supabase → Task 1 (helper) + Task 2 (endpoint). ✔
- Runtime Edge `fra1`, no consume slot serverless → Task 2 (`config`). ✔
- Query trivial anon `cars` limit 1, sin `pick_daily_car` → Task 1 (`checkDbHealth`). ✔
- Timeout ~4 s → Task 1 (`timeoutMs: 4000`, carrera). ✔
- 200 `{ok/up}` / 503 `{error/down}`, `no-store`, sin PII → Task 2. ✔
- Detalle del error solo a logs → Task 1 (`console.error`). ✔
- Sin cambios en `vercel.json` → confirmado en File Structure. ✔
- Better Stack: 2 monitores (health + home), 3 min, keyword `ok` → Task 3. ✔
- Telegram → Task 3. ✔
- Test unitario mockeando Supabase → Task 1 (`health.test.js`). ✔
- Verificación en vivo (curl + alerta de prueba) → Task 4. ✔
```
