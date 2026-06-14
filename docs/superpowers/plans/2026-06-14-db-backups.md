# Backups automáticos de la DB (C2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backup diario, cifrado y verificado de la base Supabase completa (esquema + datos) en Cloudflare R2, con rotación GFS y restore probado, ejecutado desde GitHub Actions.

**Architecture:** Un workflow de GitHub Actions hace `pg_dump` vía el Session Pooler, comprime, cifra con `age` (a tu clave offline + opcionalmente una clave de CI), sube a R2 con claves de objeto datadas por tier (daily/weekly/monthly) y poda cada tier (7/4/6). La lógica frágil (fechas/tiers y poda) vive en `scripts/backup/lib.sh` con tests bash locales; el glue de I/O en `scripts/backup/run-backup.sh`; un segundo workflow `restore-dry-run` verifica el restore en un Postgres efímero.

**Tech Stack:** GitHub Actions, `pg_dump`/`pg_restore` (PostgreSQL client 17 vía PGDG), `age`, AWS CLI (S3-compatible contra R2), Bash.

---

## File Structure

- `scripts/backup/lib.sh` — funciones puras: claves de objeto por tier para una fecha, decisión de poda. Sin I/O de red. Es el núcleo testeable.
- `scripts/backup/lib.test.sh` — tests bash de `lib.sh`, ejecutables localmente sin red.
- `scripts/backup/verify-dump.sh` — valida un dump (no vacío, descomprime, contiene tablas clave). Testeable con fixture local.
- `scripts/backup/run-backup.sh` — glue: dump → verify → cifra → sube → poda. Lint + `--dry-run`.
- `.github/workflows/db-backup.yml` — schedule nocturno + `workflow_dispatch`; instala herramientas y llama a `run-backup.sh`.
- `.github/workflows/db-restore-dry-run.yml` — `workflow_dispatch`; Postgres service container; baja el último dump, descifra, restaura y comprueba tablas.
- `docs/runbooks/db-backup-restore.md` — runbook de restore (corrupción de tabla y desastre total), lista de secrets, gestión de claves.

Convención de claves de objeto en R2 (ordenables lexicográfica = cronológicamente):
- `daily/YYYY-MM-DD.sql.gz.age`
- `weekly/GGGG-Www.sql.gz.age` (año-ISO + semana-ISO)
- `monthly/YYYY-MM.sql.gz.age`

Retención: 7 daily, 4 weekly, 6 monthly.

---

## Task 1: Lógica pura de tiers y poda (`lib.sh`)

**Files:**
- Create: `scripts/backup/lib.sh`
- Test: `scripts/backup/lib.test.sh`

- [ ] **Step 1: Escribir el test que falla**

Create `scripts/backup/lib.test.sh`:

```bash
#!/usr/bin/env bash
# Tests de scripts/backup/lib.sh — ejecutables sin red:
#   bash scripts/backup/lib.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

fail=0
check() { # check <descripción> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1"; echo "       esperado: [$2]"; echo "       obtenido: [$3]"
    fail=1
  fi
}

# daily_key
check "daily_key" "daily/2026-06-14.sql.gz.age" "$(daily_key 2026-06-14)"

# week_key / month_key
check "week_key (sábado ISO W24)" "weekly/2026-W24.sql.gz.age" "$(week_key 2026-06-13)"
check "month_key" "monthly/2026-06.sql.gz.age" "$(month_key 2026-06-14)"

# is_weekly_day: promovemos los domingos (ISO weekday 7)
if is_weekly_day 2026-06-14; then check "is_weekly_day domingo" "yes" "yes"; else check "is_weekly_day domingo" "yes" "no"; fi
if is_weekly_day 2026-06-13; then check "is_weekly_day sábado" "no" "yes"; else check "is_weekly_day sábado" "no" "no"; fi

# is_monthly_day: solo el día 01
if is_monthly_day 2026-06-01; then check "is_monthly_day día 1" "yes" "yes"; else check "is_monthly_day día 1" "yes" "no"; fi
if is_monthly_day 2026-06-14; then check "is_monthly_day día 14" "no" "yes"; else check "is_monthly_day día 14" "no" "no"; fi

# prune_list: dadas 10 claves ordenadas, conservar 7 ⇒ borrar las 3 más viejas
input="$(printf 'daily/2026-06-%02d.sql.gz.age\n' 1 2 3 4 5 6 7 8 9 10)"
expected="$(printf 'daily/2026-06-%02d.sql.gz.age\n' 1 2 3)"
check "prune_list keep 7 de 10" "$expected" "$(printf '%s\n' "$input" | prune_list 7)"

# prune_list: si hay menos que el tope, no borra nada
check "prune_list nada que borrar" "" "$(printf 'daily/a\ndaily/b\n' | prune_list 7)"

if [ "$fail" -ne 0 ]; then echo "TESTS FALLIDOS"; exit 1; fi
echo "TODOS LOS TESTS OK"
```

