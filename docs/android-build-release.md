# App Android — build y publicación (v1)

App Capacitor que empaqueta la web (`webDir: build`). v1 es **anónima** (sin
login Google) con **recordatorio diario local**. `appId`: `com.cochedeldia`.

> IMPORTANTE: el build web empaquetado (`android/app/src/main/assets/public`)
> está **gitignorado** por Capacitor — NO viaja en el repo. Hay que ejecutar
> `npm run cap:sync` ANTES de compilar para (re)generarlo desde el último build.

> IMPORTANTE (variables de entorno): `vite build` necesita un **`.env`** con
> `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en el directorio desde el que
> compilas. `.env` está **gitignorado** y **NO se hereda en los git worktrees**
> (`.claude/worktrees/…`). Si falta, la app arranca en **pantalla negra** y la
> consola (`chrome://inspect`) muestra `Uncaught Error: Faltan las variables de
> entorno de Supabase` (lo lanza `src/supabaseClient.js`). Desde el repo
> principal ya está; desde un worktree, copia el `.env` antes de `cap:sync`.

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

## Requisitos (una vez)
- Android Studio (Linux/Fedora nativo; no hace falta Mac).
- JDK 17 (lo trae Android Studio) y Android SDK + plataforma reciente.
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
Configura la firma en `android/app/build.gradle` (bloque `signingConfigs`) o vía
`android/keystore.properties`. **NUNCA** commitees el keystore ni las
contraseñas (ya están en `.gitignore`).

## AAB para Play
```bash
npm run cap:sync            # asegura el build web más reciente dentro de android/
cd android
./gradlew bundleRelease
# salida: android/app/build/outputs/bundle/release/app-release.aab
```
Sube el `.aab` a **Play Console** → empieza por el track de **Internal testing**.
Rellena ficha, privacidad (ya existe la política en /privacidad) y data safety
(v1 anónima: sin login, sin recogida de datos personales identificables).

## Actualizar la app
Para cambios de UI hay que **resubir** (es bundled): `npm run cap:sync`, sube
`versionCode`/`versionName` en `android/app/build.gradle`, `./gradlew
bundleRelease`, nueva release en Play. (La API/contenido del coche del día sí se
actualiza solo, viene de Vercel.)

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
