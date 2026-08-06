# Coche del Día

Juego diario de adivinar un coche, al estilo *Wordle*. Cinco intentos: la foto
empieza muy ampliada sobre un detalle y se va alejando con cada fallo. Cada día,
un coche nuevo para todo el mundo.

SPA en React servida por Vercel, con funciones serverless/edge y Supabase
detrás. Se publica también como app Android (Capacitor) empaquetando el mismo
build web.

- **Producción**: https://cochedeldia.com
- **Guía para trabajar en el repo**: [`CLAUDE.md`](CLAUDE.md) — convenciones,
  reglas estrictas y las decisiones que conviene no re-litigar.
- **Producto**: [`PRODUCT.md`](PRODUCT.md) · **Diseño**: [`DESIGN.md`](DESIGN.md)

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, JSX puro (**no TypeScript**, no Next.js) |
| Bundler | Vite 8 — `outDir: build` por compatibilidad con el deploy histórico de CRA |
| Estilos | Tailwind CSS 3 + tema propio «Prensa del motor» (día/noche), PostCSS |
| Animación | framer-motion + keyframes propias en `tailwind.config.js` |
| Backend | Vercel Functions (Node) y Edge Functions en `api/`, Edge Middleware |
| Datos / Auth | Supabase (Postgres con RLS, Google OAuth) |
| Imágenes | `sharp` en servidor, proxy propio `/api/daily-image`, LQIP/blur-data |
| Infra extra | Vercel Edge Config (preload), Vercel Cron, Upstash Redis (rate-limit) |
| Observabilidad | Sentry (solo errores) · Web Vitals → Umami |
| App móvil | Capacitor 8 (Android) |
| Tests | Vitest + scripts propios de seguridad, RLS y estética |

## Estructura

```
src/                  Frontend React (entry: src/index.jsx)
  App.jsx             Ruta principal (el juego). El resto son lazy-loaded.
  components/         UI reutilizable (configurator/ es la pantalla de juego)
  admin/              Panel interno /admin-tools
  hooks/              Estado y lógica (useGame, useStats, useCountdown…)
  lib/                Utilidades de cliente, con sus *.test.js al lado
  data/               Catálogos estáticos (countries, catalog)
  i18n/               i18n propio + locales es.json / en.json

api/                  Endpoints Vercel — cada archivo es una ruta
  _lib/               Helpers de servidor (prefijo _ ⇒ Vercel no los cuenta
                      como funciones); _lib/edge/ son las variantes Edge-safe
  admin/  cron/  repesca/    Catch-alls que agrupan rutas en una sola función

lib/admin-handlers/   Lógica de los handlers admin, separada de api/
scripts/              SQL de migraciones + scripts de test y diagnóstico
android/              Proyecto Capacitor
docs/                 Runbooks, guía de release Android, specs y planes
middleware.js         Edge Middleware (preload de la imagen hero solo en "/")
vercel.json           Rewrites SPA, headers, crons, límites de funciones
```

`build/` es output generado, está gitignorado y **no se edita a mano**.

## Puesta en marcha

Requiere **Node ≥ 20.19 (o ≥ 22.12)**, que es lo que pide Vite 8.

```bash
npm install
cp .env.example .env      # y rellena los valores (ver el propio fichero)
```

Para desarrollar usa **`vercel dev`**, no `npm run dev`. Vite solo levanta el
front: si tocas `/api/*` necesitas el runtime de Vercel o las funciones
sencillamente no existen.

```bash
vercel dev               # front + funciones
npm run build            # build de producción a build/
```

