# Rate limit distribuido (C1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate limit distribuido (Upstash) que funciona en Node y Edge, aplicado a `get-daily-car` (60/min) y `validate-guess` (30/min), con fail-open.

**Architecture:** Un helper edge-safe `api/_lib/ratelimit.js` envuelve `@upstash/ratelimit` con construcción perezosa, caché de limiters y fail-open. La lógica de decisión se extrae a `evaluateLimit(limiter, key)` (pura, testeable sin red). Se cablea en los dos endpoints y se elimina el limiter en memoria muerto de `rate-limit.js`.

**Tech Stack:** `@upstash/ratelimit`, `@upstash/redis` (REST, edge-safe), Vitest, Vercel Edge + Node functions.

---

## File Structure

- `api/_lib/ratelimit.js` — NUEVO. Helper distribuido: `getRedis()`/`getLimiter()` perezosos, `evaluateLimit(limiter, key)` (pura), `checkRateLimit(key, opts)` (cablea getLimiter+evaluate), `getClientIpEdge(request)`. Edge-safe.
- `api/_lib/ratelimit.test.js` — NUEVO. Tests de `evaluateLimit` (fail-open/under/over/throw) y `getClientIpEdge`.
- `api/get-daily-car.js` — MODIFICAR. Añadir check de rate limit (Edge) al inicio del handler.
- `api/validate-guess.js` — MODIFICAR. Cambiar el limiter en memoria por `checkRateLimit`.
- `api/_lib/rate-limit.js` — MODIFICAR. Eliminar `rateLimit()`/`buckets` (muerto); conservar `getClientIp`.
- `docs/runbooks/rate-limit.md` — NUEVO. Provisión de Upstash + cómo probar.

---

## Task 1: Helper `ratelimit.js` + dependencias

**Files:**
- Modify: `package.json` (deps)
- Create: `api/_lib/ratelimit.js`
- Test: `api/_lib/ratelimit.test.js`

- [ ] **Step 1: Instalar las dependencias de Upstash**

Run: `npm install @upstash/ratelimit @upstash/redis`
Expected: ambos paquetes aparecen en `dependencies` de `package.json` y se actualiza el lockfile, sin errores.

- [ ] **Step 2: Escribir el test que falla**

Create `api/_lib/ratelimit.test.js`:

```js
// api/_lib/ratelimit.test.js
// Tests de la lógica pura de rate-limit. evaluateLimit recibe un "limiter"
// (real o falso) para no depender de Upstash ni de red: cubrimos fail-open
// sin limiter, bajo límite, sobre límite y excepción. Más getClientIpEdge.
import { describe, it, expect } from "vitest";
import { evaluateLimit, getClientIpEdge } from "./ratelimit.js";

// Limiter falso: .limit() devuelve `outcome` (objeto) o lanza si es Error.
function fakeLimiter(outcome) {
  return {
    limit: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

describe("evaluateLimit", () => {
  it("sin limiter (Upstash no configurado) → ok (fail-open)", async () => {
    expect(await evaluateLimit(null, "1.2.3.4")).toEqual({ ok: true });
  });

  it("bajo el límite → ok", async () => {
    const lim = fakeLimiter({ success: true, reset: Date.now() + 60000 });
    expect(await evaluateLimit(lim, "1.2.3.4")).toEqual({ ok: true });
  });

  it("sobre el límite → !ok con retryAfter en segundos", async () => {
    const lim = fakeLimiter({ success: false, reset: Date.now() + 5000 });
    const r = await evaluateLimit(lim, "1.2.3.4");
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(r.retryAfter).toBeLessThanOrEqual(6);
  });

  it("el limiter lanza (Upstash caído) → ok (fail-open)", async () => {
    const lim = fakeLimiter(new Error("redis down"));
    expect(await evaluateLimit(lim, "1.2.3.4")).toEqual({ ok: true });
  });
});

describe("getClientIpEdge", () => {
  function req(headers) {
    return { headers: { get: (h) => headers[h] ?? null } };
  }
  it("usa el primer valor de x-forwarded-for", () => {
    expect(getClientIpEdge(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });
  it("cae a x-real-ip si no hay xff", () => {
    expect(getClientIpEdge(req({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });
  it("'unknown' si no hay cabeceras de IP", () => {
    expect(getClientIpEdge(req({}))).toBe("unknown");
  });
});
```

