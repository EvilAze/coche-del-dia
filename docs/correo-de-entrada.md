# Los correos de entrada

> **LA PUERTA ESTÁ CERRADA HOY.** `VITE_EMAIL_LOGIN=false`: la entrada por
> correo no se le ofrece a nadie, así que ninguna de estas dos plantillas se
> envía. No es un pendiente ni una avería — es una decisión de producto: la
> puerta de entrada es de un solo toque (Google) y no se le pone al lado un
> camino que pide teclear un correo y esperar. El flujo está implementado,
> probado y listo; esto se lee cuando se decida encenderlo, y lo que decidirá
> eso son los datos del embudo (`login_prompt_shown` → `login_success`), no una
> intuición. Encender = poner el flag a `true` en Vercel, después de repasar
> todo lo de abajo.

Plantillas del código de acceso y notas de configuración del envío. Viven aquí y
no en el código porque se editan en el dashboard de Supabase
(**Authentication → Email Templates**), pero se versionan igual que el SQL de
`scripts/`: son parte del producto, no un ajuste suelto.

## SON DOS PLANTILLAS, NO UNA

Es el error que estuvo en producción y que costó descubrir, porque desde el
código no se ve: `src/lib/auth.js` llama a dos funciones distintas de Supabase
según el estado de la sesión, y **cada una usa su propia plantilla**.

| Plantilla | La dispara | Quién cae ahí |
|---|---|---|
| **Magic Link** | `signInWithOtp` | Quien pide entrar ANTES de su primer intento. |
| **Change Email Address** | `updateUser({ email })` | Quien pide entrar con una sesión anónima ya viva. |

Y la segunda es **la normal**. `asegurarSesionAnonima()` crea la sesión en el
primer intento, así que para cuando el jugador ve el CTA de «guarda tu progreso»
al final de la partida ya es anónimo: su correo sale por «Change Email Address».
Personalizar solo «Magic Link» es maquetar con esmero el correo que casi nadie
recibe.

**Si tocas una, toca la otra.** El contenido es el mismo; lo único que cambia es
dónde se pega.

> El nombre «Magic Link» es de Supabase y no se puede cambiar. Nosotros ya no
> mandamos ningún enlace: esa plantilla es la del código de alta. Ver abajo.

## Por qué se personalizan

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

## El código, no el enlace

`{{ .Token }}` es el protagonista y **`{{ .ConfirmationURL }}` no aparece**. No
es una preferencia estética:

- La plantilla es **una por proyecto**, así que el mismo correo lo lee quien está
  dentro del APK. Allí el enlace o no abre nada útil, o le mete la sesión en el
  navegador del sistema **e invalida el código** que estaba a punto de escribir
  en la app.
- Un correo con dos caminos donde uno rompe al otro es peor que uno con un solo
  camino.

El precio, aceptado: en escritorio hay que teclear seis cifras en vez de pulsar
un botón.

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
- **`{{ .Token }}`** es la única variable imprescindible: Supabase la sustituye
  por las seis cifras. Antes lo era `{{ .ConfirmationURL }}`, el enlace firmado,
  y ya no se usa — ver «El código, no el enlace» más arriba.

## La plantilla (la MISMA en las dos)

Pégala tal cual en el cuerpo del mensaje. El asunto va aparte, arriba.

**Asunto:** `Tu código de acceso · Coche del Día`

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
        Tu código · Your code
      </p>
    </div>

    <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#1b1712;">
      Escribe estas seis cifras donde te las pide el juego. No hay contraseña
      que recordar.
    </p>

    <p style="margin:0;background:#1b1712;color:#faf7f0;text-align:center;padding:18px 12px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:.32em;">
      {{ .Token }}
    </p>

    <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6355;">
      El código caduca en una hora y solo funciona una vez. Si no has pedido
      entrar, ignora este correo: no pasa nada.
    </p>

    <div style="border-top:1px solid #d8d0bf;margin:24px 0 0;padding-top:16px;">
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6355;">
        <strong style="color:#1b1712;">In English —</strong> Type these six digits
        where the game asks for them. No password needed. The code expires in one
        hour and works only once. If you didn't request it, just ignore this email.
      </p>
    </div>

    <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8a8172;text-align:center;">
      cochedeldia.com
    </p>

  </div>
</div>
```

**Ojo al `letter-spacing` del código.** Con `.32em` en un monoespaciado de 34px,
seis cifras caben en los 480px de ancho. Si lo subes, en Gmail móvil el código
parte en dos líneas y deja de poderse copiar de un gesto.

## Configuración del envío

| Ajuste | Dónde | Valor |
|---|---|---|
| SMTP | `/auth/smtp` | `smtp.resend.com` · 465 · usuario `resend` · contraseña = API key de Resend (permiso **Sending access**, no Full) |
| Remitente | `/auth/smtp` | `redaccion@cochedeldia.com` · «Coche del Día» |
| Límite de envío | `/auth/rate-limits` | Supabase lo deja en **30/hora** al guardar el SMTP. Súbelo. |
| Redirect URL | `/auth/url-configuration` | `https://cochedeldia.com` debe estar en la lista |
| Plantillas | `/auth/templates` | **Magic Link** Y **Change Email Address**, las dos con el mismo HTML y el mismo asunto |
| Secure email change | `/auth/providers` → Email | Verificar. Con un anónimo no hay correo antiguo que confirmar, así que debería mandar UN solo correo; si mandara dos, hay que desactivarlo. |
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

1. Pídete un código **sin sesión anónima** (ventana nueva, pide entrar antes de
   jugar): comprueba que llega el de «Magic Link».
2. Pídete otro **con sesión anónima** (juega un intento primero, luego pide
   entrar): comprueba que llega el de «Change Email Address» y que es el mismo
   correo maquetado, no el de fábrica en inglés.
3. Los dos, a **bandeja de entrada y no a spam** (es lo que verifican DKIM y
   SPF; si cae en spam, algo del DNS no está bien).
4. Canjea los dos códigos y confirma que en el segundo **la racha sobrevive**.
5. Solo entonces, `VITE_EMAIL_LOGIN=true` y redeploy.

Encender el flag antes de verificar la entrega es publicar una puerta sin saber
si abre. Y probar solo el caso 1 es probar el camino que casi nadie recorre.
