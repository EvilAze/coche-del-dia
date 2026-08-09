# App Android — build y publicación (v1)

App Capacitor que empaqueta la web (`webDir: build`). v1 es **anónima** (sin
login Google) con **recordatorio diario local**. `appId`: `com.cochedeldia`.

> IMPORTANTE: el build web empaquetado (`android/app/src/main/assets/public`)
> está **gitignorado** por Capacitor — NO viaja en el repo. Hay que ejecutar
> `npm run cap:sync` ANTES de compilar para (re)generarlo desde el último build.

> IMPORTANTE (variables de entorno): `vite build` necesita un **`.env`** con
> `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el directorio desde el que
> compilas. `.env` está **gitignorado** y **NO se hereda en los git worktrees**
> (`.claude/worktrees/…`). Si falta, `src/supabaseClient.js` lanza durante la
> evaluación de módulos y la app **se queda en el splash** (antes de que el
> splash pasara a cerrarse desde JS, el síntoma era una pantalla negra; este
> documento decía eso y llevaba un tiempo desactualizado). La consola
> (`chrome://inspect`) muestra `Uncaught Error: Faltan las variables de entorno
> de Supabase`. Desde el repo principal ya está; desde un worktree, copia el
> `.env` antes de `cap:sync`.
>
> El splash ya no se queda ETERNO en ese caso: `src/lib/splash.js` arma un tope
> de 4 s al evaluarse el módulo, y su import va antes que el de `App` justo para
> que se arme aunque `App` reviente (lo ata `src/lib/splash.test.js`). Así el
> fallo se ve —pantalla en blanco con el error en consola— en vez de disfrazarse
> de app colgada. Si la app se queda en el splash MÁS de 4 s, el problema no es
> el bundle: mira `adb logcat`, porque entonces es nativo.

> IMPORTANTE (worktrees): **compila el AAB que subes a Play desde el repo
> principal**, no desde un worktree de `.claude/worktrees/…`. Un worktree no
> tiene `node_modules` propio, así que `cap sync` reescribe
> `android/capacitor.settings.gradle` y `android/app/capacitor.build.gradle`
> apuntando a `../../../../node_modules/…`. Esas rutas solo son válidas dentro
> de ese worktree: si se cuelan en un commit, rompen el build en el repo
> principal y en cualquier clon. Si compilas en un worktree para probar, revisa
> `git status` y revierte esos dos ficheros generados antes de commitear.

## Peso de la app (lee esto antes de subir nada)

Un AAB sano de este proyecto ronda los **6-9 MB**. Si te sale de tres cifras,
algo se ha colado: no lo subas.

**Qué pasó en la v1.0** (versionCode 1, la primera publicada): pesaba ~400 MB.
No fue un cambio de código. `public/coches/` — 185 JPGs de 366 MB, las imágenes
fuente de los coches — vivía en el disco de la máquina de build sin estar en
git. Vite copia `public/` entero a `build/`, y `cap sync` copia `build/` entero
a `android/app/src/main/assets/public`, así que viajaron al APK aunque la app
**nunca** las use en runtime (el juego pide la imagen a `/api/daily-image` y el
garaje a `/api/car-image`, ambos desde el CDN). Al no estar versionadas no
aparecían en ningún diff ni en `git status`. Se borraron en `59e708e` y
`public/coches/` está en `.gitignore`.

**Qué lo impide ahora:** `npm run cap:sync` ejecuta
`scripts/check-bundle-size.mjs` entre el `vite build` y el `cap sync`. Falla si
`build/` pasa de 12 MB, si algún estático pasa de 500 KB, o si encuentra dentro
de `public/` material pesado que git no versiona. Si el script se queja, **el
problema es real**: sube el límite solo si el crecimiento es intencionado.

**De dónde viene el resto del peso** (nativo, no web):
- `minifyEnabled true` + `shrinkResources true` en `release`. Sin R8 el dex iba
  entero (12,6 MB descomprimidos) con Play Services Auth, Credentials, OkHttp y
  coroutines sin podar. Las keep rules las aportan los plugins vía
  `consumerProguardFiles`; lo propio de la app está en `android/app/proguard-rules.pro`.
- `capacitor.config.json` → `plugins.SocialLogin.providers` deja **solo Google**.
  Por defecto `@capgo/capacitor-social-login` empaqueta también el SDK de
  Facebook (~1,7 MB de AARs + 47 recursos `com_facebook_*`), más las rutas de
  Apple y Twitter, que esta app no usa. Con `facebook: false` el plugin compila
  contra sus stubs. **Este ajuste vive en la config de Capacitor, no en gradle**:
  el hook `capacitor:sync:before` del plugin regenera
  `node_modules/@capgo/capacitor-social-login/android/gradle.properties` en cada
  `cap sync`, así que editar ese fichero a mano no sirve de nada.
- `androidResources.localeFilters = ["es", "en"]`: la app solo habla esos dos
  idiomas; el resto de traducciones de androidx sobran.

Tras compilar, comprueba el peso antes de subir:

```bash
ls -lh android/app/build/outputs/bundle/release/app-release.aab
```

## Config nativa: qué hace cada pieza y por qué

`capacitor.config.json` es JSON puro y no admite comentarios, así que el
*porqué* de sus claves vive aquí.

| Clave | Valor | Por qué |
|---|---|---|
| `plugins.SplashScreen.launchAutoHide` | `false` | Antes era el temporizador ciego `launchShowDuration: 800`: a los 800 ms el splash se iba **pintara o no** la app, y un WebView en frío tarda 1-2 s. La secuencia real era splash → hueco vacío → app. Ahora lo cierra `src/lib/splash.js` cuando el primer frame está pintado, con tope de seguridad a 4 s. |
| `plugins.LocalNotifications.smallIcon` | `ic_stat_cdd` | Sin esto el plugin cae a `android.R.drawable.ic_dialog_info`: el recordatorio diario salía con la "i" genérica de Android. |
| `plugins.LocalNotifications.iconColor` | `#E0574A` | Rojo de marca de la edición de **noche**. Se elige ese y no el de día (`#B3271B`) porque la bandeja de notificaciones puede ser clara u oscura y el valor es único: el rojo claro se lee en ambas, el oscuro se apaga sobre bandeja oscura. |
| `plugins.SystemBars.style` | `DEFAULT` | Sustituye al viejo bloque `StatusBar` (el plugin `@capacitor/status-bar` está **desinstalado**). `SystemBars` viene integrado en `@capacitor/core` desde Capacitor 8 y aplica el estilo a la barra de estado **y a la de navegación**; el otro solo tocaba la de estado, así que en «edición de noche» sobre un móvil en modo claro la píldora de gestos quedaba invisible. `DEFAULT` arranca siguiendo el modo del SO —la misma heurística que el anti-FOUC de `index.html`— y `theme.js` lo ajusta al tema real acto seguido. Nota: `backgroundColor` y `overlaysWebView` **no existen** aquí porque con targetSdk 36 Android impone edge-to-edge sin opt-out y no harían nada. |
| `android.backgroundColor` | `#f3eee1` | Solo es el suelo del WebView. El color que manda de verdad lo pone `MainActivity` desde `@color/cdd_window_bg`, que sí tiene variante `values-night`. |

