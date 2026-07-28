# El correo del enlace de acceso

Plantilla del *magic link* y notas de configuración del envío. Vive aquí y no en
el código porque se edita en el dashboard de Supabase
(**Authentication → Email Templates → «Magic link or OTP»**), pero se versiona
igual que el SQL de `scripts/`: es parte del producto, no un ajuste suelto.

## Por qué se personaliza

La plantilla que trae Supabase de fábrica es un párrafo genérico **en inglés**,
sin remitente reconocible y con el aspecto de un correo de sistema. A un jugador
español que acaba de leer «El diario de los que reconocen un coche por el faro»
le llega eso y parece de otra empresa — justo en el paso donde se está decidiendo
a entrar.

**Un solo correo bilingüe, español primero.** Las plantillas de Supabase son una
por proyecto: no hay selección por idioma del usuario como en `i18n/`. Con la
audiencia mayoritariamente española y una minoría en inglés, un correo con las
dos versiones cuesta cuatro líneas y no deja fuera a nadie. Si algún día el
tráfico en inglés justifica separarlas, hará falta enviar el correo desde una
Edge Function en vez de por la plantilla del dashboard.

## Restricciones de un correo, que no son las de la web

- **Sin fuentes web.** Fraunces no carga en Gmail ni en Outlook. Se usa Georgia,
  que es exactamente el *fallback* que ya declara `--font-display` en
  `index.css`, así que la caída es la prevista y no una improvisación.
- **Estilos en línea.** Los clientes de correo tiran las hojas `<style>`.
- **Sin imágenes.** Muchos clientes las bloquean por defecto: un correo cuya
  identidad dependa de una imagen llega roto. Aquí la identidad es tipográfica,
  que además es el lenguaje del tema.
- **Colores literales.** No hay variables CSS: el rojo de rotativa va como
  `#b3271b` a pelo. Es la única excepción legítima a la regla 16 — no hay
  `:root` que consultar al otro lado.
- **`{{ .ConfirmationURL }}`** es la única variable imprescindible. Supabase la
  sustituye por el enlace firmado.

## La plantilla

Pégala tal cual en el cuerpo del mensaje. El asunto va aparte, arriba.

**Asunto:** `Tu entrada al Coche del Día`

```html
<div style="margin:0;padding:24px;background:#f5f1e8;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background:#faf7f0;border:1px solid #d8d0bf;padding:32px 28px;">

    <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8a8172;">
      Edición del día
    </p>
    <p style="margin:0;font-size:30px;line-height:1.05;font-weight:bold;color:#1b1712;">
      Coche del Día
    </p>

    <div style="border-top:3px double #1b1712;border-bottom:3px double #1b1712;margin:20px 0 24px;padding:6px 0;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#1b1712;">
        Tu entrada · Your pass
      </p>
    </div>

    <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#1b1712;">
      Pulsa el botón y entras. No hay contraseña que recordar.
    </p>

    <a href="{{ .ConfirmationURL }}"
       style="display:block;background:#b3271b;color:#faf7f0;text-decoration:none;text-align:center;padding:14px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;">
      Entrar al juego
    </a>

    <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6355;">
      El enlace caduca en una hora y solo funciona una vez. Si no has pedido
      entrar, ignora este correo: no pasa nada.
    </p>

    <div style="border-top:1px solid #d8d0bf;margin:24px 0 0;padding-top:16px;">
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6355;">
        <strong style="color:#1b1712;">In English —</strong> Tap the button above
        to sign in. No password needed. The link expires in one hour and works
        only once. If you didn’t request it, just ignore this email.
      </p>
    </div>

    <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8a8172;text-align:center;">
      cochedeldia.com
    </p>

  </div>
</div>
```

## Configuración del envío

| Ajuste | Dónde | Valor |
|---|---|---|
| SMTP | `/auth/smtp` | `smtp.resend.com` · 465 · usuario `resend` · contraseña = API key de Resend (permiso **Sending access**, no Full) |
| Remitente | `/auth/smtp` | `redaccion@cochedeldia.com` · «Coche del Día» |
| Límite de envío | `/auth/rate-limits` | Supabase lo deja en **30/hora** al guardar el SMTP. Súbelo. |
| Redirect URL | `/auth/url-configuration` | `https://cochedeldia.com` debe estar en la lista |
| Interruptor de la web | Vercel env | `VITE_EMAIL_LOGIN=true` (ver `emailLoginDisponible()` en `src/lib/auth.js`) |

**Dos techos independientes**, y frena el más bajo de los dos:
el de Supabase (`/auth/rate-limits`) y el del plan gratuito de Resend
(3.000/mes con tope de 100/día).

## DNS del dominio (ya aplicado, aquí por si hay que rehacerlo)

Registrados en Namecheap (**Advanced DNS**; los MX viven aparte, en la sección
**Mail Settings** de esa misma página):

| Tipo | Host | Valor |
|---|---|---|
| TXT | `resend._domainkey` | clave pública DKIM |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` (prio 10) |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

**Ojo al SPF.** Un dominio admite **un solo** registro SPF; dos y los dos quedan
inválidos. El de Resend va en el subdominio `send`, así que NO choca con el SPF
raíz de ImprovMX (`v=spf1 include:spf.improvmx.com ~all`) que gobierna el correo
entrante de `@cochedeldia.com`. Si algún proveedor pidiera alguna vez un SPF en
la raíz, hay que **fusionar** los `include:` en un único registro, nunca añadir
un segundo.

Verificación desde Windows (sin `dig`, que no viene de serie):

```
powershell -Command "Resolve-DnsName resend._domainkey.cochedeldia.com -Type TXT -Server 8.8.8.8 -DnsOnly"
```

## Antes de encender el flag

1. Pídete un enlace a ti mismo.
2. Comprueba que llega a **bandeja de entrada y no a spam** (es lo que verifican
   DKIM y SPF; si cae en spam, algo del DNS no está bien).
3. Ábrelo y confirma que vuelves a `cochedeldia.com` con la sesión creada.
4. Solo entonces, `VITE_EMAIL_LOGIN=true` y redeploy.

Encender el flag antes de verificar la entrega es publicar una puerta sin saber
si abre.
