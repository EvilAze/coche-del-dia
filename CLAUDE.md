# CLAUDE.md — Coche del Día

Juego diario tipo *Wordle* para adivinar el coche del día a partir de una imagen progresivamente revelada. SPA en React servida por Vercel, con API serverless/edge y Supabase como backend.

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| **Frontend** | React 18 (sin Next.js), JSX puro — **no TypeScript** |
| **Bundler / dev** | Vite 8 (`outDir: build` por compatibilidad con el deploy histórico de CRA) |
| **Estilos** | Tailwind CSS 3 + tema dark personalizado, PostCSS, autoprefixer |
| **Animación** | framer-motion + keyframes propias en `tailwind.config.js` |
| **Backend** | Vercel Functions (Node) y Edge Functions (`api/`), Edge Middleware (`middleware.js`) |
| **Base de datos / Auth** | Supabase (`@supabase/supabase-js`), Postgres con RLS, Google OAuth |
| **Imágenes** | `sharp` (server), proxy propio `/api/daily-image`, LQIP/blur-data |
| **Infra extra** | Vercel Edge Config (preload), Vercel Cron |
| **Observabilidad** | Sentry (`@sentry/react` cliente, `@sentry/node` server) — **solo errores**; Web Vitals → Umami |
| **Tests** | Vitest (unit) + scripts de seguridad propios (`test:security`, `test:attacks`, `test:rls`) |

## Estructura de carpetas

```
src/                  Frontend React (entry: src/index.jsx)
  App.jsx             Ruta principal (juego). Resto de rutas son lazy-loaded.
  components/         Componentes de UI reutilizables
  admin/              Panel interno (/admin-tools), lazy-loaded
  hooks/              Hooks de estado y lógica (useGame, useStats, useCountdown…)
  lib/                Utilidades de cliente (sentry, analytics, achievements, dates…)
  data/               Catálogos estáticos (countries, catalog)
  i18n/               i18n propio + locales es.json / en.json
  index.css           Tailwind + estilos globales

api/                  Endpoints Vercel (cada archivo = una ruta)
  _lib/               Helpers server compartidos (NO son endpoints, prefijo _)
  _lib/edge/          Variantes Edge-safe (crypto, tokens, audit, anon-session)
  admin/              Endpoints de administración
  cron/               Jobs programados (warm-daily, monthly-podium)
  repesca/            Flujo de "repesca"

lib/admin-handlers/   Lógica de los handlers admin (separada de api/)
scripts/              SQL de migraciones Supabase + scripts de test/diagnóstico
build/                Output del build (ignorado en git; Vercel compila en cada deploy). NO editar a mano.
middleware.js         Edge Middleware (preload de la imagen hero solo en "/")
vercel.json           Rewrites SPA, headers de seguridad, crons
```

## Convenciones de código

- **JavaScript, no TypeScript.** Componentes `.jsx`, módulos ES (`import`/`export`).
- **Comentarios en español, explicando el *porqué*.** El código del proyecto documenta densamente las decisiones de diseño y los trade-offs (latencia, seguridad, free tier). Mantén ese estilo: comenta la razón, no lo obvio.
- **Componentes de UI**: funciones React con hooks. Estado y lógica de negocio van a `src/hooks/`; los componentes consumen esos hooks. La lógica reutilizable de cálculo va a `src/lib/` (con sus `*.test.js` al lado).
- **Tailwind**: usa los tokens del tema (`bg-primary`, `accent`, `text-muted`, `font-display`/`font-body`), no hex sueltos. La paleta es dark + **acento menta `#7af0c8`** (token `accent`, inyectado en `--accent` desde `Configurator.jsx`; tema "Platino Eléctrico"). El **oro `#e8c87a` (token `gold`/`--gold`) NO es el acento base**: está RESERVADO a momentos premium (racha, victoria, podio, logros). La menta es "acción/acierto", el oro es "esto es valioso". Las animaciones están centralizadas en `tailwind.config.js`.
- **Code-splitting**: solo `App` carga eager. Rutas secundarias (admin, repesca, privacidad) van con `React.lazy` + `Suspense`.
- **i18n**: textos visibles pasan por el sistema `useT()` / locales `es`/`en`. No hardcodear strings de cara al usuario.
- **Rutas**: el ruteo es manual en `src/index.jsx` leyendo `window.location` (no hay router lib). El SPA rewrite vive en `vercel.json`.

## Base de datos y estado (Supabase)

### Server-side — `api/_lib/supabase.js`
Tres clientes, creados **perezosamente** (nunca como `const` al importar — evita cachear envs `null` en `vercel dev`):

- `getSupabaseAdmin()` — `SERVICE_ROLE_KEY`, **salta RLS**. Operaciones privilegiadas (pick del coche, stats, upserts).
- `createAuthClient(token)` — adjunta el JWT del usuario, **respeta RLS** bajo rol `authenticated`. No memoizado.
- `getSupabasePublic()` — cliente anónimo, lecturas públicas que respetan RLS.

Si faltan envs, los getters devuelven `null` y el handler responde 500 (usa `getMissingAdminEnvs()`).

