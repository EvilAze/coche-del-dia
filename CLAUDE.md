# CLAUDE.md — Coche del Día

Juego diario tipo *Wordle* para adivinar el coche del día a partir de una imagen progresivamente revelada. SPA en React servida por Vercel, con API serverless/edge y Supabase como backend.

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| **Frontend** | React 18 (sin Next.js), JSX puro — **no TypeScript** |
| **Bundler / dev** | Vite 8 (`outDir: build` por compatibilidad con el deploy histórico de CRA) |
| **Estilos** | Tailwind CSS 3 + tema propio «Prensa del motor» (día/noche), PostCSS, autoprefixer |
| **Animación** | framer-motion + keyframes propias en `tailwind.config.js` |
| **Backend** | Vercel Functions (Node) y Edge Functions (`api/`), Edge Middleware (`middleware.js`) |
| **Base de datos / Auth** | Supabase (`@supabase/supabase-js`), Postgres con RLS, Google OAuth |
| **Imágenes** | `sharp` (server), proxy propio `/api/daily-image`, LQIP/blur-data |
| **Infra extra** | Vercel Edge Config (preload), Vercel Cron |
| **Observabilidad** | Sentry (`@sentry/react` cliente, `@sentry/node` server) — **solo errores**; Web Vitals → Umami |
| **Tests** | Vitest (unit) + scripts propios: seguridad (`test:security`, `test:attacks`, `test:rls`) y estética (`test:estetica`) |

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
- **Tailwind**: usa los tokens del tema, nunca hex sueltos ni paleta cruda de Tailwind (`amber-400`, `zinc-300`…). El tema vivo es **«Prensa del motor»**: papel/tinta (`papel`, `papel-2`, `tinta`, `tinta-2`, `muted`), **rojo de rotativa** como acento (`rojo`, alias `accent`) y **oro viejo** (`gold`/`oro-viejo`) RESERVADO a los momentos premium (racha, victoria, podio, logros) — el rojo es "acción/atención", el oro es "esto vale algo"; `plata`/`bronce` completan el podio. Tipografía: `font-display` = Fraunces (titulares), `font-body` = Libre Franklin (UI), `font-mono` = Courier Prime (etiquetas técnicas). Todos los colores salen de ternas RGB en `:root` de `index.css`, y el modo noche solo reescribe esas ternas: por eso un color crudo se ve bien en un tema y desaparece en el otro. Formas: **sin redondeos ni glows** — filetes (`border`), doble filete (`arch-filete`) y sellos (`pm-sello`). Las animaciones están centralizadas en `tailwind.config.js`.
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
3. **Toda columna nueva en `public.cars` necesita `GRANT SELECT (col) TO anon, authenticated`** o `/api/list-cars` rompe. Acompaña el cambio con su SQL en `scripts/`. **Excepción deliberada: `cars.tags`** (etiquetas de Temporada Temática) **NO lleva GRANT**, y `seasons.theme_filter` tampoco — ambos describen el pool del que sortea `pick_daily_car`, y leerlos desde el cliente permitiría acotar el coche del día cruzándolos con el catálogo público (regla 5). Viajan solo por endpoints admin con `service_role`. No "arregles" ese GRANT ausente: `test:rls` falla si aparece.
4. **El RLS es la red de seguridad.** Usa `createAuthClient(token)` para datos del usuario; reserva `getSupabaseAdmin()` para lo estrictamente privilegiado. Los scripts `test:rls`/`test:attacks` deben seguir pasando.
5. **No filtrar la identidad del coche del día.** No devolver `id`, ni la URL real del CDN (se sirve vía proxy `/api/daily-image`), ni más imagen de la que ve un jugador legítimo en el intento 5. Las descripciones/ficha solo se revelan en victoria.
6. **Coherencia de imagen entre `middleware.js` y `CarImage.jsx`.** El `srcset`/`sizes` del preload debe coincidir byte-a-byte con el `<picture>`, o el navegador descarga la imagen dos veces.
7. **Coherencia de los niveles de zoom.** La fórmula del zoom escalonado está centralizada en `api/_lib/zoom.js` (servidor) y `src/lib/zoom.js` (cliente) — **réplicas, mantenlas en sync**. El zoom es **por coche** vía `cars.zoom_base` (zoom del intento 1; los intentos bajan `ZOOM_STEP`). De ahí derivan el crop del servidor (`daily-image.js`), los scales CSS (`useGame.js` → `cssZoomLevels`) y las previews del admin (`FocusPicker.jsx`, `PreviewPanel.jsx`, `ZoomBaseField.jsx`). Si cambias `ZOOM_STEP`/`ZOOM_ATTEMPTS`/rango, hazlo en **ambos** `zoom.js`.
8. **Sentry solo captura errores** (performance y replay OFF para no agotar el free tier). PII scrubbing agresivo: no mandes tokens, emails ni pistas del coche. Sin DSN → no-op.
9. **No degradar la home.** El middleware y los fallbacks deben fallar en silencio: si Edge Config/cron/envs faltan, la página carga igual, solo sin la optimización.
10. **Comentarios en español explicando el porqué** en cualquier código nuevo, igual que el existente. Respeta las decisiones de latencia (edge `fra1`, paralelización de I/O) documentadas en los handlers.
11. **No editar `build/` a mano** — es output generado y está ignorado en git (Vercel lo compila en cada deploy).
12. **Verificación vía Preview de Vercel.** El usuario ya **no** usa `vercel dev` local. El flujo es: push a la rama `claude/…` → Vercel despliega un **Preview** automático → el usuario revisa en esa URL y mergea. Haz el cambio **completo** antes de pushear; apóyate en `npm run build` y las suites de tests (`npm test`, `test:security`/`test:rls`/`test:attacks`) como red de seguridad automática. No levantes servidores de preview locales.
13. **Entrega (Claude Code): depende de si el cambio viaja en el APK.** **Solo `main` despliega a Production**; una rama `claude/…` solo genera un deploy **Preview**. A partir de ahí, dos caminos:

    - **Cambios de app** (lo que llega al APK: `src/`, `public/`, `index.html`, `capacitor.config.json`, `android/`) → **directo a `main`, sin PR**: commit y `git push origin HEAD:main`, y después `git pull && npm run cap:sync` en el **checkout principal**. El usuario no toca nada hasta pulsar *Build*. Sin PR **no hay Preview que mirar**, así que la red de seguridad se adelanta entera: `npm test` y `npm run build` en verde **antes** de empujar, y el cambio completo de una vez — nada de dejar `main` a medias.
    - **Todo lo demás** (`api/`, `scripts/`, documentación) → **abre tú el PR** (`claude/…` → `main`) con el cambio completo y verificado, un único botón de Merge por tarea, y avisa explícitamente de que está "listo para mergear".

    En ambos casos, nada de pushes a medias: si añades commits después de un PR ya mergeado, quedan huérfanos en la rama (Preview) hasta otro merge.