Variables de entorno mínimas para arrancar: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (cliente) y `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `REPESCA_TOKEN_SECRET` (servidor). Sin las dos
primeras la app arranca en pantalla negra. El resto son opcionales y degradan
en silencio. Todo está documentado en [`.env.example`](.env.example).

## Scripts

| Script | Qué hace |
|--------|----------|
| `npm test` | Suite completa: estética + unit + seguridad + ataques |
| `npm run test:unit` | Vitest (`src/**`, `api/**`, `lib/**`) |
| `npm run test:estetica` | Falla si aparece emoji en UI, paleta cruda de Tailwind, glows o hex sueltos |
| `npm run test:layout` | Mide el pliego sin scroll de la app en Chromium sobre 5 pantallas × 3 estados × 2 temas. **Fuera de `npm test`**: necesita un build fresco (lo hace solo si hace falta) y un Chromium instalado |
| `npm run test:security` | Comprobaciones de superficie de los endpoints |
| `npm run test:attacks` | Reproduce ataques conocidos (reveal token forjado, brute-force, spoof de sesión anónima) |
| `npm run test:rls` | Verifica las policies de Supabase — **necesita credenciales reales**, por eso no entra en `npm test` |
| `npm run build` | Build de producción |
| `npm run cap:sync` | Build + chequeo de tamaño + `cap sync android` |
| `npm run check:size` | Red de seguridad del tamaño del bundle que viaja al APK |
| `npm run og:build` | Regenera la imagen Open Graph |

`vercel.json` fija `buildCommand: vitest run && vite build`, así que un test
unitario roto tumba el deploy.

`test:layout` usa `playwright-core`, que **no descarga navegadores**: reutiliza
el Chromium o el Chrome que ya tengas. Si no lo encuentra, apúntale a él con
`CDD_CHROMIUM=/ruta/al/binario`.

## Cómo funciona el juego

Cinco intentos. Cada coche tiene su propio **zoom base** (`cars.zoom_base`,
rango 3.2–6.0, por defecto 3.7), que es el zoom del primer intento; de ahí baja
por una curva logarítmica con easing hasta `base − 2` en el quinto.

La foto **nunca** viaja entera mientras la partida sigue abierta:

1. El servidor resuelve el coche del día con la RPC `pick_daily_car`, lee la URL
   real del CDN (columna privilegiada) y **recorta** la imagen al área del
   intento 5 antes de devolver los bytes.
2. El cliente cierra el resto del zoom con un `transform: scale()` CSS sobre esa
   imagen ya recortada.
3. Al terminar la partida, el servidor emite un **reveal token** firmado; solo
   presentándolo (`?t=…`) entrega la imagen completa.

La fórmula del zoom está duplicada a propósito en `api/_lib/zoom.js` y
`src/lib/zoom.js`: son réplicas y hay que mantenerlas en sync (ver regla 7 de
`CLAUDE.md`). Los tests `zoom.sync.test.js` lo vigilan.

### Modos y funciones

- **Partida diaria** con racha, logros y puntuación.
- **Repesca**: segunda oportunidad diaria con un coche que ya fue daily y que
  aún no tienes. Tiene modo *veterano* (un intento, sin pistas).
- **Garaje**: colección de portadas. Los coches bloqueados se sirven
  desenfocados **desde el servidor**, no con un `filter: blur` de CSS.
- **Clasificación**: temporadas temáticas de 1–2 semanas + tabla histórica.
- **Notificaciones**: web push en navegador, notificación local en la app.
- **i18n**: español e inglés, con sistema propio (`useT()`).

## Modelo de seguridad

Cuatro ideas que sostienen el resto y conviene no romper por accidente:

- **La identidad del coche del día no se filtra.** Ni su `id`, ni la URL real
  del CDN (el nombre del fichero llevaba marca-modelo-año), ni más imagen de la
  que ve un jugador legítimo en el intento 5. Las descripciones solo aparecen
  en victoria.
- **RLS es la red de seguridad.** El cliente autenticado usa
  `createAuthClient(token)` y respeta las policies; `getSupabaseAdmin()`
  (service role, salta RLS) queda para lo estrictamente privilegiado. Toda
  columna nueva de `public.cars` necesita su `GRANT SELECT`… salvo las
  excepciones deliberadas que documenta `CLAUDE.md`.
- **Tokens firmados** con `REPESCA_TOKEN_SECRET` para el reveal de imagen, los
  pseudo-ids de repesca, las cookies anónimas y los tokens de imagen del garaje
  (estos últimos cifrados con AES-GCM, no solo firmados).
- **Rate-limit distribuido** (Upstash) en los endpoints que validan intentos.

`npm run test:attacks` reproduce los intentos de bypass que ya se cerraron; si
tocas esta zona, esos tests son el contrato.

## Endpoints

| Ruta | Para qué |
|------|----------|
| `GET /api/get-daily-car` | Estado de la partida de hoy (edge) |
| `POST /api/validate-guess` | Valida un intento y persiste |
| `GET /api/daily-image` | Proxy + recorte de la foto del día |
| `GET /api/car-image` | Portadas del garaje (nítidas o borrosas, por token) |
| `GET /api/list-cars` | Catálogo público para el autocompletado |
| `GET /api/garage` | Colección del usuario |
| `GET /api/daily-stats` | Distribución de resultados del día |
| `POST /api/delete-account` | Borrado de cuenta (requisito de Play) |
| `POST /api/push` | Alta/baja de suscripciones web push |
| `/api/repesca/{start,validate,image}` | Flujo de repesca |
| `/api/admin/*` | Panel interno |
| `/api/cron/*` | `warm-daily` (Vercel Cron) y `send-push` (GitHub Actions) |

## Despliegue

Vercel, con la región `fra1` fijada por latencia contra Supabase.

- Un push a `main` despliega a **Production**.
- Un push a cualquier otra rama genera un **Preview** con su propia URL. El
  flujo de trabajo habitual es rama → Preview → revisión → merge.

Para la app Android, la guía completa (firma, versionado, subida a Play y el
incidente del AAB de 400 MB que motivó `check:size`) está en
[`docs/android-build-release.md`](docs/android-build-release.md).

## Añadir coches

Desde el panel `/admin-tools`: alta del coche, subida de la foto, punto focal,
`zoom_base` y descripciones (es/en, con traducción asistida opcional). El
catálogo ya no vive en un array del repo — está en Supabase.
