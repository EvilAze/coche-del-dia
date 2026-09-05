# Ficha de rendimiento por coche (panel interno)

**Fecha:** 2026-09-05
**Estado:** diseño aprobado, pendiente de plan de implementación

## Qué se pide

Poder ver, para cada coche del catálogo, cómo le fue de verdad: cuánta gente lo
jugó, qué porcentaje acertó, en qué intento cayó. Y para el coche que se está
jugando **ahora mismo**, lo mismo en vivo y de un vistazo.

Cuatro usos declarados: curar el catálogo, tener la ficha completa por gusto,
comparar coches entre sí, y —el que disparó todo— arreglar «una cosa que se
supone que dice cómo va la dificultad pero no funciona».

## Punto de partida: qué había ya

No se parte de cero. En la pestaña *Editar*, bajo el slider de zoom, vive
`DifficultyIntel` (`src/admin/EditCarPanel.jsx:990`): partidas, coste medio, %
resuelto en ≤3 intentos, % de fallo, fecha de medición y una sugerencia de
`zoom_base`. Se alimenta de las columnas `cars.difficulty_*` que escribe la RPC
`recompute_car_difficulty`, y el GET del coche la manda recalcular en cada
apertura (`lib/admin-handlers/save-car.js:157`).

O sea: buena parte de lo pedido **ya se mide**. Lo que falla es que no se ve
(está enmarcado como «afinar el zoom», no como «ficha del coche»), que le faltan
piezas (el histograma, la fecha de emisión, la repesca), y que ahora mismo
**está roto**.

## El bug

Síntoma observado: el bloque muestra siempre «Sin datos de telemetría todavía»,
incluso en coches que ya salieron y se jugaron.

Cadena deductiva:

1. Ese texto sale cuando `shapeDifficulty` devuelve `null`
   (`save-car.js:96`), y eso solo pasa si `difficulty_n` no es un número.
2. Las columnas **existen**: si no, el `.select(...)` que las nombra
   (`save-car.js:166`) fallaría y el panel diría «No se pudo cargar el coche».
3. El `UPDATE` de `recompute_car_difficulty` escribe `difficulty_n` **sin
   condición** — solo `suggested_zoom_base` está capado por `p_min_n`. Así que
   ni siquiera «poca audiencia» explica un NULL.

Conclusión: la RPC no se está ejecutando con éxito. Y no nos enteramos por un
segundo defecto, este sí de código:

```js
try { await getSupabaseAdmin().rpc("recompute_car_difficulty"); }
catch (rpcErr) { console.warn(...); }
```

`supabase-js` **no lanza** ante un error de Postgres: resuelve con
`{ data, error }`. Ese `catch` no se dispara nunca y el `error` no se mira, así
que cualquier fallo de la RPC es invisible. El cron sí lo hace bien
(`api/_lib/cron/warm-daily.js:237` comprueba `error`), pero su resultado no lo
lee nadie.

**Causa raíz probable** (a confirmar con el diagnóstico):
`2026-06-difficulty-observatory.sql` crea la función con 8 argumentos y
`2026-06-difficulty-significance-gate.sql` la sustituye por una de 9, dropeando
la anterior. El primero se declara «idempotente, re-ejecutable sin efectos
colaterales»; si se re-ejecutó *después* del segundo, ahora **coexisten las dos
sobrecargas** y llamarla sin argumentos es ambiguo → error `PGRST203` → tragado
por el `catch` mudo. Nótese que esto rompería también al cron, cuya llamada por
nombre de argumento es igual de ambigua.

Un diagnóstico lo cierra en una pasada: cuenta sobrecargas, comprueba que hay
telemetría, comprueba que el JOIN por fecha empareja, ejecuta la RPC a mano y
mira si quedó escrito. Se versiona como
`scripts/2026-09-diagnostico-dificultad.sql` — es read-only salvo la llamada a
la propia RPC, no enumera coches (solo recuentos, regla 20) y el modo de fallo
que destapa puede repetirse, así que merece quedarse en el repo en vez de vivir
en un pegote de un solo uso.