14. **Codificación UTF-8, ojo con el mojibake.** No incrustes caracteres no-ASCII en *char-classes* de regex (p.ej. el rango de tildes combinantes); usa **siempre la forma escapada** `[\u0300-\u036f]`. Un re-guardado con codificación errónea convierte esos bytes en un rango inválido (`/[Ì€-Í¯]/g`) que lanza `SyntaxError` al parsear el módulo y **tumba el chunk entero**. Los comentarios en español sí llevan acentos: asegúrate de que las herramientas escriban UTF-8, no doble-UTF-8.
15. **`public/` viaja entero al APK.** Vite copia `public/` a `build/` y `cap sync` copia `build/` a `android/app/src/main/assets/public`: cualquier cosa que dejes ahí acaba dentro del AAB que se sube a Play, esté o no en git. Así se publicó una v1.0 de **400 MB** por un `public/coches/` sin versionar (366 MB de imágenes-fuente que la app ni siquiera usa: van por CDN vía `/api/daily-image`). Las fotos de coches **nunca** se empaquetan. `npm run cap:sync` ejecuta `scripts/check-bundle-size.mjs` como red de seguridad; si falla, investiga antes de subir el límite. Detalle completo en `docs/android-build-release.md`.

16. **Nada de emoji ni de restos de temas anteriores en la UI.** La web ha pasado por tres pieles (neón menta → plano ámbar → prensa) y cada migración dejó sedimento: un 🚗 dentro de un disco de acento en el aviso de recarga, halos ámbar sobre el cromo de la repesca, un punto menta `#7af0c8` con glow en la campana, medallas de plata en `zinc-300` invisibles sobre el papel del modo día. Nada de eso rompe el build ni los tests — solo hace que la web parezca de tres apps distintas. `npm run test:estetica` (`scripts/check-estetica.mjs`, dentro de `npm test`) falla si aparece **emoji** en JSX o en cadenas de UI, **paleta cruda de Tailwind**, **glows** (`shadow-[0_0_…]`) o **hex sueltos** en clases. El adorno lo pone el componente, no la cadena: usa el set de iconos de línea (`components/configurator/icons.jsx`, trazo 1.6/caja 24; `AchievementIcons.jsx` para logros) o —mejor— tipografía (`pm-sello`, `pm-kicker`, los glifos del `Toast`). Excepciones ya contempladas en el script CON su motivo: el share de texto plano, el título de la notificación push y el mapa de banderas — los tres se pintan fuera de nuestro lienzo. `src/admin/` queda exento (herramienta interna).

