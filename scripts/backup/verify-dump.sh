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

# Descomprimimos a un fichero temporal y hacemos grep SOBRE EL FICHERO (no por
# pipe). Con `set -o pipefail`, un `zgrep -q` que encuentra el match y sale
# antes de tiempo provoca SIGPIPE en el gzip de aguas arriba ("Broken pipe"),
# y el pipeline se reporta como FALLO aunque la tabla exista. Solo se nota con
# dumps grandes (el match aparece lejos del final, donde el gzip aún escribe).
# Grep sobre fichero no tiene pipe que romper, así que evita el falso negativo.
sql="$(mktemp)"
trap 'rm -f "$sql"' EXIT
gunzip -c "$dump" > "$sql"

for t in "${REQUIRED_TABLES[@]}"; do
  if ! grep -qE "CREATE TABLE (public\.)?${t}\b" "$sql"; then
    echo "[verify] ERROR: falta la tabla '$t' en el dump" >&2
    exit 1
  fi
done

echo "[verify] OK: dump válido, ${#REQUIRED_TABLES[@]} tablas clave presentes"
