# Runbook — Monitorización de uptime

Health endpoint propio (`/api/health`) + Better Stack pingueándolo. Ver diseño
en `docs/superpowers/specs/2026-06-14-uptime-monitoring-design.md`.

## Qué detecta

- `/api/health` devuelve **503** si Supabase no responde (timeout 4 s) → caza
  "Supabase caído" aunque la home estática siga sirviéndose.
- También caza función/deploy caídos (no responde / 5xx).
- Un segundo monitor a `/` caza el sitio totalmente caído (DNS, Vercel, dominio).

## Comprobar el endpoint a mano

```bash
curl -i https://cochedeldia.com/api/health
# Sano:    HTTP/2 200  →  {"status":"ok","db":"up"}
# DB mal:  HTTP/2 503  →  {"status":"error","db":"down"}
```

## Configurar Better Stack

1. Crear cuenta en Better Stack (Uptime). **Monitors → Create monitor**.
2. **Monitor A — API/DB:**
   - URL: `https://cochedeldia.com/api/health`
   - Check frequency: 3 minutos
   - Expected HTTP status: `200`
   - "Required keyword" (body contains): `ok`
3. **Monitor B — Home:**
   - URL: `https://cochedeldia.com/`
   - Check frequency: 3 minutos
   - Expected HTTP status: `200`

## Alertas a Telegram

1. En Better Stack: **Integrations → Telegram** (o al crear el monitor,
   sección de notificaciones).
2. Sigue el flujo: Better Stack da un enlace/bot; ábrelo en Telegram y pulsa
   **Start** en el chat donde quieras los avisos.
3. Asigna esa integración como canal de notificación de **ambos** monitores.

## Verificar que la alerta llega

- En el monitor, usa **"Send test notification"** (o pausa el monitor y cambia
  temporalmente la URL a una inexistente para forzar un incidente real).
- Debe llegarte el mensaje a Telegram. Restaura la URL después.

## Opcional (fuera del alcance actual)

- **Status page** pública de Better Stack (Monitors → Status pages).
- Check **synthetic** con navegador (Checkly/WebKit) para cazar roturas de JS
  específicas de Safari móvil.