Y en `android/app/src/main/`:

- **`AndroidManifest.xml` → `VIBRATE`**: sin este permiso `navigator.vibrate()`
  es un no-op **silencioso** dentro de un WebView, y todo `src/lib/haptics.js`
  no hacía nada en la app aunque funcionara en la web.
- **`AndroidManifest.xml` → `dataExtractionRules` / `fullBackupContent`**:
  excluyen `app_webview` del backup. Ahí vive el localStorage con el token de
  sesión anónima; restaurarlo en otro móvil **clonaba** la identidad del jugador
  anónimo y los dos dispositivos se pisaban la partida del día.
- **`res/values/colors.xml` + `values-night/`**: paleta de marca. `colorAccent`
  alimenta el cursor y los manipuladores de selección de texto que dibuja el
  WebView — venían en rosa Material. Se aplican vía `AppTheme.NoActionBar` en
  `styles.xml`, que es el tema real de la Activity (**no** hereda de `AppTheme`).

### App Links (los enlaces a cochedeldia.com abren la app)

Dos piezas que tienen que casar:

1. `android/app/src/main/AndroidManifest.xml` → `<intent-filter android:autoVerify="true">`
   con `https://cochedeldia.com`.
2. `public/.well-known/assetlinks.json` → la huella **SHA-256** de la clave que
   firma el APK que llega al usuario.

