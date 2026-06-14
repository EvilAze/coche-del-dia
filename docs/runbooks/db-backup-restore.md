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
