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
