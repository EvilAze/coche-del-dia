# Diseño — Rate limit distribuido (C1)

**Fecha:** 2026-06-14
**Estado:** Aprobado, pendiente de plan de implementación
**Área de auditoría SRE:** C1 — Seguridad, abuso y límites (Riesgo Crítico)

## Problema

El rate limit actual (`api/_lib/rate-limit.js`) es un `Map` en memoria por
instancia: best-effort, saltable rotando instancias warm, y **no funciona en
Edge**. Hoy solo lo usa `validate-guess` (Node). Los dos endpoints Edge
(`get-daily-car`, `health`) no tienen protección. `get-daily-car` es además el
más caro para Supabase (un RPC `pick_daily_car` + reads en CADA visita, sin
caché): un bot trivial puede agotar la cuota del free tier de Supabase/Vercel en
el pico diario. Es seguridad **y** coste a la vez.

## Objetivo

Rate limit distribuido (compartido entre instancias y runtimes) que pare bots
sin molestar a usuarios reales, sin romper el juego si el limiter falla, con
coste cero (free tier).

## Decisiones tomadas (brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Alcance | **`get-daily-car` + `validate-guess`** | Los dos caros y sin caché de CDN. Máxima protección de Supabase. (list-cars/daily-stats/daily-image ya cachean en CDN → poco beneficio.) |
| Tecnología | **`@upstash/ratelimit` + `@upstash/redis`** | Cliente REST edge-safe; funciona en Node y Edge (lo que el Map no podía). Free tier. |
| Fallo de Upstash | **Fail-open** | Si Upstash cae/tarda/sin cuota, la petición pasa. El juego nunca se rompe por el limiter (regla "no degradar"). |
| Algoritmo | **Sliding window 60 s** | Ventana deslizante por IP. |

## Approaches descartados

- **Solo escrituras (validate-guess + repesca), dejar get-daily-car a P1.** Más
  conservador, pero deja sin proteger el endpoint más caro ante bots.
- **Todos los públicos.** list-cars/daily-stats/daily-image ya tienen caché CDN
  (`s-maxage`); rate-limitearlos gasta cuota de Upstash con poco beneficio.
- **Fail-closed.** Una incidencia de Upstash tumbaría el juego; inaceptable para
  una web de entretenimiento.

## Arquitectura

- **Helper único compartido `api/_lib/ratelimit.js`** (edge-safe, sin imports
  node-only):
  - Construcción perezosa y memoizada del cliente `Redis` desde env
    (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). Si faltan, queda
    "no configurado" y todas las llamadas hacen fail-open.
  - Cachea una instancia `Ratelimit` por combinación `prefix+max+window` (la
    librería liga el límite a la instancia).
  - **`checkRateLimit(key, { max, windowSec, prefix })` → `{ ok, retryAfter }`:**
    - sin Upstash configurado → `{ ok: true }`.
    - `.limit(\`${prefix}:${key}\`)`: `success` → `{ ok: true }`; si no →
      `{ ok: false, retryAfter }` (segundos hasta reset).
    - cualquier excepción (timeout, red, cuota) → `console.error` +
      `{ ok: true }` (fail-open).
  - **`getClientIpEdge(request)`**: primer valor de `x-forwarded-for`, fallback
    `x-real-ip`, luego `"unknown"`.

- **Identificador:** IP del cliente. Node usa el `getClientIp(req)` existente;
  Edge usa el nuevo `getClientIpEdge(request)`.

- **Límites (generosos):**
  - `get-daily-car` (Edge): **60/min/IP**, prefijo `gdc`. Una carga = 1 hit; 60
    cubre refrescos/reconexiones, pero un bot iterando muere enseguida.
  - `validate-guess` (Node): **30/min/IP**, prefijo `vg` (igual que hoy; un
    jugador hace 5 hits/día).

- **Región Upstash:** crear la DB cerca de `fra1` (eu-central/eu-west) para
  minimizar la latencia añadida al primer paint.

## Cableado en los endpoints

- **`get-daily-car.js`** (Edge): al inicio del handler,
  `getClientIpEdge(request)` → `checkRateLimit(ip, { max:60, windowSec:60,
  prefix:"gdc" })`. Si `!ok` → `Response` 429 con `Retry-After`, ANTES de tocar
  Supabase. Es un `await` (una ida y vuelta a Upstash); fail-open lo cubre.
- **`validate-guess.js`** (Node): se reemplaza `rateLimit(...)` por
  `await checkRateLimit(ip, { max:30, windowSec:60, prefix:"vg" })`, manteniendo
  el mismo `429 {error:"Too many requests"}` + `Retry-After`.
- **`rate-limit.js`**: se elimina `rateLimit()`/`buckets` (código muerto tras la
  migración); se conserva `getClientIp` (lo usan daily-image/repesca para
  auditoría).

## Testing

- **Unitario (Vitest)** de `checkRateLimit`, mockeando el módulo de Upstash
  (patrón `health.test.js`):
  - sin envs → `{ ok: true }` (fail-open).
  - bajo límite (`success:true`) → `{ ok: true }`.
  - sobre límite (`success:false`) → `{ ok: false, retryAfter }`.
  - el `.limit()` lanza → `{ ok: true }` (fail-open).
- **Verificación en vivo (usuario):** tras provisionar Upstash y desplegar, un
  bucle rápido de `curl` a `/api/get-daily-car` debe empezar a recibir `429`
  pasados ~60 hits/min; y confirmar que con Upstash bien configurado el juego va
  normal.

## Provisión (usuario)

Crear DB en **Upstash** (región cercana a `fra1`), copiar
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` a las env vars de Vercel.
Documentado en `docs/runbooks/rate-limit.md`.

## Fuera de alcance

- Rate-limit de list-cars/daily-stats/daily-image (ya cachean en CDN).
- Rate-limit de los endpoints de `repesca` (se puede añadir luego con el mismo
  helper si hace falta).
- Caché de la parte anónima de `get-daily-car` → es P1, pieza aparte.
- El resto de la hoja de ruta (P1, D1, P2, D2): cada una con su ciclo.