La huella que va ahí es la de **Play App Signing** (Play Console → Configuración
→ Integridad de la app), **no** la del upload key ni la de debug: Google
re-firma el AAB antes de distribuirlo, así que la app instalada lleva esa.

> **Solo se declara el apex, y es a propósito.** Desde Android 12 la
> verificación es **todo o nada** entre los hosts del manifest: si añades
> `www.` o `carguessr.org` y uno solo de ellos no sirve su `assetlinks.json`,
> se cae la verificación de **todos** — y eso solo se ve en un móvil real ya
> instalado.

Comprobar que el fichero se sirve bien (sin redirección y como JSON):

```bash
curl -sI https://cochedeldia.com/.well-known/assetlinks.json
```

Espera `HTTP/2 200` y `content-type: application/json`. El rewrite SPA de
`vercel.json` ya lo excluye (su patrón descarta cualquier ruta con punto).

Comprobar la verificación en el dispositivo:

```bash
adb shell pm get-app-links com.cochedeldia
```

Debe poner `verified` para `cochedeldia.com`. Un build de **debug** NO
verificará (está firmado con otra clave, que no es la del `assetlinks.json`):
para probarlo antes de publicar, actívalo a mano en Ajustes → Aplicaciones →
Coche del Día → Abrir de forma predeterminada → Añadir enlace.

El enrutado del enlace entrante lo hace `src/lib/deepLink.js` (el WebView sirve
desde `https://localhost`, así que hay que traducir la ruta) y valida esquema y
host: cualquier app puede lanzar un intent explícito a la Activity, el
`intent-filter` solo gobierna lo que Android nos enruta.

### Idioma por app (Android 13+)

`android:localeConfig="@xml/locales_config"` enciende el selector de idioma por
app del sistema (Ajustes → Aplicaciones → Coche del Día → Idioma), con es/en.

Pero declararlo solo no basta: la app YA tiene su propio selector (LanguageStrip
→ override en `localStorage`), y si ese override manda siempre, el del sistema no
hace nada y no hay pista de por qué. Para que ambos convivan hace falta
distinguir *"el usuario eligió este idioma por app"* de *"es el idioma por
defecto del sistema"* — y esa diferencia `navigator.language` no la ve.

`LocaleBridgePlugin.java` la resuelve: expone
`AppCompatDelegate.getApplicationLocales()` (vacío = no elegido) al bundle como
interfaz JS **síncrona** `CochePlatform.getPersistedLocale()`. Se registra en
`load()` —no en `onCreate`— para que exista antes de que cargue la página
(`addJavascriptInterface` no surte efecto hasta la siguiente carga). La
precedencia final la decide `src/i18n/resolveLocale.js`: el selector de la app
sella el idioma nativo vigente al elegir, y si Android cambia después, gana
Android. **Solo lectura**: no llamamos a `setApplicationLocales` para no forzar
recreaciones de la Activity a media partida.

En Android < 13 `getApplicationLocales()` va siempre vacío (nunca lo fijamos),
así que el puente no aporta nada y el idioma se resuelve como siempre (override
→ navegador → defecto). Degradación limpia; nada que probar ahí.

Verificar en dispositivo (API 33+): Ajustes → Coche del Día → Idioma → English,
y la app debe arrancar en inglés aunque antes hubieras tocado el selector de
dentro.

### Regenerar el icono de notificación

Solo hace falta si cambia `assets/brand-logo-source.png`:

```bash
node scripts/gen-notification-icon.mjs
```

Escribe `ic_stat_cdd.png` en las 5 densidades (~4,5 KB en total). Android usa
**solo el canal alfa** del icono y lo tiñe él: un PNG a color sale como un
cuadrado blanco sólido, que es el fallo clásico.

## Toolchain: AGP 9 / Gradle 9

El proyecto compila con **AGP 9.2.1** sobre **Gradle 9.4.1** y **JDK 21**. Las
tres piezas van juntas: AGP 9 no arranca con Gradle 8, y Gradle 9 pide JDK 17+.