### Client-side — `src/supabaseClient.js`
Cliente único con `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Lanza si faltan.

### Estado de la app
- Estado de juego en hooks (`useGame`, `useStats`) + `localStorage` para anónimos (lectura síncrona en el primer render).
- **La fuente de verdad de las partidas es el servidor.** El estado local solo acelera el primer paint; el servidor sobreescribe si difiere. Para usuarios logueados, nunca confíes en el estado local.

## Reglas Estrictas

1. **`vercel dev`, no `npm start`/`npm run dev`.** Si tocas `/api/*` necesitas el runtime de Vercel; Vite solo levanta el front y las funciones no existirán.
2. **Nunca uses `const supabase = createClient(...)` a nivel de módulo en server.** Usa siempre los getters lazy de `_lib/supabase.js`.
3. **Toda columna nueva en `public.cars` necesita `GRANT SELECT (col) TO anon, authenticated`** o `/api/list-cars` rompe. Acompaña el cambio con su SQL en `scripts/`.
4. **El RLS es la red de seguridad.** Usa `createAuthClient(token)` para datos del usuario; reserva `getSupabaseAdmin()` para lo estrictamente privilegiado. Los scripts `test:rls`/`test:attacks` deben seguir pasando.
5. **No filtrar la identidad del coche del día.** No devolver `id`, ni la URL real del CDN (se sirve vía proxy `/api/daily-image`), ni más imagen de la que ve un jugador legítimo en el intento 5. Las descripciones/ficha solo se revelan en victoria.
6. **Coherencia de imagen entre `middleware.js` y `CarImage.jsx`.** El `srcset`/`sizes` del preload debe coincidir byte-a-byte con el `<picture>`, o el navegador descarga la imagen dos veces.
7. **Coherencia de los niveles de zoom.** La fórmula del zoom escalonado está centralizada en `api/_lib/zoom.js` (servidor) y `src/lib/zoom.js` (cliente) — **réplicas, mantenlas en sync**. El zoom es **por coche** vía `cars.zoom_base` (zoom del intento 1; los intentos bajan `ZOOM_STEP`). De ahí derivan el crop del servidor (`daily-image.js`), los scales CSS (`useGame.js` → `cssZoomLevels`) y las previews del admin (`FocusPicker.jsx`, `PreviewPanel.jsx`, `ZoomBaseField.jsx`). Si cambias `ZOOM_STEP`/`ZOOM_ATTEMPTS`/rango, hazlo en **ambos** `zoom.js`.
8. **Sentry solo captura errores** (performance y replay OFF para no agotar el free tier). PII scrubbing agresivo: no mandes tokens, emails ni pistas del coche. Sin DSN → no-op.
9. **No degradar la home.** El middleware y los fallbacks deben fallar en silencio: si Edge Config/cron/envs faltan, la página carga igual, solo sin la optimización.
10. **Comentarios en español explicando el porqué** en cualquier código nuevo, igual que el existente. Respeta las decisiones de latencia (edge `fra1`, paralelización de I/O) documentadas en los handlers.
11. **No editar `build/` a mano** — es output generado y está ignorado en git (Vercel lo compila en cada deploy).
12. **Verificación vía Preview de Vercel.** El usuario ya **no** usa `vercel dev` local. El flujo es: push a la rama `claude/…` → Vercel despliega un **Preview** automático → el usuario revisa en esa URL y mergea. Haz el cambio **completo** antes de pushear; apóyate en `npm run build` y las suites de tests (`npm test`, `test:security`/`test:rls`/`test:attacks`) como red de seguridad automática. No levantes servidores de preview locales.
13. **Flujo de PR (Claude Code).** Un push de Claude va siempre a una rama `claude/…`, lo que solo genera un deploy **Preview** en Vercel; **solo `main` despliega a Production**. Por tanto: cuando termines una tarea, **abre tú el PR** (`claude/…` → `main`) con todo el cambio completo y verificado, para que el usuario tenga **un único botón de Merge por tarea**. No pushees a medias esperando que el usuario mergee: si añades commits después de un PR ya mergeado, quedan huérfanos en la rama (Preview) hasta otro merge. Avisa explícitamente cuando el cambio esté "listo para mergear".
14. **Codificación UTF-8, ojo con el mojibake.** No incrustes caracteres no-ASCII en *char-classes* de regex (p.ej. el rango de tildes combinantes); usa **siempre la forma escapada** `[\u0300-\u036f]`. Un re-guardado con codificación errónea convierte esos bytes en un rango inválido (`/[Ì€-Í¯]/g`) que lanza `SyntaxError` al parsear el módulo y **tumba el chunk entero**. Los comentarios en español sí llevan acentos: asegúrate de que las herramientas escriban UTF-8, no doble-UTF-8.
15. **`public/` viaja entero al APK.** Vite copia `public/` a `build/` y `cap sync` copia `build/` a `android/app/src/main/assets/public`: cualquier cosa que dejes ahí acaba dentro del AAB que se sube a Play, esté o no en git. Así se publicó una v1.0 de **400 MB** por un `public/coches/` sin versionar (366 MB de imágenes-fuente que la app ni siquiera usa: van por CDN vía `/api/daily-image`). Las fotos de coches **nunca** se empaquetan. `npm run cap:sync` ejecuta `scripts/check-bundle-size.mjs` como red de seguridad; si falla, investiga antes de subir el límite. Detalle completo en `docs/android-build-release.md`.
