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

# Regresión: con un dump GRANDE (las tablas al principio y mucho contenido
# después) un `zgrep -q` bajo pipefail daba falso negativo por SIGPIPE/Broken
# pipe. Este fixture lo reproduce; debe ACEPTARSE. Los fixtures pequeños de
# arriba no cazaban el bug porque el gzip terminaba antes del early-exit.
big="$tmp/big.sql.gz"
# Relleno con awk (no `yes | head`): bajo `set -o pipefail` el SIGPIPE de
# `yes` al cerrar `head` abortaría esta misma suite de tests.
{ for t in cars user_guesses daily_stats guess_audit monthly_podium; do
    printf 'CREATE TABLE public.%s (id int);\n' "$t"
  done
  awk 'BEGIN { for (i = 0; i < 200000; i++) print "INSERT INTO public.cars VALUES (1, '\''relleno relleno relleno'\'');" }'
} | gzip > "$big"
if bash "$HERE/verify-dump.sh" "$big" >/dev/null 2>&1; then
  check "verify-dump dump grande aceptado (regresión SIGPIPE)" "ok" "ok"
else
  check "verify-dump dump grande aceptado (regresión SIGPIPE)" "ok" "fallo"
fi

if [ "$fail" -ne 0 ]; then echo "TESTS FALLIDOS"; exit 1; fi
echo "TODOS LOS TESTS OK"