- [ ] **Step 2: Ejecutar el test y verque falla**

Run: `bash scripts/backup/lib.test.sh`
Expected: FALLA con `lib.sh: No such file or directory` (aún no existe).

- [ ] **Step 3: Implementar `lib.sh`**

Create `scripts/backup/lib.sh`:

```bash
#!/usr/bin/env bash
# scripts/backup/lib.sh
# Funciones PURAS para el backup: cálculo de claves de objeto por tier y
# decisión de poda. Sin red ni dependencias de pg/aws — por eso es testeable
# en local (ver lib.test.sh). El glue de I/O vive en run-backup.sh.
#
# Las claves usan formato de fecha ISO para que el orden lexicográfico
# coincida con el cronológico: así la poda es un simple "sort | head".

# daily_key <YYYY-MM-DD> -> daily/<fecha>.sql.gz.age
daily_key() { printf 'daily/%s.sql.gz.age' "$1"; }

# week_key <YYYY-MM-DD> -> weekly/<año-ISO>-W<semana-ISO>.sql.gz.age
week_key() { printf 'weekly/%s.sql.gz.age' "$(date -u -d "$1" +%G-W%V)"; }

# month_key <YYYY-MM-DD> -> monthly/<YYYY-MM>.sql.gz.age
month_key() { printf 'monthly/%s.sql.gz.age' "$(date -u -d "$1" +%Y-%m)"; }

# is_weekly_day <YYYY-MM-DD>: éxito (0) si es domingo (ISO weekday 7).
is_weekly_day() { [ "$(date -u -d "$1" +%u)" = "7" ]; }

# is_monthly_day <YYYY-MM-DD>: éxito (0) si es el día 1 del mes.
is_monthly_day() { [ "$(date -u -d "$1" +%d)" = "01" ]; }

# prune_list <keep>: lee de stdin una lista de claves (una por línea), ya
# ordenable cronológicamente, y escribe en stdout las que hay que BORRAR
# (todas menos las <keep> más recientes). Si hay <= keep, no escribe nada.
prune_list() {
  local keep="$1"
  local sorted total drop
  sorted="$(sort)"
  [ -z "$sorted" ] && return 0
  total="$(printf '%s\n' "$sorted" | grep -c .)"
  drop=$(( total - keep ))
  [ "$drop" -le 0 ] && return 0
  printf '%s\n' "$sorted" | head -n "$drop"
}
```

- [ ] **Step 4: Ejecutar el test y verque pasa**