- [ ] **Step 3: Ejecutar el test y verque falla**

Run: `npx vitest run api/_lib/ratelimit.test.js`
Expected: FALLA (no existe `./ratelimit.js`).

- [ ] **Step 4: Implementar `api/_lib/ratelimit.js`**

Create `api/_lib/ratelimit.js`:

```js
// api/_lib/ratelimit.js
// Rate limit DISTRIBUIDO con Upstash Redis (REST, edge-safe): a diferencia
// del Map en memoria de rate-limit.js, este se comparte entre todas las
// instancias y runtimes (Node y Edge), así que un bot no puede saltárselo
// rotando entre instancias warm.
//
// FAIL-OPEN: si faltan las envs de Upstash, o Upstash cae/tarda/sin cuota,
// dejamos pasar la petición. El juego nunca se rompe por el limiter (regla
// "no degradar"). El precio es que durante una caída de Upstash no hay
// protección — trade-off aceptado en el diseño.
//
// Edge-safe: solo importa @upstash (compatible con Edge) y usa process.env;
// sin dependencias node-only, para poder usarse desde get-daily-car (Edge).

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Cliente Redis memoizado. _resolved evita reintentar la lectura de envs en
// cada petición de una instancia warm.
let _redis;
let _redisResolved = false;
// Caché de instancias Ratelimit por config: la librería liga el límite a la
// instancia, así que una por (prefix,max,windowSec).
const _limiters = new Map();

function getRedis() {
  if (_redisResolved) return _redis;
  _redisResolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

function getLimiter({ max, windowSec, prefix }) {
  const redis = getRedis();
  if (!redis) return null; // sin Upstash → checkRateLimit hará fail-open
  const cacheKey = `${prefix}:${max}:${windowSec}`;
  let limiter = _limiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      // Ventana deslizante: max hits por windowSec segundos.
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
      // prefix namespacea las keys en Redis (gdc:* vs vg:*).
      prefix,
      // analytics OFF: gastaría comandos extra de Upstash sin aportarnos nada.
      analytics: false,
    });
    _limiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Lógica PURA de decisión, separada para testear sin Upstash ni red.
 * @param {{ limit: (key:string)=>Promise<{success:boolean,reset:number}> }|null} limiter
 * @param {string} key
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>}
 */
export async function evaluateLimit(limiter, key) {
  try {
    if (!limiter) return { ok: true }; // sin Upstash configurado → fail-open
    const res = await limiter.limit(key);
    if (res.success) return { ok: true };
    // reset es timestamp ms del fin de ventana; lo damos en segundos (mín 1).
    const retryAfter = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
    return { ok: false, retryAfter };
  } catch (err) {
    // Upstash caído/lento/sin cuota: no rompemos el juego.
    console.error("[ratelimit] fallo, fail-open:", err?.message || err);
    return { ok: true };
  }
}

/**
 * Comprueba el rate limit para `key` (típicamente la IP). Fail-open.
 * @param {string} key
 * @param {{ max:number, windowSec:number, prefix:string }} opts
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>}
 */
export async function checkRateLimit(key, { max, windowSec, prefix }) {
  return evaluateLimit(getLimiter({ max, windowSec, prefix }), key);
}

/**
 * IP del cliente desde un Request de Edge (no hay req.socket como en Node).
 * @param {Request} request
 * @returns {string}
 */
export function getClientIpEdge(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
```

- [ ] **Step 5: Ejecutar el test y verque pasa**

Run: `npx vitest run api/_lib/ratelimit.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json api/_lib/ratelimit.js api/_lib/ratelimit.test.js
git commit -m "feat(ratelimit): helper distribuido Upstash edge-safe con fail-open + tests"
```

---

## Task 2: Cablear en `get-daily-car` (Edge)

**Files:**
- Modify: `api/get-daily-car.js`

- [ ] **Step 1: Añadir el import del helper**

En `api/get-daily-car.js`, junto al resto de imports `from "./_lib/..."` (por
ejemplo justo después del import de `zoom.js`), añade:

```js
import { checkRateLimit, getClientIpEdge } from "./_lib/ratelimit.js";
```

- [ ] **Step 2: Insertar el check al inicio del handler**

En el handler, JUSTO DESPUÉS del bloque que comprueba `supabaseAdmin` (el
`if (!supabaseAdmin) { ... return jsonResponse(... 500) }`) y ANTES de
`const today = todayInMadrid();`, inserta:

```js
  // Rate limit ANTES de tocar Supabase: get-daily-car hace un RPC por visita
  // (sin caché), así que es el endpoint que más conviene proteger de bots.
  // 60/min/IP es generoso para un humano (refrescos/reconexiones) pero corta
  // en seco a un script que itere. Fail-open: si Upstash falla, pasa igual.
  const ip = getClientIpEdge(request);
  const limit = await checkRateLimit(ip, { max: 60, windowSec: 60, prefix: "gdc" });
  if (!limit.ok) {
    return jsonResponse(
      { message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }
```

- [ ] **Step 3: Verificar sintaxis**

Run: `node --check api/get-daily-car.js`
Expected: sin salida, exit 0 (sintaxis válida).

- [ ] **Step 4: Verque la suite completa sigue verde**

Run: `npx vitest run`
Expected: todos los tests pasan (incluidos los nuevos de ratelimit).

- [ ] **Step 5: Commit**

```bash
git add api/get-daily-car.js
git commit -m "feat(ratelimit): proteger get-daily-car con rate limit Edge (60/min)"
```

---

## Task 3: Migrar `validate-guess` y limpiar el limiter muerto

**Files:**
- Modify: `api/validate-guess.js`
- Modify: `api/_lib/rate-limit.js`

- [ ] **Step 1: Cambiar los imports en `validate-guess.js`**

Sustituye la línea de import actual:

```js
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
```

por estas dos:

```js
import { getClientIp } from "./_lib/rate-limit.js";
import { checkRateLimit } from "./_lib/ratelimit.js";
```

- [ ] **Step 2: Sustituir el check en memoria por el distribuido**

Reemplaza este bloque:

```js
  const ip = getClientIp(req);
  const limit = rateLimit(`vg:${ip}`, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    res.setHeader("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
    return res.status(429).json({ error: "Too many requests" });
  }
```

por:

```js
  const ip = getClientIp(req);
  const limit = await checkRateLimit(ip, { max: 30, windowSec: 60, prefix: "vg" });
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return res.status(429).json({ error: "Too many requests" });
  }
```

(El handler ya es `async`, así que el `await` es válido aquí.)

- [ ] **Step 3: Eliminar el limiter en memoria muerto de `rate-limit.js`**

En `api/_lib/rate-limit.js`, ELIMINA todo lo relativo al limiter en memoria —
la constante `buckets`, `MAX_BUCKET_SIZE` y la función exportada `rateLimit`—
dejando ÚNICAMENTE `getClientIp` (que siguen usando daily-image y repesca para
auditoría). Actualiza el comentario de cabecera del archivo para que describa
solo `getClientIp`. El archivo debe quedar, en esencia, así:

```js
// api/_lib/rate-limit.js
// Extracción de la IP del cliente para endpoints Node (Vercel). El rate limit
// en sí es ahora distribuido (Upstash) en api/_lib/ratelimit.js; este módulo
// conserva solo getClientIp, que daily-image y repesca usan para auditoría.
//
// Carpeta `_lib`: excluida del routing serverless de Vercel.

export function getClientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(",")[0].trim();
  }
  const real = req.headers?.["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket?.remoteAddress || "unknown";
}
```

- [ ] **Step 4: Verificar que nada más importaba `rateLimit`**

Run: `grep -rn "rateLimit" api/ | grep -v "ratelimit.js" | grep -v "checkRateLimit"`
Expected: SIN resultados (ya nadie usa el `rateLimit` en memoria). Si aparece
algo, migrar ese uso a `checkRateLimit` antes de continuar.

- [ ] **Step 5: Verificar sintaxis y suite**

Run: `node --check api/validate-guess.js && node --check api/_lib/rate-limit.js && npx vitest run`
Expected: sintaxis OK y todos los tests verdes.

- [ ] **Step 6: Commit**

```bash
git add api/validate-guess.js api/_lib/rate-limit.js
git commit -m "refactor(ratelimit): validate-guess usa Upstash; elimina limiter en memoria"
```

---

## Task 4: Runbook de Upstash

**Files:**
- Create: `docs/runbooks/rate-limit.md`

- [ ] **Step 1: Escribir el runbook**

Create `docs/runbooks/rate-limit.md`:

