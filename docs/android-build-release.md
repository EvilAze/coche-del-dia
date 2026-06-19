# App Android — build y publicación (v1)

App Capacitor que empaqueta la web (`webDir: build`). v1 es **anónima** (sin
login Google) con **recordatorio diario local**. `appId`: `com.cochedeldia`.

> IMPORTANTE: el build web empaquetado (`android/app/src/main/assets/public`)
> está **gitignorado** por Capacitor — NO viaja en el repo. Hay que ejecutar
> `npm run cap:sync` ANTES de compilar para (re)generarlo desde el último build.

## Requisitos (una vez)
- Android Studio (Linux/Fedora nativo; no hace falta Mac).
- JDK 17 (lo trae Android Studio) y Android SDK + plataforma reciente.
- Cuenta **Google Play Developer** (25 $, pago único).
- Variable de build `VITE_PROD_ORIGIN=https://cochedeldia.com` (por defecto ya
  apunta ahí en `src/lib/apiUrl.js`; solo cámbiala si el dominio cambia).

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