Run: `bash scripts/backup/lib.test.sh`
Expected: `TODOS LOS TESTS OK` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/lib.sh scripts/backup/lib.test.sh
git commit -m "feat(backups): lógica pura de tiers GFS y poda con tests"
```

---

## Task 2: Verificación del dump (`verify-dump.sh`)

**Files:**
- Create: `scripts/backup/verify-dump.sh`
- Test: ampliar `scripts/backup/lib.test.sh` con un bloque de fixture

- [ ] **Step 1: Añadir el test que falla**

Append al final de `scripts/backup/lib.test.sh` (antes del bloque final `if [ "$fail" ...`), mueve ese bloque final al final del todo y añade:

```bash
# --- verify-dump.sh (fixture local, sin red) ---
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
good="$tmp/good.sql.gz"
{ printf 'CREATE TABLE public.cars (id int);\n';
  printf 'CREATE TABLE public.user_guesses (id int);\n';
  printf 'CREATE TABLE public.daily_stats (id int);\n';
  printf 'CREATE TABLE public.guess_audit (id int);\n';
  printf 'CREATE TABLE public.monthly_podium (id int);\n'; } | gzip > "$good"

if bash "$HERE/verify-dump.sh" "$good" >/dev/null 2>&1; then
  check "verify-dump dump válido" "ok" "ok"
else
  check "verify-dump dump válido" "ok" "fallo"
fi

bad="$tmp/bad.sql.gz"
printf 'CREATE TABLE public.cars (id int);\n' | gzip > "$bad"  # faltan tablas
if bash "$HERE/verify-dump.sh" "$bad" >/dev/null 2>&1; then
  check "verify-dump dump incompleto rechazado" "rechazado" "aceptado"
else
  check "verify-dump dump incompleto rechazado" "rechazado" "rechazado"
fi

empty="$tmp/empty.sql.gz"
: | gzip > "$empty"
if bash "$HERE/verify-dump.sh" "$empty" >/dev/null 2>&1; then
  check "verify-dump dump vacío rechazado" "rechazado" "aceptado"
else
  check "verify-dump dump vacío rechazado" "rechazado" "rechazado"
fi
```

- [ ] **Step 2: Ejecutar el test y verque falla**

Run: `bash scripts/backup/lib.test.sh`
Expected: las 3 líneas `verify-dump ...` fallan (script inexistente) ⇒ `TESTS FALLIDOS`.

- [ ] **Step 3: Implementar `verify-dump.sh`**

Create `scripts/backup/verify-dump.sh`:

```bash
#!/usr/bin/env bash
# scripts/backup/verify-dump.sh <ruta-al-dump.sql.gz>
# Valida un dump pg_dump comprimido ANTES de cifrarlo y subirlo. Evita el
# peor caso silencioso: un backup "verde" que en realidad es un fichero de
# 0 bytes o un dump truncado sin las tablas críticas.
#
# Comprueba: existe, tamaño > 0, gzip íntegro, y que contiene la sentencia
# CREATE TABLE de cada tabla irreemplazable.
set -euo pipefail

dump="${1:?uso: verify-dump.sh <ruta.sql.gz>}"

# Tablas cuya ausencia significa un dump roto/incompleto. No es la lista
# exhaustiva del schema: es el conjunto mínimo que DEBE estar siempre.
REQUIRED_TABLES=(cars user_guesses daily_stats guess_audit monthly_podium)

[ -s "$dump" ] || { echo "[verify] ERROR: dump inexistente o vacío: $dump" >&2; exit 1; }
gzip -t "$dump" 2>/dev/null || { echo "[verify] ERROR: gzip corrupto: $dump" >&2; exit 1; }

for t in "${REQUIRED_TABLES[@]}"; do
  if ! zgrep -qE "CREATE TABLE (public\.)?${t}\b" "$dump"; then
    echo "[verify] ERROR: falta la tabla '$t' en el dump" >&2
    exit 1
  fi
done

echo "[verify] OK: dump válido, ${#REQUIRED_TABLES[@]} tablas clave presentes"
```

- [ ] **Step 4: Ejecutar el test y verque pasa**

Run: `bash scripts/backup/lib.test.sh`
Expected: `TODOS LOS TESTS OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/verify-dump.sh scripts/backup/lib.test.sh
git commit -m "feat(backups): verify-dump valida integridad y tablas clave"
```

---

## Task 3: Glue del backup (`run-backup.sh`)

**Files:**
- Create: `scripts/backup/run-backup.sh`

- [ ] **Step 1: Implementar `run-backup.sh`**

Create `scripts/backup/run-backup.sh`:

```bash
#!/usr/bin/env bash
# scripts/backup/run-backup.sh
# Orquesta un backup completo: pg_dump -> gzip -> verify -> cifra (age) ->
# sube a R2 (S3-compatible) en el/los tier(s) que toquen hoy -> poda GFS.
#
# Env requeridas:
#   SUPABASE_DB_URL        connection string del Session Pooler (Supavisor)
#   AGE_PUBLIC_KEY         clave pública age de RECUPERACIÓN (privada offline)
#   R2_ACCOUNT_ID          account id de Cloudflare (para el endpoint)
#   R2_BUCKET              nombre del bucket
#   AWS_ACCESS_KEY_ID      = R2 access key id
#   AWS_SECRET_ACCESS_KEY  = R2 secret access key
# Env opcionales:
#   AGE_DRYRUN_PUBLIC_KEY  segundo destinatario (clave de CI) para que el
#                          workflow restore-dry-run pueda descifrar sin tu
#                          clave offline. Si no está, no se añade.
#   BACKUP_DATE            YYYY-MM-DD (default: hoy UTC). Útil para tests.
#   DRY_RUN                "1" => no sube ni borra; solo imprime el plan.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

: "${SUPABASE_DB_URL:?falta SUPABASE_DB_URL}"
: "${AGE_PUBLIC_KEY:?falta AGE_PUBLIC_KEY}"
: "${R2_ACCOUNT_ID:?falta R2_ACCOUNT_ID}"
: "${R2_BUCKET:?falta R2_BUCKET}"
DATE="${BACKUP_DATE:-$(date -u +%F)}"
DRY_RUN="${DRY_RUN:-0}"

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION="auto"
aws_s3() { aws s3 --endpoint-url "$ENDPOINT" "$@"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dump="$work/dump.sql.gz"
enc="$work/dump.sql.gz.age"

echo "[backup] pg_dump $DATE ..."
# --no-owner/--no-privileges OMITIDOS a propósito: queremos grants y RLS en
# el dump (alcance: esquema+datos completos, ver spec). -Fp (plain) para que
# verify-dump pueda zgrep las sentencias CREATE TABLE.
pg_dump --format=plain --no-password "$SUPABASE_DB_URL" | gzip > "$dump"

bash "$HERE/verify-dump.sh" "$dump"

echo "[backup] cifrando con age ..."
recipients=(-r "$AGE_PUBLIC_KEY")
[ -n "${AGE_DRYRUN_PUBLIC_KEY:-}" ] && recipients+=(-r "$AGE_DRYRUN_PUBLIC_KEY")
age "${recipients[@]}" -o "$enc" "$dump"

# Tiers a los que sube el dump de hoy.
targets=("$(daily_key "$DATE")")
is_weekly_day "$DATE" && targets+=("$(week_key "$DATE")")
is_monthly_day "$DATE" && targets+=("$(month_key "$DATE")")

for key in "${targets[@]}"; do
  dest="s3://${R2_BUCKET}/${key}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[backup] (dry-run) subiría -> $dest"
  else
    echo "[backup] subiendo -> $dest"
    aws_s3 cp "$enc" "$dest"
  fi
done

# Poda GFS por tier.
prune_tier() { # prune_tier <prefijo> <keep>
  local prefix="$1" keep="$2" keys to_delete
  keys="$(aws_s3 ls "s3://${R2_BUCKET}/${prefix}/" | awk '{print $4}' | sed "s#^#${prefix}/#" | grep -v '/$' || true)"
  [ -z "$keys" ] && return 0
  to_delete="$(printf '%s\n' "$keys" | prune_list "$keep")"
  [ -z "$to_delete" ] && return 0
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    if [ "$DRY_RUN" = "1" ]; then
      echo "[backup] (dry-run) borraría -> s3://${R2_BUCKET}/${k}"
    else
      echo "[backup] podando -> s3://${R2_BUCKET}/${k}"
      aws_s3 rm "s3://${R2_BUCKET}/${k}"
    fi
  done <<< "$to_delete"
}

prune_tier daily 7
prune_tier weekly 4
prune_tier monthly 6

echo "[backup] completado para $DATE"
```

- [ ] **Step 2: Comprobar sintaxis y estilo**

Run: `bash -n scripts/backup/run-backup.sh && command -v shellcheck >/dev/null && shellcheck scripts/backup/*.sh || echo "shellcheck no instalado, solo bash -n"`
Expected: sin errores de sintaxis (exit 0).

- [ ] **Step 3: Smoke test del plan en dry-run (sin red real)**

Run:
```bash
SUPABASE_DB_URL=x AGE_PUBLIC_KEY=age1xxx R2_ACCOUNT_ID=acc R2_BUCKET=b \
DRY_RUN=1 BACKUP_DATE=2026-06-01 bash -c '
  source scripts/backup/lib.sh
  echo "daily:  $(daily_key 2026-06-01)"
  echo "weekly? $(is_weekly_day 2026-06-01 && echo si || echo no)"
  echo "monthly:$(is_monthly_day 2026-06-01 && month_key 2026-06-01)"
'
```
Expected: imprime `daily: daily/2026-06-01.sql.gz.age`, weekly según el día, y `monthly: monthly/2026-06.sql.gz.age` (porque es día 1). Esto valida la lógica de tiers que usará el script (no ejecutamos pg_dump/age/aws aquí; eso se prueba vivo en Task 7).

- [ ] **Step 4: Commit**

```bash
git add scripts/backup/run-backup.sh
git commit -m "feat(backups): run-backup orquesta dump→cifra→sube R2→poda GFS"
```

---

## Task 4: Workflow de backup (`db-backup.yml`)

**Files:**
- Create: `.github/workflows/db-backup.yml`

- [ ] **Step 1: Crear el workflow**

Create `.github/workflows/db-backup.yml`:

```yaml
name: db-backup

# Cron nocturno + disparo manual. ~03:00 Europe/Madrid; GitHub usa UTC, así
# que 01:00 UTC (Madrid en verano es UTC+2). No coincide con el cron de
# Vercel de las 23:05, y cae en ventana de bajo tráfico.
on:
  schedule:
    - cron: "0 1 * * *"
  workflow_dispatch: {}

# Un backup a la vez; si el anterior sigue corriendo, no solapamos.
concurrency:
  group: db-backup
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - name: Instalar PostgreSQL client 17 (PGDG)
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
            --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
            https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17 age
          pg_dump --version

      - name: Ejecutar backup
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          AGE_PUBLIC_KEY: ${{ secrets.AGE_PUBLIC_KEY }}
          AGE_DRYRUN_PUBLIC_KEY: ${{ secrets.AGE_DRYRUN_PUBLIC_KEY }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: bash scripts/backup/run-backup.sh
```

- [ ] **Step 2: Validar que el YAML parsea**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/db-backup.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 3: (Opcional) lint con actionlint si está disponible**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/db-backup.yml || echo "actionlint no instalado, omito"`
Expected: sin errores, o el mensaje de omisión.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/db-backup.yml
git commit -m "ci(backups): workflow nocturno de pg_dump cifrado a R2"
```

---

## Task 5: Workflow de restore-dry-run (`db-restore-dry-run.yml`)

**Files:**
- Create: `.github/workflows/db-restore-dry-run.yml`

- [ ] **Step 1: Crear el workflow**

Create `.github/workflows/db-restore-dry-run.yml`:

```yaml
name: db-restore-dry-run

# Solo manual. Baja el último daily de R2, lo descifra con la clave de CI
# y lo restaura en un Postgres EFÍMERO del runner para verificar que el
# backup restaura de verdad. Nunca toca producción.
#
# Requiere el secret AGE_DRYRUN_PRIVATE_KEY (par de AGE_DRYRUN_PUBLIC_KEY).
# Si no lo configuras, no podrás usar este workflow: verifica restores a
# mano con tu clave offline siguiendo docs/runbooks/db-backup-restore.md.
on:
  workflow_dispatch: {}

jobs:
  restore-dry-run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - name: Instalar PostgreSQL client 17 (PGDG) y age
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
            --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
            https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update
          sudo apt-get install -y postgresql-client-17 age

      - name: Descargar el último daily de R2
        env:
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
        run: |
          ep="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
          latest="$(aws s3 --endpoint-url "$ep" ls "s3://${R2_BUCKET}/daily/" \
            | awk '{print $4}' | grep -v '/$' | sort | tail -n1)"
          test -n "$latest" || { echo "no hay backups en daily/"; exit 1; }
          echo "Restaurando: $latest"
          aws s3 --endpoint-url "$ep" cp "s3://${R2_BUCKET}/daily/${latest}" dump.sql.gz.age

      - name: Descifrar y restaurar en Postgres efímero
        env:
          AGE_DRYRUN_PRIVATE_KEY: ${{ secrets.AGE_DRYRUN_PRIVATE_KEY }}
        run: |
          test -n "$AGE_DRYRUN_PRIVATE_KEY" || { echo "falta AGE_DRYRUN_PRIVATE_KEY"; exit 1; }
          printf '%s\n' "$AGE_DRYRUN_PRIVATE_KEY" > key.txt
          age -d -i key.txt -o dump.sql.gz dump.sql.gz.age
          rm -f key.txt
          # -v ON_ERROR_STOP=1: el restore falla si cualquier sentencia falla.
          gunzip -c dump.sql.gz | psql -v ON_ERROR_STOP=1 \
            "postgresql://postgres:postgres@localhost:5432/postgres"

      - name: Verificar tablas clave restauradas
        run: |
          for t in cars user_guesses daily_stats guess_audit monthly_podium; do
            n="$(psql -tA "postgresql://postgres:postgres@localhost:5432/postgres" \
              -c "select count(*) from to_regclass('public.${t}') is not null;" 2>/dev/null || echo "")"
            psql -tA "postgresql://postgres:postgres@localhost:5432/postgres" \
              -c "select 'public.${t}'::regclass;" >/dev/null \
              || { echo "FALTA tabla public.${t} tras restore"; exit 1; }
            echo "ok - public.${t} restaurada"
          done
          echo "RESTORE DRY-RUN OK"
```

- [ ] **Step 2: Validar que el YAML parsea**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/db-restore-dry-run.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/db-restore-dry-run.yml
git commit -m "ci(backups): workflow manual de restore-dry-run en Postgres efímero"
```

---

## Task 6: Runbook de restore y secrets (`docs/runbooks/db-backup-restore.md`)

**Files:**
- Create: `docs/runbooks/db-backup-restore.md`

- [ ] **Step 1: Escribir el runbook**

Create `docs/runbooks/db-backup-restore.md`:

```markdown
# Runbook — Backup y restore de la base de datos

Backups diarios cifrados en Cloudflare R2 vía GitHub Actions. Ver diseño en
`docs/superpowers/specs/2026-06-14-db-backups-design.md`.

## Qué se respalda

`pg_dump` completo (esquema + datos + RLS + funciones + triggers + grants) de
todos los schemas que el rol del pooler puede leer. Rotación GFS: 7 diarios,
4 semanales, 6 mensuales, en `daily/`, `weekly/`, `monthly/` del bucket.

> **Caveat schema `auth`:** `auth.users` (emails) lo gestiona Supabase y puede
> no restaurar tal cual en un proyecto nuevo. Las filas de `user_guesses`
> referencian `user_id`; si `auth.users` se pierde, los datos quedan huérfanos
> hasta recrear los usuarios. Para DR total de la identidad usa también el
> backup gestionado de Supabase.

## Secrets necesarios (GitHub → Settings → Secrets → Actions)

| Secret | Qué es |
|---|---|
| `SUPABASE_DB_URL` | Connection string del Session Pooler (Supabase → Database → Connection string → Session pooler) |
| `AGE_PUBLIC_KEY` | Clave pública age de RECUPERACIÓN. Genera el par con `age-keygen -o key-recuperacion.txt`; **guarda el fichero (clave privada) offline** (1Password, etc.) y pon aquí solo la línea `# public key:` |
| `R2_ACCOUNT_ID` | Account ID de Cloudflare |
| `R2_BUCKET` | Nombre del bucket R2 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | API token de R2 con permiso Object Read & Write acotado al bucket |
| `AGE_DRYRUN_PUBLIC_KEY` / `AGE_DRYRUN_PRIVATE_KEY` | *(Opcional)* Par de claves SOLO para el restore-dry-run automático. Genera otro par con `age-keygen`. Permite que el workflow descifre sin sacar tu clave de recuperación de su sitio offline. Si los omites, el dry-run automático no funciona y verificas restores a mano (ver abajo). |

## Generar las claves age

```bash
# Clave de recuperación (la privada va OFFLINE):
age-keygen -o key-recuperacion.txt   # imprime la pública por stderr
# Clave de CI (ambas partes a GitHub):
age-keygen -o key-ci.txt
```
- `AGE_PUBLIC_KEY` = la línea `age1...` pública de `key-recuperacion.txt`.
- `AGE_DRYRUN_PUBLIC_KEY` = la pública de `key-ci.txt`.
- `AGE_DRYRUN_PRIVATE_KEY` = el contenido completo de `key-ci.txt`.

## Restore — Escenario A: corrupción de UNA tabla (lo más probable)

```bash
# 1. Baja el último dump bueno (ajusta endpoint/bucket).
EP="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
aws s3 --endpoint-url "$EP" ls s3://<BUCKET>/daily/
aws s3 --endpoint-url "$EP" cp s3://<BUCKET>/daily/<FECHA>.sql.gz.age .

# 2. Descifra con tu clave de recuperación OFFLINE.
age -d -i key-recuperacion.txt -o dump.sql.gz <FECHA>.sql.gz.age
gunzip dump.sql.gz   # -> dump.sql

# 3. Extrae SOLO la tabla afectada del dump plano y aplícala.
#    Revisa antes en un Postgres local si tienes dudas.
#    Ejemplo para 'user_guesses': filtra su bloque COPY/INSERT y CREATE.
#    Lo más seguro: restaura el dump entero en un Postgres temporal local,
#    haz pg_dump --table=public.user_guesses --data-only de ahí, y aplícalo
#    a producción tras truncar la tabla corrupta.
psql "$SUPABASE_DB_URL" -c "TRUNCATE public.user_guesses;"   # ¡con cuidado!
psql "$SUPABASE_DB_URL" -f solo-user_guesses.sql
```

## Restore — Escenario B: desastre total (reconstruir la DB)

```bash
# 1. Baja y descifra el dump completo (igual que arriba, pasos 1-2).
# 2. Aplícalo sobre un proyecto Supabase LIMPIO. ON_ERROR_STOP para abortar
#    al primer error en vez de dejar la DB a medias.
gunzip -c dump.sql.gz | psql -v ON_ERROR_STOP=1 "$NUEVA_SUPABASE_DB_URL"
# 3. Revisa el caveat de auth: recrea usuarios si auth.users no restauró.
```

## Verificación periódica del backup

- **Automática:** lanza el workflow `db-restore-dry-run` (Actions → Run
  workflow). Restaura el último daily en un Postgres efímero y comprueba las
  tablas clave. Hazlo al menos una vez al mes.
- **Manual (si no usas la clave de CI):** repite el Escenario B contra un
  Postgres local con tu clave de recuperación offline.

## Si un backup falla

GitHub envía email automático al fallar el workflow. Causas típicas:
- Secret ausente/rotado → revisa Settings → Secrets.
- `pg_dump` versión < servidor → sube `postgresql-client-N` en el workflow.
- Pooler caído → reintenta con `workflow_dispatch`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/db-backup-restore.md
git commit -m "docs(backups): runbook de restore y gestión de claves"
```

---

## Task 7: Verificación viva y PR (requiere secrets provisionados por el usuario)

**Precondición (la hace el usuario, no el agente):** crear el bucket R2, el
token R2, las claves `age`, obtener la connection string del Session Pooler, y
cargar todos los secrets en GitHub. Sin esto, los workflows fallarán por
secrets ausentes (comportamiento esperado).

- [ ] **Step 1: Abrir el PR `claude/db-backups` → `main`**

```bash
git push -u origin claude/db-backups
gh pr create --base main --head claude/db-backups \
  --title "feat(backups): backups diarios cifrados de la DB a R2 (C2)" \
  --body "Implementa el diseño docs/superpowers/specs/2026-06-14-db-backups-design.md. Ver checklist de secrets en docs/runbooks/db-backup-restore.md."
```
Expected: URL del PR creado.

- [ ] **Step 2: (Usuario) provisionar secrets y lanzar el backup a mano**

En GitHub → Actions → `db-backup` → Run workflow. Verificar que el run pasa
verde y que aparece el objeto `daily/<hoy>.sql.gz.age` en el bucket R2.

- [ ] **Step 3: (Usuario) lanzar `db-restore-dry-run`**

En GitHub → Actions → `db-restore-dry-run` → Run workflow. Verificar que
termina con `RESTORE DRY-RUN OK`.

- [ ] **Step 4: Confirmar y mergear**

Con ambos workflows en verde, mergear el PR. El backup queda activo en su cron
nocturno.

---

## Self-Review (cobertura del spec)

- Alcance esquema+datos → Task 3 (`pg_dump -Fp` sin `--no-owner/--no-privileges`). ✔
- Motor `pg_dump` → Tasks 3-5. ✔
- Runner GitHub Actions → Tasks 4-5. ✔
- Destino R2 → Tasks 3-5 (endpoint S3-compatible). ✔
- Cifrado `age` → Task 3 (+ doble destinatario para el dry-run). ✔
- Rotación GFS 7/4/6 → Task 1 (lógica) + Task 3 (`prune_tier`). ✔
- Cadencia diaria ~03:00 Madrid → Task 4 (`cron: 0 1 * * *`, UTC). ✔
- `workflow_dispatch` manual → Tasks 4-5. ✔
- Verificación post-dump → Task 2 + uso en Task 3. ✔
- Caveat schema `auth` → Task 6 (runbook). ✔
- Runbook restore (tabla / desastre total) → Task 6. ✔
- Restore-dry-run en DB efímera → Task 5. ✔
- Alerta por email de GH al fallar → Task 6 (documentado; nativo de GH). ✔
- Secrets que crea el usuario → Task 6 + Task 7. ✔

Refinamiento sobre el spec: se añaden los secrets opcionales
`AGE_DRYRUN_PUBLIC_KEY` / `AGE_DRYRUN_PRIVATE_KEY` para permitir el dry-run
automático sin sacar la clave de recuperación de offline. El spec se sincroniza
con esta nota.
```