```markdown
# Runbook — Rate limit distribuido (Upstash)

Rate limit con Upstash Redis aplicado a `/api/get-daily-car` (60/min/IP) y
`/api/validate-guess` (30/min/IP). Ver diseño en
`docs/superpowers/specs/2026-06-14-rate-limit-distribuido-design.md`.

## Provisión (una vez)

1. Crear cuenta en Upstash y una **Redis database**.
   - Región: cercana a `fra1` (p. ej. `eu-central-1` / `eu-west-1`) para
     minimizar la latencia que añade el check al primer paint.
   - Tipo: Regional (no Global) basta y gasta menos cuota.
2. En la página de la DB, copiar las credenciales **REST**:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Añadirlas como **env vars en Vercel** (Production + Preview).

Sin estas envs el rate limit hace **fail-open** (no limita, no rompe nada): el
juego funciona, simplemente sin protección hasta que las configures.

## Cómo funciona

- Ventana deslizante de 60 s por IP, prefijos `gdc:` (get-daily-car) y `vg:`
  (validate-guess).
- **Fail-open**: si Upstash cae/tarda/sin cuota, las peticiones pasan.
- Al superar el límite: `429` + cabecera `Retry-After` (segundos).

## Probar que funciona

Con Upstash ya configurado en producción:

```bash
# 70 peticiones rápidas: las primeras 60 → 200, luego deberían aparecer 429.
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code}\n" https://cochedeldia.com/api/get-daily-car
done | sort | uniq -c
# Esperado: ~60 líneas "200" y ~10 líneas "429".
```

Comprobar también que el juego carga con normalidad en el navegador (un usuario
real no se acerca a 60/min).

## Cuota de Upstash

Cada visita a get-daily-car consume ~1 comando de Upstash. Si el tráfico crece y
te acercas al tope del free tier, opciones: subir de plan, o resolver la carga
de get-daily-car con caché (pieza P1 de la auditoría) para reducir su volumen.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/rate-limit.md
git commit -m "docs(ratelimit): runbook de provisión Upstash y pruebas"
```

---

## Task 5: PR y verificación viva

**Precondición (usuario):** crear la DB de Upstash y poner las dos env vars en
Vercel. Sin ellas el limiter hace fail-open (no protege, pero no rompe nada).

- [ ] **Step 1: Abrir el PR `claude/rate-limit` → `main`**

```bash
git push -u origin claude/rate-limit
gh pr create --base main --head claude/rate-limit \
  --title "feat(ratelimit): rate limit distribuido con Upstash (C1)" \
  --body "Implementa docs/superpowers/specs/2026-06-14-rate-limit-distribuido-design.md. Provisión Upstash en docs/runbooks/rate-limit.md."
```
Expected: URL del PR.

- [ ] **Step 2: (Usuario) provisionar Upstash + env vars en Vercel**

Seguir `docs/runbooks/rate-limit.md` (crear DB, copiar URL+TOKEN REST, ponerlas
en Vercel Production+Preview).

- [ ] **Step 3: (Usuario) mergear y verificar en vivo**

Tras el deploy, ejecutar el bucle de `curl` del runbook contra
`/api/get-daily-car` y confirmar que aparecen `429` pasados ~60 hits/min, y que
el juego carga normal en el navegador.

- [ ] **Step 4: Confirmar**

Con los `429` apareciendo bajo carga y el juego normal para un usuario real, C1
queda cerrado.

---

## Self-Review (cobertura del spec)

- Helper distribuido Upstash edge-safe → Task 1 (`ratelimit.js`). ✔
- Construcción perezosa + caché de limiters → Task 1 (`getRedis`/`getLimiter`). ✔
- `checkRateLimit` fail-open (sin envs / error) → Task 1 (`evaluateLimit`). ✔
- `getClientIpEdge` → Task 1. ✔
- get-daily-car 60/min, prefijo `gdc`, antes de Supabase, 429+Retry-After → Task 2. ✔
- validate-guess 30/min, prefijo `vg`, mismo 429+Retry-After → Task 3. ✔
- Eliminar limiter en memoria, conservar `getClientIp` → Task 3. ✔
- Algoritmo sliding window 60 s → Task 1 (`Ratelimit.slidingWindow`). ✔
- Tests (fail-open/under/over/throw + IP) → Task 1 (`ratelimit.test.js`). ✔
- Provisión Upstash (region fra1, env vars) → Task 4 (runbook) + Task 5. ✔
- Verificación en vivo (bucle curl → 429) → Task 4/5. ✔
```