## Arquitectura elegida

**RPC nueva leída en vivo**, no más estado derivado.

Se descartó ampliar `cars.difficulty_*` con seis columnas más para el
histograma. El motivo no es estético: acabamos de comprobar que esa vía **falla
en silencio y lleva quién sabe cuánto fallando**. La ficha tiene que funcionar
aunque `recompute_car_difficulty` siga rota, y eso solo lo consigue leyendo la
fuente en vez de la caché.

Dos ventajas colaterales:

- **No toca `public.cars`**, así que no abre la pregunta del `GRANT` de la regla
  3 del CLAUDE.md ni puede romper `/api/list-cars`.
- El coste es irrisorio: `daily_stats` es una fila por día de vida del juego.

Se descartó también cruzar en Node (como hace `fetchHardestCars`): ahí el cruce
en JS se justifica porque procesa *rangos*; para un coche es un JOIN de libro, y
hacerlo en SQL evita traerse filas para tirarlas.

### `get_car_report(p_car_id uuid)`

`security definer`, `revoke all from public`, `grant execute to service_role` —
mismo patrón que `recompute_car_difficulty` y `get_global_difficulty`. Lee
`daily_cars`, `daily_stats` y `user_guesses`, tablas cerradas al cliente.

Devuelve, para un coche:

| Campo | Origen |
|---|---|
| `aired_on` (primera fecha), `aired_count` | `daily_cars` |
| `total_games`, `wins`, `losses` | `daily_stats` del día emparejado |
| `attempt_1` … `attempt_5` | `daily_stats` |
| `repesca_plays`, `repesca_wins` | `user_guesses` con `car_id` = este y `date` fuera de sus fechas de emisión |

Un coche puede tener más de una fila en `daily_cars` en teoría, así que los
agregados suman todas sus emisiones y `aired_count` lo deja ver.

### `list_car_reports()`

La misma consulta **sin filtrar por coche**, para la tabla comparativa. Devuelve
todos los coches medidos con sus agregados; **la ordenación y el filtrado se
hacen en el panel**, no en SQL. Motivo: pasar un criterio de orden como texto a
una función SQL obliga a SQL dinámico, y son unos cientos de filas — ordenarlas
en JS es trivial y no abre esa puerta.

## La ficha

Vive en *Editar*, en su propio bloque, y **sustituye conceptualmente** a
`DifficultyIntel`: la sugerencia de zoom se queda (es útil y es de otra cosa),
pero las métricas dejan de venir de `cars.difficulty_*` y pasan a venir de
`get_car_report`.

Contenido:

- **Cabecera**: fecha de emisión y hace cuánto.
- **Cuatro cifras**: partidas, % de acierto, intento medio (de los que ganaron),
  % resuelto en ≤3.
- **Histograma 1-2-3-4-5-falló**. Es la pieza que convierte un número en una
  lectura: dos coches con el mismo 82% de acierto son cosas opuestas si en uno
  la moda cae en el 1er intento y en otro en el 5º.
- **Veredicto** de dificultad, reusando las bandas que ya existen (coste vs.
  objetivo 3,5), para no inventar una segunda escala.
- **Tira de repesca**, separada.

### Estados

- **Sin emitir** — el coche nunca fue coche del día: mensaje explícito, sin
  cifras. Es información, no un fallo.
- **En curso** — el coche es el de hoy: las mismas cifras, marcadas como
  parciales porque el día no ha cerrado. No es un componente distinto, es este
  en otro estado. «Hoy» se decide comparando `aired_on` con `getMadridDateStr()`
  (`src/lib/dates.js`), que es la zona horaria del juego.
- **Cerrado** — lo normal.

### Entrada para el coche de hoy

*Editar*, al abrirse sin coche seleccionado, **preselecciona el coche del día**
con su ficha desplegada. Cero piezas nuevas y el panel arranca enseñando algo
útil en vez de un desplegable vacío.

Se descartó `EstadoStrip` como sitio: esa tira está escrita a propósito para no
gritar en reposo («un cuadro de mandos que avisa siempre deja de leerse en una
semana»), y llenarla de datos de rutina la inutilizaría.