17. **Si tocas lo que ve la app, sube la versión en la misma entrega.** El usuario solo quiere pulsar *Build* en Android Studio: el `versionCode`/`versionName` de `android/app/build.gradle` **no** es tarea suya. Cualquier cambio que llegue al APK —`src/`, `public/`, `index.html`, `capacitor.config.json`, `android/`— lleva un commit `chore(android): vN/x.y.z` con el `versionCode` **+1** (estrictamente mayor que el último subido a Play: internal y closed comparten numeración) y el `versionName` que corresponda — patch para arreglos, minor para pantallas nuevas. Un cambio que solo toca `api/`, `scripts/` o documentación **no** sube versión: no viaja en el APK. El paso que queda antes de Android Studio es `git pull && npm run cap:sync` en el checkout principal — los assets web son bundled y están gitignorados (regla 15), así que sin ese `cap:sync` el APK sale con la compilación anterior aunque el código esté en `main`. **Ejecútalo tú** (regla 13: los cambios de app van directos a `main`) y di qué versión va a salir. Flujo completo en `docs/android-build-release.md`.

18. **El cupón tiene DOS formas, una por plataforma, y `GuessForm` es la frontera.** En **web** se teclea: `Combo` (marca/modelo) + `YearField`, con desplegable y teclado, como siempre. En la **app** se elige: tres `CampoBoton` que abren una hoja inferior (`SelectorHoja` → `SelectorLista` / `SelectorAnio`) y **el teclado del sistema no aparece sobre la pantalla de juego**. Motivo: el catálogo es cerrado (~80 marcas), así que esto nunca fue un buscador sino una elección — y pagarla con media pantalla de teclado costaba la fotografía tapada, un modo de maqueta entero (`data-teclado`, ~180 líneas de CSS, ya borradas) y un salto de maqueta al enfocar. Consecuencias que hay que respetar: (a) tocar la lógica del cupón obliga a comprobar **las dos ramas** — la web no debe cambiar de comportamiento; (b) la hoja va sobre `ModalShell` (foco, `role="dialog"`, bloqueo de scroll) y ese `role` es justo lo que hace que `lib/teclado.js` ignore su buscador y no recomponga el pliego de detrás; (c) el «atrás» de Android la cierra vía `useHistoryClose` montado en `GuessForm`, **una sola capa** (ver el aviso de `ModalShell` sobre entradas fantasma); (d) hay **UNA sola hoja** para los tres pasos y elegir encadena al siguiente campo VACÍO (marca → modelo → año), así que `SelectorLista`/`SelectorAnio` son *contenido*, no diálogos: quien abre y cierra es `GuessForm`; (e) el buscador **sí se autoenfoca**, pero solo con más de 12 opciones. Dentro de la hoja el teclado no cuesta nada —no hay pliego que recomponer y la hoja mide en `dvh`— y enfocarlo la convierte en un superconjunto de teclear: tres letras para quien sabe qué busca, lista con índice A-Z para quien viene a mirar. Lo que **no** puede volver es el teclado sobre la pantalla de juego, que es de donde venían el salto y la foto tapada.