La versión de JDK no depende ya de la máquina: `gradle/gradle-daemon-jvm.properties`
fija el criterio del daemon (JetBrains JDK 21) y el plugin
`foojay-resolver-convention` de `settings.gradle` lo **descarga** si no está.
Es la razón de que el primer build tras clonar tarde más y necesite red.

AGP 9 cambia muchos defaults a la vez, así que `android/gradle.properties` los
deja clavados al comportamiento de AGP 8 con una tanda de flags
`android.*`. **Están documentados uno a uno en ese fichero** — léelos antes de
quitar ninguno; los dos de R8 tocan justo lo que mantiene el AAB en ~5 MB. La
idea es ir retirándolos de uno en uno, comprobando peso y arranque real tras
cada uno, no todos de golpe.

## Requisitos (una vez)
- Android Studio (Linux/Fedora nativo; no hace falta Mac).
- JDK 21 — lo trae Android Studio (JBR) y, si no, lo baja Gradle solo (ver
  arriba). Android SDK + plataforma reciente.
- Cuenta **Google Play Developer** (25 $, pago único).
- `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el dir de build
  (ver el aviso de arriba; sin ellas la app sale en negro).
- Variable de build `VITE_PROD_ORIGIN=https://cochedeldia.com` (opcional; por
  defecto ya apunta ahí en `src/lib/apiUrl.js`; solo cámbiala si el dominio
  cambia). `VITE_SENTRY_DSN` es opcional.

## Comprobación previa importante
El apex `cochedeldia.com` debe servir la API **sin redirigir a www** (un 30x
complicaría las llamadas desde la app):

```bash
curl -sI https://cochedeldia.com/api/health | head -5
```
Espera `HTTP/2 200` (no `301/302` a `www.cochedeldia.com`). Si redirige, pon el
host final como `VITE_PROD_ORIGIN` y reconstruye.

## Build local y prueba en emulador/dispositivo
```bash
npm run cap:sync     # vite build + copia el build a android/ (OBLIGATORIO)
npm run cap:open     # abre Android Studio
```
En Android Studio: elige un emulador o un móvil con depuración USB y pulsa Run.
Smoke test: jugar una partida anónima completa (5 intentos), terminar, aceptar
el recordatorio, y comprobar que queda programado. Para ver disparar la
notificación, ajusta la hora del dispositivo cerca de las 10:00.

## Firma (release)
Genera un keystore una sola vez y **guárdalo a buen recaudo** (sin él no puedes
publicar updates):
```bash
keytool -genkey -v -keystore cochedeldia-release.keystore \
  -alias cochedeldia -keyalg RSA -keysize 2048 -validity 10000
```

La firma ya está cableada en `android/app/build.gradle`: lee las credenciales de
**`android/keystore.properties`**, que está en `.gitignore` junto a `*.keystore`
y `*.jks`. Copia la plantilla y rellénala:

```bash
cp android/keystore.properties.example android/keystore.properties
```

El fichero es **opcional**: si no existe, el build sigue funcionando y solo el
`bundleRelease` sale sin firmar. Eso permite que un clon limpio (u otra máquina,
o CI) compile sin tener la clave. **NUNCA** commitees el keystore ni las
contraseñas.

## AAB para Play
```bash
npm run cap:sync            # asegura el build web más reciente dentro de android/
cd android
./gradlew bundleRelease
# salida: android/app/build/outputs/bundle/release/app-release.aab
```
Sube el `.aab` a **Play Console**. Rellena ficha, privacidad (ya existe la
política en /privacidad) y data safety — ojo con esto último, ver más abajo.

## Prueba cerrada (closed testing)

Track por encima de *internal testing*: a diferencia de esa, **pasa revisión de
Google** (de horas a varios días la primera vez), así que la ficha y los
formularios tienen que estar completos antes de subir nada.

### Data safety: la app YA NO es anónima

Este apartado estuvo mal mucho tiempo y es el que más caro sale: declarar de
menos en data safety es motivo de rechazo o de suspensión, no de un aviso.

Desde que existe el login de Google nativo (`@capgo/capacitor-social-login` →
`supabase.auth.signInWithIdToken`), la app **sí recoge datos personales** si el
usuario inicia sesión. La v1 anónima ya no describe lo que se publica: el build
lleva `VITE_GOOGLE_WEB_CLIENT_ID` incrustado y el botón de login es funcional.

