# Temporadas Temáticas

**Fecha:** 2026-07-12
**Estado:** Diseño acordado en lo esencial (brainstorming PM/arquitecto). Quedan
2-3 decisiones abiertas marcadas abajo. Pendiente de plan de implementación.

## Problema

El juego se estructura hoy alrededor de un ranking **mensual** (por defecto) +
un **histórico** global. Funciona, pero el ciclo de un mes es largo y el
histórico acumulado es inalcanzable para un recién llegado: nadie remonta 2.000
puntos de un veterano, y eso desmotiva justo al jugador que queremos retener.

Queremos evolucionar a **Temporadas Temáticas**: ciclos cortos (1-2 semanas) con
una temática (Pelotillas deportivas, WRC, F1, Grupo B…). Cada temporada es un
**borrón y cuenta nueva**: todos vuelven a cero, hay un tema fresco como razón de
retorno, y un **campeón** al cierre. El reto es hacerlo **sin saturar la interfaz
ni dividir la atención** del jugador entre demasiadas escaleras competitivas.

## Hallazgo clave: ya construimos el 80% de esto

Las Temporadas **no son un sistema nuevo, son el ranking mensual generalizado**.
La maquinaria mensual ya deriva puntos al vuelo por límites de fecha; una
temporada es lo mismo con límites arbitrarios (`starts_at`/`ends_at`) en vez del
mes natural. Lo que ya existe y se reutiliza casi tal cual:

- `get_monthly_leaderboard(p_month, p_limit)` — deriva puntos base del periodo
  desde `user_guesses` (10/6/4/3/2/1 por intento; repesca a la mitad; sin bonus
  de racha, para que sea limpio y alcanzable). Solo cambia el `WHERE` de "mes" a
  "rango de la temporada". Ver `scripts/supabase-monthly-ranking.sql`.
- `monthly_podium` + `compute_monthly_podium` + `snapshot_previous_month_podium`
  — snapshot congelado del top-3 de cada periodo cerrado, con umbral anti-periodo
  vacío (5 jugadores). Se clona a `season_podium`.
- `rank_snapshots` + `snapshot_daily_ranks()` — el histórico de "puesto al empezar
  el día" que alimenta el **movimiento vs ayer** del *parte*. Se reutiliza intacto;
  solo cambia la fuente del snapshot (mensual → temporada). Ver
  `scripts/supabase-rank-movement.sql`.
- `RankParte.jsx` (el *parte* del final de partida) y la píldora de puesto del
  header — cambian de **scope**, no de estructura.

**Restricción de infra (plan Hobby):** máximo **2 cron jobs**. Ya se usan los dos
(`warm-daily`, `monthly-podium`). El cierre de temporadas **no puede ser un tercer
cron**: va *piggyback* dentro de `warm-daily` (el cron diario, donde ya vive
`snapshot_daily_ranks()`). Al retirar el ranking mensual, además, **liberamos el
slot de `monthly-podium`**.

## Decisiones (cerradas en brainstorming)

1. **Las Temporadas reemplazan al ranking mensual.** No coexisten. El scope
   "mes" desaparece de cara al usuario; la temporada ocupa su lugar como **única
   escalera competitiva principal**.
2. **El modal de rankings es de VISTA ÚNICA** (sin conmutador de pestañas): solo
   la clasificación de la temporada en curso, con banner del tema + countdown.
   *(La idea inicial de dos pestañas "Diario/Temporada" se descartó: "Diario" no
   existía como ranking y crear una segunda escalera competitiva contradecía el
   objetivo de no dividir la atención.)*
3. **Largo de temporada VARIABLE** vía `ends_at`. Un tema rico (F1) puede durar 2
   semanas; uno de nicho (Grupo B) solo una. La cadencia no se hardcodea.
4. **El histórico "Leyendas" (all-time) se repliega al PERFIL**, fuera del modal
   principal. Sigue vivo (es el palmarés del veterano) pero no compite por
   atención con el presente.