19. **El panel interno vive en SU host, y son dos mitades que se replican.** `/admin-tools` ya no se sirve en `cochedeldia.com`: va en un subdominio propio (`ADMIN_HOST`) con una puerta de cookie delante. Motivo: el App Link del manifest declara el apex **sin `pathPattern`** —a propósito, para que un resultado compartido abra la app—, y los intent filters de Android **no tienen negación**, así que no había forma de excluir la ruta del panel; un clic desde Google abría la app. Un subdominio no lo intercepta nunca. Las dos mitades: `api/_lib/edge/admin-gate.js` (+ `middleware.js`) decide en el host interno —307 de `/` al panel, cookie con `?k=`, **404 seco** sin ella— y el guard de hostname de `src/index.jsx` (`VITE_ADMIN_HOST`) impide que el panel se **monte** en el apex. En el apex NO se devuelve 404 a propósito: un 404 en esa ruta y solo en esa ruta sería la confirmación de que ahí hay algo; se comporta como cualquier ruta inexistente. La lista de rutas internas (`/admin-tools`, las legacy `/admin/edit-car`, `/admin/add-car`, `/preview` y los alias por query) está **replicada** en los dos sitios: si añades una, tócala en ambos, o queda una ruta que monta el panel sin puerta. Sin `ADMIN_HOST`/`ADMIN_GATE_KEY` la puerta no existe y todo se comporta como antes — es el interruptor de emergencia, no un despiste. Y ojo con lo que esto no es: el **nombre del subdominio es público** (los certificados se publican en los logs de Certificate Transparency, así que nada de llamarlo `admin`), y la autorización de verdad sigue siendo `requireAdmin` (`ADMIN_EMAILS`). Provisión y rotación de la clave en `docs/runbooks/panel-interno.md`.

20. **ESTE REPOSITORIO ES PÚBLICO. Nada que comprometa la hermeticidad del coche del día viaja en él, bajo ningún concepto.** `EvilAze/coche-del-dia` es público a propósito, así que cada fichero, cada mensaje de commit y cada cuerpo y diff de PR es legible por cualquiera. Y el momento de la exposición es el **push**, no el merge: cuando abres un PR, lo que lleva dentro ya está publicado. Esta regla es la 5 aplicada al repositorio — allí se protege lo que sale por la API, aquí lo que sale por GitHub — y sostiene lo que la 3 defiende en la base de datos: a `cars.tags` y a `seasons.theme_filter` se les niega el `GRANT` (y `test:rls` falla si aparece) precisamente para que nadie acote el coche del día cruzando la etiqueta con el catálogo público. Publicar esa misma información en un `.sql` versionado tira la defensa por la ventana y deja la cerradura puesta con la ventana abierta.

    **La prueba es el espacio de búsqueda, no el tipo de fichero.** Si un dato reduce los candidatos del día por debajo del catálogo entero, no se commitea:

    - **Sí puede viajar:** el catálogo (`make`/`model`/`year`/`pais`), que ya es público por diseño vía `/api/list-cars`; los slugs de etiqueta (`pelotillas` es un nombre, no una lista) y los rótulos de temporada, que se le enseñan al jugador encima de la foto; el esquema, las funciones, los `RAISE EXCEPTION` y las consultas de verificación; y los **recuentos** — «¿hay 21 etiquetados?» es un número y no identifica a nadie, así que la comprobación se queda en el fichero público y el script sigue siendo ejecutable de principio a fin.
    - **No puede viajar:** la **enumeración del pool** de una temporada temática (el caso que motivó esta regla); cualquier calendario literal de `daily_cars` que ate una fecha a un coche; las **URL reales del CDN** de las fotos (regla 5: se sirven por el proxy `/api/daily-image`); y cualquier cambio que haga **predecible** el sorteo — `pick_daily_car` usa `order by random()` a propósito, y sustituirlo por una semilla derivada de la fecha convertiría el algoritmo público en el resultado público.

    **El mecanismo es `scripts/privado/`**, ignorado en `.gitignore` igual que el keystore de Android: no es que se olvide subirlo, es que no debe subirse. El SQL de una temporada se parte en dos —el `UPDATE` que reparte la etiqueta va ahí, todo lo demás se versiona— y el fichero público arranca comprobando el recuento, de modo que si alguien lo ejecuta sin el privado se planta diciendo qué falta en vez de dejar la temporada a medias.

    **Si una rama ya publicó algo de esto, reconstrúyela desde `main` en un commit limpio; no le pongas un «lo quito» encima.** Un commit que borra las tuplas deja las tuplas en el historial, y al mergear entran en `main` para siempre. Lo que se puede salvar es que `main` no las vea nunca, porque la rama se borra y `main` es lo que persiste. Lo ya publicado no se des-publica: GitHub conserva los commits forzados accesibles por SHA, y están los forks y las cachés. Deuda conocida y asumida: el pool de Le Mans (T3) está en `scripts/2026-07-temporada-le-mans.sql` desde julio; la temporada ya cerró y se da por quemado. Un caso menor y distinto: `2026-05-batch-200-descriptions.sql` publica las fichas que la regla 5 reserva para la victoria — spoilea la recompensa, pero no dice qué coche toca hoy, así que no rompe la hermeticidad.