Lo que hay que declarar:

| Dato | Se recoge | Se enlaza a identidad | Para qué |
|---|---|---|---|
| Dirección de email | Sí (solo con login) | Sí | Cuenta de usuario |
| Nombre | Sí (solo con login) | Sí | Mostrar perfil / ranking |
| ID de usuario | Sí (solo con login) | Sí | Cuenta y progreso |
| Actividad in-app (partidas, racha, logros) | Sí | Sí con login, no en anónimo | Funcionalidad del juego |

Todo va cifrado en tránsito (HTTPS) y el usuario puede cerrar sesión desde "Mis
estadísticas". La política publicada en `/privacidad` ya lo refleja (menciona
identificador de cuenta, nombre, email y progreso) — el enlace que pide Play es
`https://cochedeldia.com/privacidad`.

Jugar **sin** iniciar sesión sigue siendo posible y no recoge nada
identificable: la sesión anónima es un token local.

### Borrado de cuenta: los DOS caminos que exige Play

Toda app que permita **crear cuenta** tiene que ofrecer un camino para
eliminarla, y son dos cosas distintas que Play pide por separado:

1. **Dentro de la app.** Perfil → *Ajustes* → **Eliminar cuenta**
   (`src/components/DeleteAccountModal.jsx`). Borra de verdad y al instante; no
   es un "escríbenos".
2. **Una URL pública**, que funcione sin instalar nada. Es
   `https://cochedeldia.com/eliminar-cuenta` (`src/EliminarCuenta.jsx`) y va en
   el formulario de Data safety, en el campo de *URL de eliminación de cuenta*.

**Qué declarar exactamente en el formulario**, que es donde se falla: la app
ofrece borrar la cuenta **y parte de los datos**, NO "todos los datos". Play
tiene esa opción concreta y hay que marcarla, porque el registro de partidas se
conserva anonimizado. Declarar "se borra todo" sería una declaración falsa sobre
el comportamiento real, que es motivo de suspensión.

| Qué | Qué le pasa |
|---|---|
| Email, nombre, credenciales, identidad de Google | Se borran (borrado blando de GoTrue: la fila queda sin PII y no puede iniciar sesión) |
| Nickname (`profiles`) | Se borra → sale de ranking, Salón de Campeones y perfiles públicos |
| Suscripciones de push | Se borran |
| Auditoría antifraude (`guess_audit`) | Se desliga: `user_id` a NULL y fuera user-agent e idioma |
| Partidas, stats, snapshots y podios | **Se conservan, ya anónimos** |

El motivo de conservarlos está razonado en la cabecera de
`api/delete-account.js`: todas las tablas cuelgan de `auth.users` con
`ON DELETE CASCADE`, y los podios de meses y temporadas cerrados se
**recalculan** desde `user_guesses`. Un borrado en cascada le cambiaría el
campeón a un mes de hace medio año y afectaría a jugadores que no han pedido
nada. Por eso el borrado es blando y no `deleteUser()` a secas.

Si algún día cambia ese reparto, hay **tres** sitios que dicen lo mismo y tienen
que cambiar a la vez: el endpoint, `/eliminar-cuenta`, la sección 7 de
`/privacidad` — y el formulario de Data safety en Play Console.

### Antes de subir

1. `versionCode` **estrictamente mayor** que el último subido a Play (cualquier
   track: internal y closed comparten numeración). Play rechaza el AAB al
   instante si se repite.
2. AAB **firmado** con el upload key — comprueba que el build no ha salido sin
   firmar (ver "Verificar la firma" abajo). Sin `android/keystore.properties`
   sale sin firmar y Play lo rechaza.
3. Peso razonable (**6-9 MB**; ahora ~5 MB). Si sale de tres cifras, lee la
   sección de peso de arriba antes de subir nada.
4. Testers: en closed testing se invita por **lista de emails o grupo de
   Google**. Los testers tienen que **aceptar la invitación** (les llega un
   enlace de opt-in) o no verán la app en Play.