5. **Modelo de tres capas** (reencuadre aceptado):

   | Capa | Qué es | Reset | Dónde vive |
   |------|--------|-------|-----------|
   | **Temporada** | Clasificación del ciclo temático en curso | cada 1-2 sem | Modal principal (vista única) + píldora header + *parte* |
   | **Leyendas** | Acumulado all-time (`stats.total_points`, incluye racha) | nunca | Perfil (vista secundaria) |
   | **Salón de la Fama** | Campeones congelados de temporadas cerradas (medallas temáticas) | permanente | Perfil (vitrina de medallas) |

## Arquitectura

### 1. Modelo de datos — nuevo `scripts/2026-07-temporadas.sql`

**Tabla `seasons`** (fuente de verdad de qué temporada está activa):

```
id          uuid PK default gen_random_uuid()
number      int  not null              -- "Temporada 7" (display)
label_es    text not null              -- "Grupo B", "Coches de carreras"
label_en    text not null              -- "Group B", "Racing cars"
starts_at   date not null              -- inclusivo, calendario Madrid
ends_at     date not null              -- inclusivo, calendario Madrid
created_at  timestamptz default now()
```

- **Sin solapes.** Constraint de exclusión sobre el rango `[starts_at, ends_at]`
  (o validación en el editor admin + índice) para que `current_season()` sea
  siempre única.
- `label_es`/`label_en` porque el juego es bilingüe y algunos temas traducen
  ("Coches de carreras" → "Racing cars") y otros son nombres propios que no
  ("WRC", "Grupo B", "F1"). Contenido editorial, lo pone el admin.
- Lectura pública (`GRANT SELECT ... TO anon, authenticated`) — el tema y las
  fechas son públicos (es el gancho de marketing). Escritura solo admin/service.

**Helper `current_season()`** → la fila de `seasons` donde la fecha Madrid de hoy
cae en `[starts_at, ends_at]`. `NULL` si hay un hueco entre temporadas (ver
*Decisión abierta B*). Lo consumen el leaderboard, la píldora y el *parte*.

**Tabla `season_podium`** (clon de `monthly_podium`):

```
season_id  uuid  references seasons(id) on delete cascade
rank       int   check (rank between 1 and 3)
user_id    uuid  references auth.users(id) on delete cascade
points     int   not null
created_at timestamptz default now()
PRIMARY KEY (season_id, rank)
```

Lectura pública, escritura por función SECURITY DEFINER / service_role. Mismo
patrón exacto que el podio mensual.

### 2. Leaderboard de temporada — generalizar el mensual

`get_season_leaderboard(p_season_id uuid DEFAULT NULL, p_limit int DEFAULT 1000)`:
copia de `get_monthly_leaderboard` donde el CTE `bounds` sale de la fila de
`seasons` (`starts_at` .. `ends_at + 1 día`) en vez de `date_trunc('month')`.
`p_season_id = NULL` → `current_season()`. **Todo lo demás idéntico**: misma
derivación de puntos base, mismo `EXISTS` daily-vs-repesca (repesca a mitad),
mismo desempate, mismos GRANT. Devuelve el mismo shape → `Ranking.jsx` reutiliza
el render de filas sin tocarlo.

- **Repesca dentro de la ventana:** una repesca de un coche cuyo día cae dentro de
  `[starts_at, ends_at]` cuenta a mitad de puntos para la temporada (igual que hoy
  en el mensual, que bota por `ug.date`). Al cerrarse la temporada su podio se
  **congela** (`season_podium`); repescar ese coche *después* del cierre ya no
  mueve la medalla — solo suma a Leyendas/colección.

### 3. Salón de la Fama — cierre *piggyback*, sin cron nuevo

- `compute_season_podium(p_season_id, p_min_players default 5)` → clon de
  `compute_monthly_podium`: idempotente (borra+reinserta), umbral anti-temporada
  vacía. Congela el top-3 en `season_podium`.
- `close_finished_seasons()` → recorre las `seasons` cuyo `ends_at` fue **ayer**
  (Madrid) y que aún no tengan podio, y llama a `compute_season_podium`. Idempotente.
