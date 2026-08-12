# Runbook — Panel interno en su propio host

El panel de administración (`/admin-tools`) ya no vive en `cochedeldia.com`:
tiene un **subdominio propio** con una puerta de cookie delante, y en el host
público **no se monta**.

## Por qué

Dos problemas que no se arreglan con más autenticación:

1. **El App Link se lo comía.** `android/app/src/main/AndroidManifest.xml`
   declara `cochedeldia.com` con `autoVerify` y **sin `pathPattern`** — a
   propósito: la app es la misma SPA y atiende cualquier ruta, que es lo que
   hace que un resultado compartido por WhatsApp abra la app. Efecto colateral:
   un clic en un resultado de Google hacia `/admin-tools` abría **la app** en
   vez del navegador. Los intent filters de Android **no tienen negación**: no
   se puede excluir una ruta sin declarar rutas concretas y romper los enlaces
   compartidos. La única salida es un host que el manifest no declare.
2. **Estaba a la vista.** Cualquiera podía cargar la pantalla de login y saber
   que existe. Los datos nunca estuvieron expuestos (`requireAdmin` exige sesión
   de Google + email en `ADMIN_EMAILS`), pero esa capa aquí sale casi gratis.

## Cómo queda

| URL | Qué pasa |
|---|---|
| `cochedeldia.com/admin-tools` | El middleware no se mete y la SPA **no monta el panel**: se comporta como cualquier ruta inexistente (cae a la portada). Un 404 solo en esa ruta sería la confirmación de que ahí hay algo. |
| `<ADMIN_HOST>/` | 307 a `/admin-tools`. Es el `start_url` del icono instalado en el móvil. |
| `<ADMIN_HOST>/admin-tools?k=<clave>` | Deja la cookie de la puerta y redirige a la URL limpia (la clave no se queda en la barra ni viaja en el `Referer`). |
| `<ADMIN_HOST>/admin-tools` | Con cookie, pasa. Sin cookie, **404 seco**. |

Piezas:

- `api/_lib/edge/admin-gate.js` — la decisión, lógica pura, con su suite
  (`admin-gate.test.js`). **Los tests son la verificación**: el comportamiento
  depende del `Host` de la petición y un Preview de Vercel tiene una URL
  distinta en cada deploy.
- `middleware.js` — traduce la decisión a respuesta del Edge Runtime.
- `src/index.jsx` — el guard de hostname (`VITE_ADMIN_HOST`) que impide que el
  panel se pinte en el host público.

## Provisión (una vez)

1. **Elige el nombre del subdominio.** Que **no** sea `admin`: Vercel emite un
   certificado por dominio y los certificados se publican en los logs de
   **Certificate Transparency**, que cualquiera puede consultar — el nombre del
   host es público por diseño. Algo anodino (`taller.cochedeldia.com`) no
   anuncia lo que hay detrás.
2. **Vercel → Settings → Domains** → añade el subdominio **al mismo proyecto**.
   Sin rewrite ni configuración extra: sirve el mismo build.
3. **Genera la clave** (cualquier cadena larga y aleatoria):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
4. **Vercel → Settings → Environment Variables** (Production, y Preview si
   quieres probarlo allí):

   | Variable | Valor | Para qué |
   |---|---|---|
   | `ADMIN_HOST` | `taller.cochedeldia.com` | Host que vigila el middleware |
   | `ADMIN_GATE_KEY` | la clave del paso 3 | Clave del enlace de arranque |
   | `VITE_ADMIN_HOST` | `taller.cochedeldia.com` | Guard del cliente (mismo valor) |

   `VITE_` va aparte porque el guard del cliente se resuelve **en build**, no en
   runtime.
5. **Redeploy.** Las tres lo necesitan: `VITE_ADMIN_HOST` se resuelve en build,
   y las de Edge Middleware se inyectan en el deploy — cambiarlas en el panel de
   Vercel no afecta al despliegue que ya está sirviendo.
6. **Supabase → Authentication → URL Configuration → Redirect URLs**: añade
   `https://taller.cochedeldia.com/**`. El login del panel usa
   `redirectTo: window.location.href`, así que sin esto el OAuth de Google
   vuelve a un host no autorizado y falla.
7. **Entra una vez por dispositivo** con
   `https://taller.cochedeldia.com/admin-tools?k=<clave>`.
   **Guarda ese enlace en el gestor de contraseñas**: es la única forma de
   volver a abrir la puerta si se pierde la cookie.
8. **(Opcional) Icono en el móvil.** Chrome → menú → *Instalar aplicación*. La
   PWA se instala contra ese host y arranca en `/` → 307 → el panel. Se muestra
   con el nombre y el icono del juego (el `manifest.json` es el mismo): es un
   icono más en el lanzador, sin nada que lo delate.

## Operación

**Rotar la clave.** Cambia `ADMIN_GATE_KEY` y redeploya. Invalida de golpe
**todas** las cookies emitidas (la cookie guarda la clave), así que toca volver
a pasar por el enlace de arranque en cada dispositivo. Es lo que hay que hacer
si se pierde un móvil.

**Desactivar la puerta (interruptor de emergencia).** Borra `ADMIN_HOST` (o
`ADMIN_GATE_KEY`) y redeploya: el middleware vuelve a ser ajeno a todo. Para
que además el panel responda otra vez en el apex, borra también
`VITE_ADMIN_HOST` — esa sí necesita build nuevo.

**Si te quedas fuera.** La ruta de escape es el paso anterior. Mientras tanto,
Supabase Studio da acceso a las tablas; lo que no hay es calendario, previews
ni descripciones con IA.

## Lo que esto NO cubre

- **El nombre del host es público** (Certificate Transparency, ver paso 1).
- **El chunk JS del panel** (`assets/AdminTools-*.js`) se sirve con el mismo
  nombre hasheado en los dos hosts, y el bundle principal contiene la cadena
  `/admin-tools`. Esconderlo de verdad pediría un segundo build de Vercel, y no
  compensa: sin sesión de admin ese chunk no hace nada.
- **La autorización real sigue siendo `requireAdmin`** en el servidor (sesión de
  Google + `ADMIN_EMAILS`). La puerta reduce **quién ve** el panel, no quién
  puede usarlo. Si alguna vez hay que revocar acceso de verdad, es ahí.