> **Si la cuenta de desarrollador es personal y se creó después de nov-2023**,
> Google exige un mínimo de **12 testers con el opt-in activo durante 14 días
> seguidos** en un track cerrado antes de poder solicitar acceso a producción.
> Es un contador continuo: si un tester se sale, se reinicia. Confírmalo en
> Play Console → Prueba cerrada, que muestra el estado real de tu cuenta.

### Verificar la firma del AAB antes de subirlo

```bash
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
```

Si responde que no encuentra firma, el AAB salió **sin firmar**: falta
`android/keystore.properties` o tiene credenciales incorrectas.

Recuerda que la SHA-256 que va en `public/.well-known/assetlinks.json` es la de
**Play App Signing**, no la que sale de este comando (que es la del upload key).
Google re-firma el AAB antes de distribuirlo.

## Actualizar la app

Para cambios de UI hay que **resubir**: los assets web son bundled. (La
API/contenido del coche del día sí se actualiza solo, viene de Vercel.)

**El reparto de trabajo**, para que publicar sea pulsar un botón:

| Quién | Qué |
|-------|-----|
| Claude, dentro del PR | El cambio + `versionCode` +1 y `versionName` en `android/app/build.gradle`, en un commit `chore(android): vN/x.y.z` (regla 17 de CLAUDE.md) |
| Tú, tras mergear | `git pull && npm run cap:sync` en el checkout principal |
| Tú, en Android Studio | *Generate Signed Bundle* → release → Create |

El `cap:sync` no es opcional ni ceremonial: `android/app/src/main/assets/public`
está gitignorado, así que un `git pull` **no** actualiza los assets del APK. Sin
él compilas código nuevo con la pantalla de la compilación anterior, y el
síntoma es desesperante — la app se instala, arranca y no tiene tu cambio.

Dos comprobaciones de diez segundos antes de firmar, las dos aprendidas por las
malas (ver «Antes de subir»):

1. En el diálogo de firma, **Destination Folder** tiene que apuntar a
   `…\coche-del-dia\android\app`. Si pone `.claude\worktrees\…`, Android Studio
   tiene abierto otro proyecto y estás compilando otra rama —posiblemente sin
   `.env`, o sea una app que no arranca—.
2. El `versionCode` que sale en Play Console es el que esperabas. Si sale el
   anterior, no se ha mergeado o no se ha hecho `pull`.

Si prefieres no acordarte de nada de esto: al terminar el merge dilo, y Claude
deja el checkout principal sincronizado y te confirma la versión que va a salir.

## Login Google nativo (v2) — setup de OAuth

La app usa `@capgo/capacitor-social-login` (selector de cuenta nativo) →
`supabase.auth.signInWithIdToken`. Requiere configurar OAuth (una vez):

1. **Google Cloud Console** (mismo proyecto que el OAuth web de Supabase):
   - APIs y servicios → Credenciales → Crear ID de cliente de OAuth → **Android**.
     - Nombre del paquete: `com.cochedeldia`.
     - **SHA-1** de la clave que firma el APK que pruebas:
       - Debug (emulador/dispositivo): `./gradlew signingReport` (dentro de `android/`) o
         `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`.
       - Release: añade también la SHA-1 del *upload key* y la de **Play App
         Signing** (Play Console → Configuración → Integridad de la app). Sin la
         SHA-1 correcta el login falla solo en release ("va en debug, rompe en Play").
   - Anota el **Web client ID** existente (tipo "Aplicación web", el que usa Supabase).

2. **Supabase** → Authentication → Providers → **Google**:
   - Asegúrate de que el **Web client ID** está como Client ID y añádelo a
     **"Authorized Client IDs"** (lista separada por comas) para que acepte el
     `idToken` nativo (cuyo `aud` = Web client ID).

3. **`.env`** (en el dir de build): `VITE_GOOGLE_WEB_CLIENT_ID=<web client id>` y
   recompila con `npm run cap:sync`.

> Sin `VITE_GOOGLE_WEB_CLIENT_ID` la app arranca igual pero el botón de login da
> un error controlado y el juego sigue anónimo (no rompe).

**Prueba:** en el dispositivo, pulsa "Iniciar sesión" → elige cuenta → vuelves
logueado (ves tu racha/ranking). Sign-out desde "Mis estadísticas".
