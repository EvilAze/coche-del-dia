# Diseño — Backups automáticos de la base de datos (C2)

**Fecha:** 2026-06-14
**Estado:** Aprobado, pendiente de plan de implementación
**Área de auditoría SRE:** C2 — Recuperación de desastres (Riesgo Crítico)

## Problema

El free tier de Supabase no retiene PITR ni backups gestionados fiables. Los
datos de jugador (`user_guesses`, rachas/streak-freeze, logros, `daily_stats`,
`guess_audit`, `monthly_podium`, perfiles) son **irreemplazables**: si una
migración o un error los corrompe, se pierden para siempre. El catálogo
(`cars` + descripciones) sí es re-sembrable desde `scripts/2026-05-batch-200-*.sql`,
pero el resto no tiene red de seguridad. No existe hoy ningún mecanismo de
backup ni un runbook de restore.

## Objetivo

Un backup **diario, automático, cifrado y verificado** de la base de datos
completa (esquema + datos), almacenado fuera de Supabase, con un runbook de
restore probado. Coste casi cero, respetando la filosofía free-tier del
proyecto.

## Decisiones tomadas (brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Alcance | **Esquema + datos completos** | Permite reconstruir la DB entera desde cero (RLS, funciones, triggers, grants incluidos). A esta escala el tamaño es trivial. |
| Motor | **`pg_dump` nativo** | Único capaz de volcar esquema/RLS/funciones; PostgREST no puede (y ya causó el bug de paginación a 1000 filas). |
| Runner | **GitHub Actions** | Esquiva los límites del plan Hobby de Vercel (solo 2 cron jobs, ya usados; serverless sin binario `pg_dump` y timeout corto). Minutos gratis de sobra. |
| Destino | **Cloudflare R2** | S3-compatible, egress gratis (restaurar no cuesta dinero), free tier 10GB. |
| Cifrado | **`age` en cliente** | El dump se cifra antes de subir; aunque R2 se filtre, es inútil sin la clave privada (guardada offline por el usuario). |
| Rotación | **GFS** | 7 diarios + 4 semanales + 6 mensuales. Cobertura amplia, storage acotado. |
| Cadencia | **Diaria** | ~03:00 Europe/Madrid, ventana de bajo tráfico, separada del cron Vercel de las 23:05. |

## Approaches descartados

- **Cron de Vercel (piggyback en `warm-daily`) + export por PostgREST.**
  Descartado: el alcance elegido (esquema+datos) no lo puede volcar PostgREST,
  y es justo el patrón que produjo el bug de paginación a 1000 filas.
- **Backups de pago de Supabase (plan Pro, PITR).** Cero código pero ~25 $/mes,
  fuera de la filosofía free-tier. Queda como opción futura si el proyecto crece.

## Arquitectura

Workflow de GitHub Actions `.github/workflows/db-backup.yml`, disparado por
`schedule: cron` nocturno y también por `workflow_dispatch` (manual, para
lanzar un backup bajo demanda antes de una migración peligrosa).

Pasos del job:

1. **Setup:** checkout + instalar el cliente Postgres de la **versión mayor que
   matchea el servidor Supabase** (un `pg_dump` de versión distinta falla) y la
   herramienta `age`.
2. **Dump:** `pg_dump` vía la **connection string del Session Pooler**
   (Supavisor, IPv4 — la directa es IPv6 y falla en runners), volcando todos los
   schemas que `pg_dump` puede capturar de forma fiable. Salida comprimida.
3. **Cifrado:** `age` con la clave pública (secret) → `*.sql.gz.age`.
4. **Upload:** a R2 con clave de objeto datada
   (`daily/YYYY-MM-DD.sql.gz.age`, `weekly/…`, `monthly/…`).
5. **Rotación GFS:** conservar 7 diarios + 4 semanales + 6 mensuales; borrar el
   resto del bucket.
6. **Verificación:** antes de marcar éxito, comprobar que el dump no está vacío,
   descomprime correctamente y contiene las tablas clave. Si no, el job falla.

## Secrets y configuración (los crea el usuario)

En GitHub → Settings → Secrets and variables → Actions:

| Secret | Qué es | De dónde sale |
|---|---|---|
| `SUPABASE_DB_URL` | Connection string del Session Pooler | Supabase → Project Settings → Database → Connection string → Session pooler |
| `AGE_PUBLIC_KEY` | Clave pública `age` para cifrar | Generada con `age-keygen`; la privada la guarda el usuario offline |
| `R2_ACCOUNT_ID` | Account ID de Cloudflare | Cloudflare dashboard |
| `R2_ACCESS_KEY_ID` | Access key del token R2 | Cloudflare → R2 → API token (Object Read & Write, acotado al bucket) |
| `R2_SECRET_ACCESS_KEY` | Secret del token R2 | Igual |
| `R2_BUCKET` | Nombre del bucket | Creado por el usuario en R2 |

### Caveat: schema `auth`

`pg_dump` vuelca el schema `public` (con RLS, funciones, triggers, grants) sin
problema. El schema `auth` de Supabase (incluida `auth.users` con emails) lo
gestiona la plataforma y **puede no ser restaurable tal cual** en un proyecto
nuevo. Decisión: dumpeamos todos los schemas que `pg_dump` capture de forma
fiable (incluido `auth` si el rol del pooler tiene permiso de lectura), y el
runbook documenta que `auth.users` puede requerir el backup gestionado de
Supabase por separado. Las filas de `user_guesses` referencian `user_id`; si
`auth.users` se perdiera, el dump conserva los datos pero quedarían huérfanos
hasta recrear los usuarios.

## Runbook de restore

Documentado en la propia doc del workflow, con pasos copy-paste para dos
escenarios:

- **Corrupción de una tabla (lo más probable):** bajar el último dump bueno de
  R2, descifrar con la clave privada `age`, restaurar **solo esa tabla**
  (`pg_restore`/`psql` con `--table`) sin tocar el resto.
- **Desastre total (reconstruir la DB):** descifrar el dump completo y aplicarlo
  sobre un proyecto Supabase limpio en orden (schema → datos → grants/RLS).

Además, un **workflow manual `restore-dry-run`** (`workflow_dispatch`): baja el
último dump, lo descifra y lo carga en una **DB Postgres efímera dentro del
runner** (service container) para verificar que restaura de verdad, sin tocar
producción. Convierte el backup de "espero que sirva" a "verificado que sirve".

## Manejo de errores y alertas

- Cualquier paso que falle ⇒ job fallido ⇒ **GitHub envía email automáticamente**
  por workflow fallido (gratis, canal primario de alerta).
- La verificación post-dump (no-vacío, descomprime, contiene tablas clave) evita
  el peor caso silencioso: un backup "verde" que en realidad es un fichero de 0
  bytes.
- Sin secrets configurados ⇒ el workflow falla rápido con mensaje claro, sin
  subir basura a R2.

## Testing

Es infraestructura (YAML + scripts shell), no código de app: no aplica Vitest.
Validación:

1. Lanzar el workflow a mano (`workflow_dispatch`) y ver el objeto cifrado en R2.
2. Ejecutar `restore-dry-run` y confirmar que la DB efímera levanta con las
   tablas esperadas.
3. Verificar que la rotación GFS borra lo viejo tras varias ejecuciones.

## Fuera de alcance

- Backups gestionados/PITR de pago de Supabase.
- Restore automático a producción (siempre manual y deliberado).
- Backup del schema `auth` como fuente de verdad restaurable (ver caveat).
- El resto de la hoja de ruta de la auditoría (C1, C3, P1, P2, D1, D2): cada
  pieza tiene su propio ciclo spec → plan → implementación.