- **Se dispara desde `warm-daily`** (el cron diario), como un PASO más junto a
  `snapshot_daily_ranks()`. Un chequeo diario "¿cerró ayer alguna temporada?"
  resuelve la cadencia variable **sin gastar un cron** (respeta el límite de 2).
- **`monthly-podium` se retira** de `vercel.json` (libera el slot 2). Las medallas
  mensuales históricas que ya existan en `monthly_podium` → ver *Decisión abierta C*.

### 4. El *parte* + píldora del header → scope temporada + countdown

- `snapshot_daily_ranks()` sella hoy como baseline del "vs ayer". Cambia **una
  línea**: `get_monthly_leaderboard(NULL,…)` → `get_season_leaderboard(NULL,…)`.
  La tabla `rank_snapshots` (keyed por `day, user_id`) se reutiliza intacta: el
  día 1 de una temporada nueva el leaderboard está vacío → snapshot vacío →
  `prev_rank = NULL` → copy neutro ("estrenas puesto"). Comportamiento correcto
  de reset sin código extra.
- `get_my_monthly_rank` → `get_my_season_rank(p_user_id, p_season_id)`, misma
  extensión `prev_rank`/`delta`. `statsService.getMyMonthlyRank` → `getMySeasonRank`.
- `RankParte.jsx`: el ladillo "· Julio" pasa a "· {label de temporada}", y
  ganamos una palanca nueva: **countdown de cierre** ("Cierra en 2 días"), que es
  urgencia más fuerte que el fin de mes. La lógica de movimiento (`rankMovement.js`)
  no se toca: consume el mismo `{rank,total,delta,isNew}`.
- Píldora del header: `getMySeasonRank` en vez de `getMyMonthlyRank`.

### 5. Modal de rankings → vista única + Leyendas al perfil

`src/components/Ranking.jsx`:

- **Se elimina el conmutador de pestañas** (`tab` state, grid de tabs `month/all`).
  El modal carga directamente `getSeasonLeaderboard()`.
- **Banner del tema arriba**: número + `label` de la temporada + countdown. Es la
  única superficie *nueva* de UI, y es donde gastar diseño (usa el token `--gold`,
  "esto es valioso": el tema y el campeonato son el momento premium).
- El histórico all-time (`getLeaderboard`) **deja de invocarse aquí** y pasa a una
  vista secundaria en el Perfil ("Leyendas"), como una "puerta" más del carnet
  (patrón que ya usa `getProfileSummary`).
- La vitrina de medallas del perfil (`getMonthlyMedals`) → `getSeasonMedals`:
  medallas temáticas ("🏆 Campeón · Grupo B"), mucho más coleccionables que
  "Campeón de mayo".

### 6. Binding temporada ↔ pool temático (por fases)

El admin **ya** cura el calendario (`schedule.js`: `pick_daily_car` idempotente +
swap manual + randomize, ventana de 7 días). Aprovechamos eso:

