# Diseño — Monitorización de uptime (C3)

**Fecha:** 2026-06-14
**Estado:** Aprobado, pendiente de plan de implementación
**Área de auditoría SRE:** C3 — Telemetría y observabilidad (Riesgo Crítico)

## Problema

Hoy no hay forma de enterarse de una caída salvo por los usuarios. Sentry solo
captura errores JS que se ejecutan en código vivo; NO detecta:
- Supabase caído (la home estática puede seguir sirviéndose).
- Un deploy que devuelve 500 o rompe la API.
- El sitio entero caído (DNS, Vercel, dominio).

No existe endpoint de health ni monitor configurado.

## Objetivo

Detectar automáticamente "sitio caído" y "Supabase caído" y avisar al instante
por Telegram, con coste cero (free tier), sin degradar la home.

## Decisiones tomadas (brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Profundidad | **Health endpoint + ping externo** | Un `/api/health` que comprueba de verdad la conexión a Supabase, pingueado por un monitor externo. Detecta "sitio caído" Y "Supabase caído". Poco código, alto valor. |
| Proveedor | **Better Stack** | Free tier generoso (checks cada 3 min, status page, gestión de incidencias, multi-canal). |
| Canal de alerta | **Telegram** | Aviso instantáneo al móvil; encaja con el uso de Telegram para compartir el juego. |
| Runtime endpoint | **Edge Function `fra1`** | Cold-start bajo (mide la salud real de Supabase, no ruido de arranque) y no consume slot de función serverless del plan Hobby. |

## Approaches descartados

- **Solo ping a la home.** Cero código, pero no detecta una caída de Supabase si
  la home estática sigue cargando — justo uno de los escenarios a cubrir.
- **Health + ping + synthetic Safari (Checkly).** Más completo (cazaría roturas
  de JS en Safari móvil), pero más setup y otra herramienta. Queda como mejora
  futura; el synthetic se puede añadir después sin tocar lo de aquí.

## Arquitectura

Dos piezas independientes:

1. **`/api/health`** (código nuevo): endpoint público y ligero, Edge Function
   pinneada a `fra1`. Hace UNA lectura trivial a Supabase por el cliente anónimo
   para probar que la DB responde por el mismo camino que un usuario real.

2. **Better Stack** (configuración en su UI): dos monitores a producción cada
   3 min, con alertas a Telegram.

## Detalle de `/api/health`

- **Runtime:** `export const config = { runtime: "edge", regions: ["fra1"] }`.
- **Comprobación:** una sola query mínima vía `getSupabasePublic()` (cliente
  anónimo): `from('cars').select('id').limit(1)`. Lee como mucho 1 fila, respeta
  RLS, ejercita el mismo camino anon que un jugador. **No** usa `pick_daily_car`
  (no filtramos el coche ni escribimos nada).
- **Timeout:** la query va envuelta en un `Promise.race` con ~4 s. Si Supabase no
  responde en ese plazo, se devuelve 503 rápido en vez de colgar la función.
- **Respuestas:**
  - `200 {status:"ok", db:"up"}` si la query resuelve sin error.
  - `503 {status:"error", db:"down"}` si la query falla o supera el timeout.
  - `Cache-Control: no-store`. Sin PII, sin detalles internos del error en el
    body (el detalle real va a `console.error` para los logs de Vercel).
- **Seguridad:** público (el monitor debe alcanzarlo) pero inofensivo: lectura
  trivial, sin secretos, sin escritura. No añade superficie de abuso real.
- **Sin cambios en `vercel.json`:** el rewrite del SPA ya excluye `/api/`.

## Configuración de Better Stack (runbook)

Documentado en `docs/runbooks/uptime-monitoring.md`:

1. Crear cuenta Better Stack → Monitors → Create monitor.
2. **Monitor A:** URL `https://cochedeldia.com/api/health`, check cada 3 min,
   "expect status 200" + "body contains `ok`". Caza Supabase caído (503) y
   función/deploy caídos.
3. **Monitor B:** URL `https://cochedeldia.com/`, check cada 3 min, "expect 200".
   Caza sitio totalmente caído / DNS / deploy roto; distingue "todo abajo" de
   "solo la DB".
4. **Telegram:** conectar la integración (bot de Better Stack → chat), asignarla
   como canal de alerta de ambos monitores.
5. *(Opcional, fuera de scope)* status page pública.

## Testing

- **Unitario (Vitest)**, patrón `api/_lib/compare-guess.test.js`: la lógica se
  estructura para poder mockear el cliente Supabase. Casos: "DB responde →
  200/ok" y "DB falla o timeout → 503/down".
- **Verificación en vivo (usuario):** tras desplegar, abrir
  `https://cochedeldia.com/api/health` (debe dar `{status:"ok"...}`), configurar
  los monitores y **forzar una alerta de prueba** desde Better Stack para
  confirmar que el aviso de Telegram llega.

## Fuera de alcance

- Check synthetic con navegador (Safari/WebKit) — mejora futura con Checkly.
- Status page pública.
- Alertas por SMS/llamada.
- El resto de la hoja de ruta de la auditoría (C1, P1, D1, P2, D2): cada pieza
  con su propio ciclo spec → plan → implementación.
