# Runbook — Rate limit distribuido (Upstash)

Rate limit con Upstash Redis aplicado a `/api/get-daily-car` (60/min/IP) y
`/api/validate-guess` (30/min/IP). Ver diseño en
`docs/superpowers/specs/2026-06-14-rate-limit-distribuido-design.md`.

## Provisión (una vez)

1. Crear cuenta en Upstash y una **Redis database**.
   - Región: cercana a `fra1` (p. ej. `eu-central-1` / `eu-west-1`) para
     minimizar la latencia que añade el check al primer paint.
   - Tipo: Regional (no Global) basta y gasta menos cuota.
2. En la página de la DB, copiar las credenciales **REST**:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Añadirlas como **env vars en Vercel** (Production + Preview).

Sin estas envs el rate limit hace **fail-open** (no limita, no rompe nada): el
juego funciona, simplemente sin protección hasta que las configures.

## Cómo funciona

- Ventana deslizante de 60 s por IP, prefijos `gdc:` (get-daily-car) y `vg:`
  (validate-guess).
- **Fail-open**: si Upstash cae/tarda/sin cuota, las peticiones pasan.
- Al superar el límite: `429` + cabecera `Retry-After` (segundos).

## Probar que funciona

Con Upstash ya configurado en producción:

```bash
# 70 peticiones rápidas: las primeras 60 → 200, luego deberían aparecer 429.
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code}\n" https://cochedeldia.com/api/get-daily-car
done | sort | uniq -c
# Esperado: ~60 líneas "200" y ~10 líneas "429".
```

Comprobar también que el juego carga con normalidad en el navegador (un usuario
real no se acerca a 60/min).

## Cuota de Upstash

Cada visita a get-daily-car consume ~1 comando de Upstash. Si el tráfico crece y
te acercas al tope del free tier, opciones: subir de plan, o resolver la carga
de get-daily-car con caché (pieza P1 de la auditoría) para reducir su volumen.