- **Fase 1 (MVP) — curación manual.** `seasons` es metadata (label + rango). El
  admin programa a mano coches del tema en las fechas de la temporada usando el
  editor de calendario. El leaderboard/podio/banner/*parte* solo necesitan el
  **rango de fechas**, no saber qué coches son. `pick_daily_car` sigue siendo
  agnóstico (su random es solo red de seguridad que el admin evita durante una
  temporada). **Cambio necesario:** ampliar la ventana de `schedule.js` (hoy 7
  días) para cubrir una temporada de hasta 2 semanas.
- **Fase 2 (opcional, más adelante) — pool automático.** Etiquetar `cars` con
  categoría/tema (columna o tabla puente) y hacer `pick_daily_car` *season-aware*
  (elige solo del pool del tema activo). Evita que un autofill meta un coche
  fuera de tema. Es un proyecto de contenido (taggear el catálogo) → no bloquea
  el MVP.

### 7. Editor de temporadas (admin)

Nueva sección en `/admin-tools`: CRUD de `seasons` (número, `label_es`/`label_en`,
`starts_at`, `ends_at`), con validación de no-solape y un aviso si el rango tiene
días sin coche programado. Reutiliza el patrón de handlers de `lib/admin-handlers/`
+ `requireAdmin` (whitelist por email) + service_role.

### 8. i18n

Claves nuevas en `es.json`/`en.json`: título/banner de temporada, countdown
("Cierra hoy" / "Cierra en {n} días"), ladillo del *parte*, "Leyendas", "Salón de
la Fama". Retirar/renombrar las claves de scope mensual (`ranking.tabMonth`,
`ranking.tabAll`, `parte.kicker` mensual). Nada hardcodeado (regla del proyecto).

## Longevidad y suministro de contenido

Duda legítima: ¿dan de sí los coches temáticos? Respuesta honesta: **el cuello de
botella de longevidad ya existe hoy y es independiente de las temporadas.** El
juego quema **1 coche/día** y `pick_daily_car` **no reutiliza** (bloqueo permanente
sobre `daily_cars`), eligiendo solo entre coches con `image_ready=TRUE` (el batch
de 200 de mayo entró en `FALSE` a propósito: no son jugables hasta subir imagen).
Vida ≈ (coches image-ready sin usar) / 365 al año, **con o sin temporadas**. Las
temporadas **no cambian la quema total** (sigue siendo 1/día); solo la **agrupan**,
y por eso un tema estrecho *hace notar* la escasez sin crearla.

Estrategia para que la Opción 1 sea sostenible:

- **Temas-columna (80-90% del calendario): amplios y renovables.** Particiones
  naturales de cualquier catálogo: por **época** (80s, youngtimers, clásicos),
  **segmento** (deportivos, SUV, berlinas), **origen** (italianos, alemanes,
  japoneses), **marca** (temporada Porsche, BMW…), **gama** (superdeportivos,
  utilitarios). Decenas-cientos de candidatos y **recurren para siempre** (siempre
  hay otra tanda de "Alemanes" con coches frescos). Son la base.
- **Temas-evento (10-20%): estrechos y evocadores** (Grupo B ≈ una docena, un rally
  concreto). Dan para **una** temporada corta, re-ejecutable años después. Son la
  especia y el momento premium (oro), no la base.
- **El suelo protege:** como la Opción 1 admite una temporada "Variado/General", el
  peor caso es **el juego de hoy con etiqueta** — nunca puedes estar *más* corto de
  contenido que ahora. Los temas estrechos son opt-in cuando hay coches, jamás
  obligatorios.

Las temporadas incluso **ayudan** al suministro: un tema dice exactamente qué
sourcear ("necesito 12 alemanes para octubre"), convirtiendo una tarea abierta en
lotes enfocados. El batch de 200 en `image_ready=FALSE` es **runway latente** que
se libera al ritmo que el admin suba imágenes. La mayor palanca de longevidad es
relajar el no-repeat (ver *Decisión abierta D*).

## Testing y verificación

- **Unit (Vitest):** `get_season_leaderboard` es SQL, pero la derivación de
  puntos ya está cubierta por los tests de score; añadir cobertura a
  `rankMovement`/`statsService` para el nuevo scope. Test de `current_season()`
  con rangos límite (primer día, último día, hueco entre temporadas).
- **RLS/ataques:** `season_podium` y `seasons` deben pasar `test:rls`/`test:attacks`
  (lectura pública OK, escritura solo definer/service). El leaderboard no debe
  filtrar intentos individuales (SECURITY DEFINER como el mensual).
- **Regla #5 (no filtrar el coche):** revisar que revelar el **tema** no colapsa
  el espacio de respuestas en temas estrechos (Grupo B ≈ pocos modelos). Mitigación
  con `cars.zoom_base` (subir dificultad en temas fáciles). Documentar el trade-off.
- **Preview de Vercel (manual):** crear una temporada de prueba, sembrar
  `snapshot_daily_ranks()` a mano, jugar y comprobar: banner + countdown, *parte*
  con movimiento, cierre (`close_finished_seasons` idempotente), medalla en perfil,
  Leyendas accesible desde el perfil, modal de vista única sin pestañas.

## Fuera de alcance (YAGNI)

- Pool automático por tema (Fase 2) — el MVP cura a mano.
- Recompensas materiales por ganar temporada más allá de la medalla (cosméticos,
  insignias animadas): iteración posterior.
- Ligas/divisiones o emparejamiento por nivel: seguimos con un único leaderboard
  abierto por temporada.
- Migrar el histórico Leyendas a un modelo derivado: sigue leyendo el acumulado
  de `stats.total_points`, que se auto-mantiene. No se toca.
- Notificación push de "cierra la temporada": encaja con el sistema de push
  existente pero es otra tarea.

## Decisiones abiertas (para cerrar antes del plan)

- **A — Etiquetas de las pestañas / naming visible.** Con vista única no hay
  pestañas, pero sí hay que nombrar las capas de cara al usuario: ¿"Temporada" /
  "Leyendas" / "Salón de la Fama"? ¿o "Clasificación" a secas para la principal?
- **B — Huecos entre temporadas.** ¿Las temporadas son contiguas (una empieza el
  día que acaba la anterior) o puede haber días "sin temporada"? Si puede haber
  hueco, `current_season()` devuelve NULL y hay que decidir el fallback del modal
  (¿mostrar la última cerrada? ¿un "próximamente"?). **Recomendación:** contiguas,
  para que nunca haya un día sin clasificación viva.
- **C — Medallas mensuales históricas.** Al retirar el mensual, ¿qué hacemos con
  las medallas de `monthly_podium` ya ganadas? **Recomendación:** preservarlas como
  "medallas de mes (legado)" en el perfil junto a las de temporada — quitar un
  trofeo ganado es aversión a la pérdida en su peor forma. Alternativas: migrarlas
  a `season_podium` sintéticas, o descartarlas (no recomendado).
- **D — ¿Relajar el no-repeat con cooldown?** Hoy un coche jugado se quema para
  siempre; la vida del juego es (image-ready sin usar) / 365 al año. Permitir que
  un coche reaparezca tras un cooldown largo (¿12-18 meses?) multiplica el catálogo
  efectivo y hace **reutilizables los temas-evento**. **Recomendación:** roadmap,
  no MVP — medir primero quema real vs. crecimiento del catálogo. Requiere tocar
  `pick_daily_car` (`NOT IN` → "no usado en los últimos N meses") y comunicar la
  rotación al jugador.

## Archivos afectados (previsión)

- `scripts/2026-07-temporadas.sql` (nuevo) — `seasons`, `season_podium`,
  `current_season()`, `get_season_leaderboard`, `get_my_season_rank`,
  `compute_season_podium`, `close_finished_seasons`; ALTER de `snapshot_daily_ranks()`.
- `api/_lib/cron/warm-daily.js` — nuevo PASO: `close_finished_seasons()`.
- `vercel.json` — retirar el cron `monthly-podium` (libera slot).
- `api/cron/[...job].js` — retirar/renombrar la ruta `monthly-podium`.
- `src/lib/statsService.js` — `getMonthlyLeaderboard`→`getSeasonLeaderboard`,
  `getMyMonthlyRank`→`getMySeasonRank`, `getMonthlyMedals`→`getSeasonMedals`,
  + fetch de la temporada activa.
- `src/components/Ranking.jsx` — quitar pestañas → vista única; banner+countdown;
  sacar Leyendas.
- `src/components/configurator/RankParte.jsx` — reapuntar a puesto de temporada;
  ladillo→label; countdown.
- Header / `useAuthSession` — píldora con `getMySeasonRank`.
- `src/components/MyStats.jsx` / `PublicProfile.jsx` — "Leyendas" (all-time) +
  vitrina de medallas de temporada.
- `lib/admin-handlers/schedule.js` — ampliar ventana; mostrar temporada activa;
  (Fase 2) pick season-aware.
- `src/admin/…` — editor de `seasons` (nuevo).
- `src/i18n/locales/es.json`, `en.json` — claves de temporada/countdown/Leyendas;
  retirar las de mes.
- `PRODUCT.md` — actualizar la descripción de rankings (mensual → temporadas).
