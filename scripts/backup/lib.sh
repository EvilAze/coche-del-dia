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
