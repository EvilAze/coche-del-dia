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
#
# Capturamos el stderr de pg_dump y comprobamos el pipeline con pipefail: si
# pg_dump falla (conexión, pooler en modo TRANSACCIÓN que no soporta pg_dump,
# permisos), queremos ver SU error real, no un críptico "broken pipe" del
# gzip de aguas abajo.
err_log="$work/pg_dump.err"
if ! pg_dump --format=plain --no-password "$SUPABASE_DB_URL" 2>"$err_log" | gzip > "$dump"; then
  echo "[backup] ERROR: pg_dump falló. stderr:" >&2
  cat "$err_log" >&2
  exit 1
fi
# pg_dump puede salir 0 pero con avisos o un dump incompleto: mostramos su
# stderr (si hay) y el tamaño del dump para diagnosticar.
[ -s "$err_log" ] && { echo "[backup] stderr de pg_dump:" >&2; cat "$err_log" >&2; }
echo "[backup] dump: $(stat -c%s "$dump") bytes comprimidos"

# Si verify falla, volcamos diagnóstico: qué se respaldó realmente (¿vacío?,
# ¿otro schema?, ¿error embebido?) y qué tablas contiene.
if ! bash "$HERE/verify-dump.sh" "$dump"; then
  echo "[backup] --- primeras 40 líneas del dump (diagnóstico) ---" >&2
  gunzip -c "$dump" | head -40 >&2 || true
  echo "[backup] --- CREATE TABLE encontradas en el dump ---" >&2
  gunzip -c "$dump" | grep -E "^CREATE TABLE" >&2 || echo "(ninguna)" >&2
  exit 1
fi

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