## Sobre «usuarios que lo han jugado»

`daily_stats` no guarda **quién**, solo **cuánto**. Pero como cada persona juega
una partida al día, el `total_games` de ese día *es* el número de jugadores,
anónimos incluidos — que es justo la población que interesa.

Lo que no sale de ahí es el desglose registrados/anónimos. Eso solo lo tiene
`user_guesses`, y allí faltan los que jugaron antes de julio-2026, cuando el
anónimo aún no recibía sesión.

**Decidido: ese desglose NO entra.** Mostrarlo obliga a llevar la asimetría
escrita al lado —sin esa nota, miente— y eso ensucia la tarjeta a cambio de muy
poco: la cifra que se pedía («cuántos lo han jugado») ya la da `total_games`
entera y sin asteriscos. Queda descartado a propósito, no olvidado.

## La tabla comparativa

`HardestCarsTable` (`src/admin/AnalyticsPanel.jsx:786`) se realimenta desde
`list_car_reports()`.

Motivo: hoy lee `user_guesses`, o sea **solo quien tiene sesión**, mientras que
la ficha leería `daily_stats`, que incluye a todos. Para el mismo coche la tabla
diría *12 jugadas* y la ficha *34*, sin explicación visible. El repo ya trata
esta clase de divergencia como un defecto — el comentario de `clasificarRepescas`
advierte de que dos vistas que cuentan distinto dejan que «nadie se entere», y
por eso esa función tiene test propio.

Cambios: misma fuente que la ficha, orden configurable (más fallados / más
fáciles / más jugados) e histórico completo en vez de solo el rango de fechas.

## Qué NO entra

- No se toca el motor de zoom ni las constantes de `zoom.js` (regla 7).
- No se añaden columnas a `public.cars`.
- No se cambia `recompute_car_difficulty` más allá de dejar **una sola**
  sobrecarga viva.
- No se expone nada de esto fuera del panel: son RPCs `service_role` tras
  `requireAdmin`.

## Reglas del proyecto que aplican

- **Regla 5 / 20 (hermeticidad).** Las RPCs nuevas no se otorgan a
  `anon`/`authenticated`, y el SQL versionado no enumera coches ni fechas: solo
  esquema, funciones y verificaciones por recuento.
- **Regla 3.** Al no añadir columnas a `cars`, no hay `GRANT` que decidir.
- **Regla 16.** `src/admin/` está exento del test de estética, pero la ficha
  seguirá el estilo oscuro del panel, sin emoji.
- **Regla 10.** Comentarios en español explicando el porqué.

## Verificación

- `npm test` (incluye `test:estetica`), `npm run test:rls`, `npm run build`.
- Test unitario para el cálculo derivado (% acierto, intento medio, coste) como
  función pura, al modo de `clasificarRepescas` en `analytics.test.js`.
- El diagnóstico SQL ejecutado contra Supabase **antes** de dar el bug por
  arreglado: el arreglo del `catch` mudo hace visible el error, pero no lo
  corrige. Si es la sobrecarga duplicada, hay que dropear la sobrante.

## Entrega

El cambio cae a **ambos lados** de la regla 13: `api/` + `scripts/` piden PR,
pero `src/admin/` está dentro de `src/` y por tanto viaja en el APK como chunk
lazy. En la práctica el panel **nunca se monta en la app** (guard de hostname de
la regla 19), así que el jugador no ve ningún cambio; pero el bundle cambia.

**Decidido: PR** (`claude/…` → `main`), porque hay Preview que mirar y
`api/`+`scripts/` es el grueso del cambio; y **sin subir `versionCode`**, porque
nada de lo que el jugador ve en la app cambia y la regla 17 existe para eso.

Consecuencia a no olvidar: el chunk del panel sí cambia en el bundle, así que la
próxima vez que se compile un APK por otro motivo, el `cap:sync` de esa entrega
se llevará también estos cambios. No hace falta hacer nada al respecto — solo
saberlo.
