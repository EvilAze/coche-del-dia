# Los correos de entrada

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

**Si tocas una, toca la otra: mismo HTML y mismo asunto.** No es pereza. Las dos
plantillas admiten las mismas variables (`{{ .Token }}` y
`{{ .ConfirmationURL }}`), el texto está escrito para valer en ambas —no dice
«bienvenido» ni «confirma tu cambio de correo», dice «aquí tienes tu entrada»— y
sobre todo: **desde el lado del jugador no hay dos casos.** Pidió entrar y le
llega cómo entrar. Que por dentro sea `signInWithOtp` o `updateUser` es un
detalle de nuestra base de datos, y darle un asunto distinto según el día sería
contarle una distinción que no es suya.

Los dos caminos mandan además el mismo `emailRedirectTo` desde el código (ver
`destinoDelEnlace()` en `src/lib/auth.js`), así que el enlace vuelve al mismo
sitio venga por donde venga, sin depender del Site URL del dashboard.

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

## Las dos cosas: enlace Y código

El correo lleva `{{ .ConfirmationURL }}` **y** `{{ .Token }}`, y cada uno sirve
a un sitio distinto:

- **En escritorio se pulsa el enlace.** Es un click y estás dentro; teclear seis
  cifras ahí sería trabajo de más.
- **En móvil se teclea el código.** El enlace en un móvil NO es un click: es
  salir del navegador, abrir el correo, buscar el mensaje, pulsar y volver. Ahí
  las seis cifras son menos gesto, y no se sale de la pantalla.

**Son el MISMO token, así que usar uno invalida el otro.** Eso no molesta en la
web —quien pulsa el enlace ya está dentro y la pestaña donde pidió el código se
cierra sola (ver el efecto de `recienEntrado` en `App.jsx`)— pero es exactamente
por lo que **la segunda puerta está apagada dentro de la app**: un jugador del
APK que pulse el enlace por costumbre acaba logueado en el navegador, con el
código muerto y sin sesión donde estaba jugando. Lo decide
`emailLoginDisponible()` en `src/lib/auth.js`; el porqué está escrito allí.

Si algún día se retira el enlace y el correo se queda solo con el código, esa
exclusión se va con él y el APK gana su segunda puerta.

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
- **Dos variables, las dos imprescindibles:** `{{ .Token }}` (las seis cifras) y
  `{{ .ConfirmationURL }}` (el enlace firmado). Si falta una, media audiencia se
  queda sin su camino — ver «Las dos cosas» más arriba.

## La plantilla (la MISMA en las dos)

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
      Escribe estas seis cifras donde te las pide el juego. No hay contraseña
      que recordar.
    </p>

    <p style="margin:0;background:#1b1712;color:#faf7f0;text-align:center;padding:18px 12px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:.32em;">
      {{ .Token }}
    </p>

    <p style="margin:20px 0 12px;font-size:13px;line-height:1.5;color:#6b6355;">
      ¿Lo estás leyendo en el ordenador? Pulsa aquí y entras directamente:
    </p>

    <a href="{{ .ConfirmationURL }}"
       style="display:block;background:#b3271b;color:#faf7f0;text-decoration:none;text-align:center;padding:14px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;">
      Entrar al juego
    </a>

    <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6355;">
      Cualquiera de los dos vale, y solo uno: al usar uno, el otro deja de
      funcionar. Caducan en una hora. Si no has pedido entrar, ignora este
      correo: no pasa nada.
    </p>

    <div style="border-top:1px solid #d8d0bf;margin:24px 0 0;padding-top:16px;">
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6355;">
        <strong style="color:#1b1712;">In English —</strong> Type these six digits
        where the game asks for them, or tap the button above if you're on a
        computer. No password needed. Either one works, and only one: using one
        disables the other. Both expire in an hour. If you didn't request it,
        just ignore this email.
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
4. Canjea con el **código** y confirma que en el caso 2 **la racha sobrevive**.
   Es la comprobación que más importa de todas: es la razón de ser de la
   vinculación por `updateUser`.
5. Pídete otro y canjea con el **enlace**, que es el otro camino del mismo
   correo. Comprueba de paso que la pestaña donde pediste el código se cierra
   sola al entrar (lo hace el efecto de `recienEntrado` en `App.jsx`).
6. Solo entonces, `VITE_EMAIL_LOGIN=true` y redeploy.

Encender el flag antes de verificar la entrega es publicar una puerta sin saber
si abre. Y probar solo el caso 1 es probar el camino que casi nadie recorre: la
sesión anónima nace en el PRIMER INTENTO, así que quien pide entrar desde el
final de la partida —o sea, casi todo el mundo— va por el 2.

**Nada de esto hay que probarlo en la app**, porque allí la segunda puerta está
apagada a propósito: el correo lleva enlace, y el enlace desde el APK deja al
jugador logueado en el navegador y a medias. Ver `emailLoginDisponible()`.
