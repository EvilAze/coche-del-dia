# Cambio de emergencia del coche del día — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder sustituir el coche del día con la jornada empezada, sin que
nadie pueda rejugar y sin cortarle la partida a quien ya estaba jugando.

**Architecture:** El día pasa a tener *revisiones*. `daily_cars.prev_car_ids`
guarda los coches salientes; quien ya tiene partida se queda con el suyo hasta
medianoche. Cada jugador queda anclado por lo que ya existía: los logueados por
el `car_id` de su fila de `user_guesses`, los anónimos por un sello HMAC opaco
en su token, y la foto por el `v` de la URL del proxy de imagen.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), Vercel Edge + Serverless
(JS, sin TypeScript), React 18, Vitest.

**Diseño:** `docs/superpowers/specs/2026-08-25-cambio-emergencia-coche-del-dia-design.md`

---

## Contexto que el implementador necesita antes de empezar

**Cinco cosas de este proyecto que no se deducen del código que vas a tocar:**

1. **No hay TypeScript.** JSX y módulos ES. Comentarios **en español,
   explicando el porqué** — no lo que hace la línea, sino por qué está.
2. **La identidad del coche del día no puede salir del servidor** (regla 5 de
   `CLAUDE.md`): ni el `id`, ni la URL real del CDN. Por eso el token anónimo
   lleva un **sello HMAC** y no el `car_id`: el cliente lee ese payload.
3. **Este repositorio es público** (regla 20). En los `.sql` versionados van
   esquema, funciones y comprobaciones; **nunca** datos que permitan acotar qué
   coche toca.
4. **Los clientes lazy de Supabase**: `getSupabaseAdmin()`, nunca
   `const supabase = createClient(...)` a nivel de módulo (regla 2).
5. **Verificación por Preview de Vercel**, no `vercel dev` (regla 12). Tu red de
   seguridad es `npm test` y `npm run build`.

**Los dos agujeros que este plan tapa y que no son evidentes:**

- `user_guesses` **no distingue** una partida diaria de una repesca: misma
  tabla, misma fecha, distinto `car_id`. Por eso jamás se busca «la fila de hoy
  del usuario» a secas, sino **acotada a `{coche vigente} ∪ prev_car_ids`**.
- `record_daily_result_v2` **se re-deriva el coche del día por su cuenta**, así
  que sin el parche de la Tarea 1 un jugador congelado gana y no se le registra
  ni puntos ni racha.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `scripts/2026-08-cambio-emergencia-coche-del-dia.sql` | **Crear.** Columna `prev_car_ids`, RPC `coche_de_hoy`, parche de `record_daily_result_v2` |
| `api/_lib/coche-de-hoy.js` | **Crear.** Función pura: a qué coche está anclado quien pregunta |
| `api/_lib/coche-de-hoy.test.js` | **Crear.** Toda la lógica delicada vive aquí |
| `api/_lib/version-imagen.js` | **Crear.** `v` de la URL de imagen, un solo sitio para los dos endpoints |
| `api/_lib/sello.js` | **Crear.** Sello HMAC opaco de un coche (Web Crypto: vale en Edge y en Node) |
| `api/_lib/sello.test.js` | **Crear.** Que el sello no filtre el `car_id` y sea estable |
| `api/_lib/edge/anon-session.js` | Modificar: el token pasa de `{d,n,s}` a `{d,n,s,c}` |
| `api/_lib/anon-session.js` | Modificar: **réplica** de lo anterior, mismo formato de wire |
| `api/get-daily-car.js` | Modificar: RPC nueva con fallback, resolvedor, `sello` en la respuesta |
| `api/daily-image.js` | Modificar: `v` como selector de revisión |
| `api/validate-guess.js` | Modificar: resolvedor + 409 `coche_cambiado` |
| `api/_lib/schedule-free.js` | Modificar: guard `validateSwapDate` (hoy deja de ser asignable) |
| `lib/admin-handlers/schedule.js` | Modificar: el POST rechaza hoy |
| `lib/admin-handlers/emergency-swap.js` | **Crear.** El cambio de emergencia, con su recuento |
| `api/admin/[...slug].js` | Modificar: ruta nueva |
| `src/admin/SchedulePanel.jsx` | Modificar: botón de emergencia en la fila de hoy |
| `src/admin/EmergencySwapModal.jsx` | **Crear.** Confirmación en dos pasos con el recuento delante |
| `api/_lib/cron/warm-daily.js` | Modificar: exportar `writeEdgeConfig` para reusarla tras el cambio |
| `lib/admin-handlers/audit.js` | Modificar (R2): un día puede tener más de un coche |
| `api/garage.js` | Modificar (R5): documentar qué pasa con el coche saliente |
| `src/hooks/useGame.js` | Modificar: reenviar el sello, manejar el 409 |

**Orden de entrega** (regla 13): Tareas 1–9 son `api/`, `scripts/`, `lib/` y
`src/admin/` → **un PR**. La Tarea 10 toca `src/` fuera de `admin/` → viaja en
el APK → **directo a `main` con subida de versión**, y después del PR.

---

## Tarea 1: SQL — columna, envoltura y parche

**Files:**
- Create: `scripts/2026-08-cambio-emergencia-coche-del-dia.sql`

Este script lo ejecuta el usuario a mano en el SQL Editor de Supabase. No hay
migraciones automáticas en este proyecto: los `.sql` de `scripts/` son el
registro versionado de lo que se ejecutó.

- [ ] **Step 1: Escribir el script**

```sql
-- scripts/2026-08-cambio-emergencia-coche-del-dia.sql
-- Cambio de emergencia del coche del día: el día pasa a tener REVISIONES.
--
-- Qué problema resuelve: sale un coche que no tocaba y hay que sustituirlo con
-- la jornada ya empezada. Cambiar `daily_cars.car_id` a secas le da a cada
-- usuario logueado un tablero a cero y cinco intentos nuevos, porque
-- `user_guesses` está clavada por (user_id, car_id, date): el día se podría
-- rejugar. Con revisiones, quien ya jugó se queda con SU coche hasta
-- medianoche y quien no ha empezado ve el nuevo.
--
-- Idempotente: se puede ejecutar dos veces sin daño.
-- Regla 20: aquí solo hay esquema y funciones. Ni un solo car_id.

-- ===========================================================================
-- [1] La columna: qué coches han sido el de hoy antes que el actual
-- ===========================================================================
-- Un array y no una tabla aparte porque el dato es por fecha, se resetea solo
-- al cambiar el día y nunca tendrá más de un puñado de elementos. `daily_cars`
-- está revocada para anon/authenticated por el hardening, así que no hace falta
-- GRANT (y no debe llevarlo: dice de qué coches va el día).
ALTER TABLE public.daily_cars
  ADD COLUMN IF NOT EXISTS prev_car_ids uuid[] NOT NULL DEFAULT '{}';

-- ===========================================================================
-- [2] coche_de_hoy(): el coche vigente Y los salientes, en un solo viaje
-- ===========================================================================
-- Por qué existe: el resolvedor del servidor necesita `prev_car_ids` para
-- acotar el ancla del usuario, y leerlos con una segunda consulta añadiría un
-- round-trip al ÚNICO request bloqueante del primer paint.
--
-- No toca el sorteo: delega en pick_daily_car, que es donde vive la temática de
-- la temporada. Es una envoltura, y a propósito — cualquier camino que elija
-- coche sin pasar por la RPC se salta el tema en silencio.
CREATE OR REPLACE FUNCTION public.coche_de_hoy(p_date date)
RETURNS TABLE (car_id uuid, prev_car_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotente: fija el coche de la fecha si aún no lo estaba y lo devuelve.
  PERFORM public.pick_daily_car(p_date);

  RETURN QUERY
  SELECT d.car_id, COALESCE(d.prev_car_ids, '{}'::uuid[])
  FROM public.daily_cars d
  WHERE d.date = p_date;
END;
$$;

-- Solo el servidor la llama, y siempre con service_role.
REVOKE ALL ON FUNCTION public.coche_de_hoy(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coche_de_hoy(date) TO service_role;

-- ===========================================================================
-- [3] Parche de record_daily_result_v2
-- ===========================================================================
-- SIN ESTO, EL RESTO DE LA FUNCIONALIDAD HACE DAÑO. La función se re-deriva el
-- coche del día con pick_daily_car y luego busca la partida por ese car_id. Un
-- jugador congelado tiene su fila con el car_id VIEJO, así que:
--   · `v_guesses is null` → raise 'No game state for today' → gana y no se le
--     registra ni puntos ni racha;
--   · y dentro del `if p_won`, la ficha real se lee por v_car, así que su
--     intento ganador tampoco casaría ('Winning guess does not match real car').
--
-- El parche resuelve v_car UNA vez al principio y el resto del cuerpo sigue
-- igual sin enterarse. No abre ningún agujero: v_prev solo contiene coches que
-- REALMENTE fueron el coche del día, así que un coche de repesca (misma tabla,
-- misma fecha, otro car_id) no puede colarse por ahí a robar puntos y racha.
CREATE OR REPLACE FUNCTION public.record_daily_result_v2(p_won boolean, p_attempt_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user            uuid := auth.uid();
  v_today           date := (now() at time zone 'Europe/Madrid')::date;
  v_car             uuid;
  v_prev            uuid[];
  v_car_congelado   uuid;
  v_guesses         jsonb;
  v_status          text;
  v_real_attempts   int;
  v_expected_status text;
  v_make            text;
  v_model           text;
  v_year            int;
  v_last_guess      jsonb;
  v_g_marca         text;
  v_g_modelo        text;
  v_g_anio          int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_car := public.pick_daily_car(v_today);
  if v_car is null then
    raise exception 'No daily car for today';
  end if;

  -- ---- Revisiones del día (cambio de emergencia) -------------------------
  -- Si el usuario tiene fila en una revisión ANTERIOR de hoy, esa es su
  -- partida: la jugó contra ese coche y contra ese coche hay que verificarla.
  -- En un día normal prev_car_ids está vacío y esto no hace absolutamente nada.
  select coalesce(prev_car_ids, '{}'::uuid[]) into v_prev
  from public.daily_cars
  where date = v_today;

  if array_length(v_prev, 1) is not null then
    select car_id into v_car_congelado
    from public.user_guesses
    where user_id = v_user
      and date    = v_today
      and car_id  = any(v_prev)
    limit 1;

    if v_car_congelado is not null then
      v_car := v_car_congelado;
    end if;
  end if;
  -- ------------------------------------------------------------------------

  -- user_guesses.date es DATE → comparación directa, sin cast.
  select guesses, status
    into v_guesses, v_status
  from user_guesses
  where user_id = v_user
    and car_id  = v_car
    and date    = v_today;

  if v_guesses is null then
    raise exception 'No game state for today';
  end if;

  v_real_attempts := jsonb_array_length(v_guesses);
  v_expected_status := case when p_won then 'won' else 'lost' end;

  if v_status <> v_expected_status then
    raise exception 'Won mismatch (client=%, server=%)', p_won, v_status;
  end if;
  if v_real_attempts <> p_attempt_number then
    raise exception 'Attempt mismatch (client=%, server=%)',
      p_attempt_number, v_real_attempts;
  end if;

  if p_won then
    select make, model, year
      into v_make, v_model, v_year
    from cars
    where id = v_car;

    v_last_guess := v_guesses -> (v_real_attempts - 1);
    v_g_marca  := lower(trim(coalesce(v_last_guess->'marca'->>'val', '')));
    v_g_modelo := lower(trim(coalesce(v_last_guess->'modelo'->>'val', '')));
    v_g_anio   := nullif(v_last_guess->'anio'->>'val', '')::int;

    if v_g_marca  <> lower(v_make)
       or v_g_modelo <> lower(v_model)
       or v_g_anio is null
       or abs(v_g_anio - v_year) > 2
    then
      raise exception 'Winning guess does not match real car';
    end if;
  end if;

  return public.record_daily_result(p_won, p_attempt_number);
end;
$function$;

-- ===========================================================================
-- [4] Verificación (ejecutar después; devuelve filas, no cambia nada)
-- ===========================================================================
-- La columna existe y es NOT NULL con default:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'daily_cars'
ORDER BY ordinal_position;

-- La envoltura devuelve el mismo coche que el sorteo, y el array vacío:
SELECT * FROM public.coche_de_hoy((now() AT TIME ZONE 'Europe/Madrid')::date);

-- El parche está dentro (debe aparecer 'v_car_congelado'):
SELECT position('v_car_congelado' in pg_get_functiondef(p.oid)) > 0 AS parche_aplicado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_daily_result_v2';
```

- [ ] **Step 2: Comprobar que el fichero es UTF-8 de verdad**

Regla 14: un re-guardado con codificación errónea convierte las tildes en
mojibake. Run: `file scripts/2026-08-cambio-emergencia-coche-del-dia.sql`
Expected: `UTF-8 Unicode text`

- [ ] **Step 3: Commit**

```bash
git add scripts/2026-08-cambio-emergencia-coche-del-dia.sql
git commit -m "feat(sql): revisiones del dia para el cambio de emergencia"
```

- [ ] **Step 4: PARADA — el usuario ejecuta el script en Supabase**

No sigas sin esto. Pídeselo explícitamente y espera el resultado del bloque
`[4]`: `parche_aplicado` tiene que salir `true`. Todo lo demás depende de que
la columna y la RPC existan.

---

## Tarea 2: El sello — un identificador de coche que no identifica al coche

**Files:**
- Create: `api/_lib/sello.js`
- Create: `api/_lib/sello.test.js`

El token anónimo tiene que decir «yo venía jugando con *aquel* coche» sin decir
cuál. Un HMAC truncado lo hace: el cliente lo lee y no aprende nada.

- [ ] **Step 1: Escribir el test que falla**

```js
// api/_lib/sello.test.js
// Lo que de verdad importa aquí no es que el HMAC funcione: es que el sello NO
// contenga el car_id. Viaja en el token anónimo, que el cliente puede leer y
// descodificar; si el id se pudiera sacar de ahí, bastaría cruzarlo con
// /api/list-cars para saber el coche del día (regla 5).

import { describe, it, expect, beforeAll } from "vitest";
import { selloDeCoche } from "./sello.js";

const CAR = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTRO = "9c858901-8a57-4791-81fe-4c455b099bc9";
const HOY = "2026-08-25";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("selloDeCoche", () => {
  it("no contiene el car_id ni ninguno de sus trozos", async () => {
    const sello = await selloDeCoche(CAR, HOY);
    expect(sello).not.toContain(CAR);
    for (const trozo of CAR.split("-")) {
      expect(sello.toLowerCase()).not.toContain(trozo.toLowerCase());
    }
  });

  it("es estable: el mismo coche y día dan el mismo sello", async () => {
    expect(await selloDeCoche(CAR, HOY)).toBe(await selloDeCoche(CAR, HOY));
  });

  it("distingue coches", async () => {
    expect(await selloDeCoche(CAR, HOY)).not.toBe(await selloDeCoche(OTRO, HOY));
  });

  it("distingue días: el mismo coche en otra fecha sella distinto", async () => {
    expect(await selloDeCoche(CAR, HOY)).not.toBe(await selloDeCoche(CAR, "2026-08-26"));
  });

  it("sin secreto devuelve null en vez de un sello falso", async () => {
    const previo = process.env.REPESCA_TOKEN_SECRET;
    process.env.REPESCA_TOKEN_SECRET = "";
    expect(await selloDeCoche(CAR, HOY)).toBe(null);
    process.env.REPESCA_TOKEN_SECRET = previo;
  });

  it("sin carId devuelve null", async () => {
    expect(await selloDeCoche(null, HOY)).toBe(null);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run api/_lib/sello.test.js`
Expected: FAIL — `Failed to resolve import "./sello.js"`

- [ ] **Step 3: Implementar**

```js
// api/_lib/sello.js
// Sello opaco de un coche para una fecha. Es la forma de que un cliente diga
// «yo venía jugando con AQUEL coche» sin que nadie pueda saber cuál era.
//
// Por qué no viaja el car_id a secas: el sello va dentro del token de sesión
// anónima, cuyo payload es base64 legible desde el navegador. Publicar ahí el
// id del coche del día permitiría cruzarlo con /api/list-cars y saber la
// respuesta sin jugar (regla 5).
//
// HMAC y no un hash pelado: sin el secreto no se puede calcular el sello de un
// coche, así que tampoco se puede ir probando los ids del catálogo hasta dar
// con el que casa.
//
// Web Crypto (no node:crypto) a propósito: este módulo lo importan tanto
// get-daily-car (runtime Edge) como validate-guess (Node), y así hay UN solo
// sello en vez de dos réplicas que puedan divergir.

import { hmacSha256Base64Url } from "./edge/crypto.js";

// 16 caracteres base64url ≈ 96 bits: de sobra para que dos coches no colisionen
// y lo bastante corto para no engordar un token que viaja en cada petición.
const LARGO = 16;

/**
 * @param {string|null} carId
 * @param {string} fecha  YYYY-MM-DD
 * @returns {Promise<string|null>} null si falta el secreto o el coche — quien
 *   lo llama debe tratar el null como «no hay sello», nunca como un sello.
 */
export async function selloDeCoche(carId, fecha) {
  const secret = process.env.REPESCA_TOKEN_SECRET || "";
  if (!secret || !carId) return null;
  const firma = await hmacSha256Base64Url(secret, `sello:${fecha}:${carId}`);
  return firma.slice(0, LARGO);
}

/**
 * Sellos de una lista de coches, como mapa carId → sello. Los endpoints lo
 * calculan y se lo pasan al resolvedor, que es puro y síncrono.
 */
export async function sellosDe(carIds, fecha) {
  const mapa = {};
  for (const id of carIds || []) {
    if (!id) continue;
    mapa[id] = await selloDeCoche(id, fecha);
  }
  return mapa;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run api/_lib/sello.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add api/_lib/sello.js api/_lib/sello.test.js
git commit -m "feat(sello): identificador opaco de coche para el token anonimo"
```

---

## Tarea 3: El resolvedor puro

**Files:**
- Create: `api/_lib/coche-de-hoy.js`
- Create: `api/_lib/coche-de-hoy.test.js`

Aquí vive toda la lógica delicada. Es pura (sin I/O) por dos motivos: la
consumen los dos runtimes (Edge y Node) y es un guard sobre partidas en curso —
su única garantía no puede ser una lectura atenta del `if`.

- [ ] **Step 1: Escribir el test que falla**

```js
// api/_lib/coche-de-hoy.test.js
// El caso que motivó este módulo no es el camino feliz, son dos trampas:
//
//   1. Las partidas de REPESCA viven en la misma tabla que las diarias, con la
//      misma fecha y otro car_id. Anclar al usuario a «su fila de hoy» a secas
//      lo clavaría al coche de su repesca. Por eso el ancla se acota a
//      {vigente} ∪ prev.
//   2. Quien tiene la pestaña abierta desde antes del cambio ve la foto vieja.
//      Si responde, se le puntuaría contra el coche nuevo. Por eso existe
//      cocheCambiado.

import { describe, it, expect } from "vitest";
import { resolverCocheDelUsuario } from "./coche-de-hoy.js";

const VIGENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const VIEJO   = "bbbbbbbb-0000-0000-0000-000000000002";
const REPESCA = "cccccccc-0000-0000-0000-000000000003";

const SELLOS = {
  [VIGENTE]: "selloVigente0001",
  [VIEJO]: "selloViejo000002",
};

// Día normal: nunca ha habido cambio de emergencia.
const normal = (extra = {}) =>
  resolverCocheDelUsuario({
    carIdVigente: VIGENTE,
    prevCarIds: [],
    sellosPorCarId: { [VIGENTE]: SELLOS[VIGENTE] },
    ...extra,
  });

// Día con un cambio de emergencia hecho.
const cambiado = (extra = {}) =>
  resolverCocheDelUsuario({
    carIdVigente: VIGENTE,
    prevCarIds: [VIEJO],
    sellosPorCarId: SELLOS,
    ...extra,
  });

describe("día normal — se comporta exactamente como antes", () => {
  it("sin nada, el coche vigente", () => {
    expect(normal()).toEqual({ carId: VIGENTE, congelado: false, cocheCambiado: false });
  });

  it("con fila del usuario, el coche vigente", () => {
    const r = normal({ filaUsuario: { car_id: VIGENTE, status: "playing" } });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("con el sello al día, el coche vigente y sin aviso", () => {
    const r = normal({ selloCliente: SELLOS[VIGENTE] });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(false);
  });
});

describe("logueado", () => {
  it("con fila en la revisión anterior, se queda congelado en su coche", () => {
    const r = cambiado({ filaUsuario: { car_id: VIEJO, status: "playing" } });
    expect(r).toEqual({ carId: VIEJO, congelado: true, cocheCambiado: false });
  });

  it("con fila terminada en la revisión anterior, sigue congelado", () => {
    const r = cambiado({ filaUsuario: { car_id: VIEJO, status: "won" } });
    expect(r.carId).toBe(VIEJO);
    expect(r.congelado).toBe(true);
  });

  it("sin fila, juega el coche nuevo", () => {
    expect(cambiado({ filaUsuario: null }).carId).toBe(VIGENTE);
  });

  it("una fila de REPESCA no lo ancla: no es ni el vigente ni un saliente", () => {
    const r = cambiado({ filaUsuario: { car_id: REPESCA, status: "playing" } });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("la fila manda sobre el sello: fila vieja + sello nuevo → congelado", () => {
    const r = cambiado({
      filaUsuario: { car_id: VIEJO, status: "playing" },
      selloCliente: SELLOS[VIGENTE],
    });
    expect(r.carId).toBe(VIEJO);
  });
});

describe("anónimo", () => {
  it("con partida empezada y sello viejo, se queda congelado", () => {
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 2 });
    expect(r).toEqual({ carId: VIEJO, congelado: true, cocheCambiado: false });
  });

  it("con CERO intentos y sello viejo, juega el coche nuevo", () => {
    // Tenía la web abierta desde antes del cambio pero no había jugado nada:
    // no hay partida que congelar.
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 0 });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
    expect(r.cocheCambiado).toBe(true);
  });

  it("sin sello (token viejo sin el campo), juega el coche vigente", () => {
    const r = cambiado({ selloCliente: null, intentosAnon: 3 });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });
});

describe("cocheCambiado — el aviso de «recarga, estás viendo otra foto»", () => {
  it("sello desconocido y sin ancla → avisa", () => {
    const r = cambiado({ selloCliente: "selloDeOtraCosa1" });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(true);
  });

  it("un congelado NO recibe el aviso: su partida es válida", () => {
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 1 });
    expect(r.cocheCambiado).toBe(false);
  });

  it("sin sello no se avisa de nada (cliente viejo, no sabemos)", () => {
    expect(cambiado({ selloCliente: null }).cocheCambiado).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run api/_lib/coche-de-hoy.test.js`
Expected: FAIL — `Failed to resolve import "./coche-de-hoy.js"`

- [ ] **Step 3: Implementar**

```js
// api/_lib/coche-de-hoy.js
// ¿A qué coche está anclado quien pregunta?
//
// Desde el cambio de emergencia, el coche del día ya no es «el que dice
// daily_cars»: es EL TUYO. Quien ya tenía partida cuando se cambió el coche
// sigue con el suyo hasta medianoche; quien no había empezado ve el nuevo. Así
// nadie rejuega el día y a nadie se le corta una partida a medias.
//
// PURA Y SIN I/O a propósito, por dos motivos:
//   · La consumen los DOS runtimes: get-daily-car es Edge y validate-guess es
//     Node. Con I/O dentro harían falta dos versiones, y dos versiones divergen.
//   · Es un guard sobre partidas en curso. Su garantía no puede ser que alguien
//     lea el if con atención — tiene que ser un test. Mismo criterio que
//     schedule-free.js.
//
// LA TRAMPA QUE HAY QUE CONOCER: las partidas de repesca se guardan en
// `user_guesses` con la MISMA fecha que la diaria y otro car_id, y no hay
// columna que las distinga. Por eso el ancla del logueado no es «su fila de
// hoy» sino «su fila de hoy CUYO car_id sea el vigente o uno de los salientes».
// Sin ese acotado, a quien jugara una repesca se le serviría el coche de la
// repesca como si fuera el del día.

/**
 * @param {object} input
 * @param {string} input.carIdVigente        El coche que dice daily_cars ahora.
 * @param {string[]} [input.prevCarIds]      Salientes de hoy, en orden.
 * @param {{car_id: string}|null} [input.filaUsuario]  Fila de user_guesses de
 *   hoy del usuario logueado (null si es anónimo o no ha jugado).
 * @param {string|null} [input.selloCliente] Sello que trae el cliente.
 * @param {Object<string,string>} [input.sellosPorCarId] carId → sello, ya
 *   calculados por el endpoint (el HMAC es asíncrono; esto es síncrono).
 * @param {number} [input.intentosAnon]      Intentos gastados según el token.
 * @returns {{carId: string, congelado: boolean, cocheCambiado: boolean}}
 *   `congelado` = está jugando una revisión anterior.
 *   `cocheCambiado` = el cliente está mirando una foto que ya no es la de su
 *   partida y debe recargar antes de responder.
 */
export function resolverCocheDelUsuario({
  carIdVigente,
  prevCarIds = [],
  filaUsuario = null,
  selloCliente = null,
  sellosPorCarId = {},
  intentosAnon = 0,
}) {
  const prev = Array.isArray(prevCarIds) ? prevCarIds.filter(Boolean) : [];
  const salida = (carId, congelado, cocheCambiado) => ({ carId, congelado, cocheCambiado });

  // 1. LOGUEADO CON FILA. Manda sobre todo lo demás: es lo único que el
  //    servidor escribió él mismo. Acotado a {vigente} ∪ prev para dejar fuera
  //    las repescas (ver la nota de arriba).
  if (filaUsuario?.car_id) {
    if (prev.includes(filaUsuario.car_id)) {
      // Desempate escrito también en el parche SQL de record_daily_result_v2:
      // si hubiera fila en una revisión anterior Y en la vigente, gana la
      // anterior. Por construcción no puede pasar (el ancla impide que se cree
      // la segunda), pero las dos copias tienen que decir lo mismo.
      return salida(filaUsuario.car_id, true, false);
    }
    if (filaUsuario.car_id === carIdVigente) {
      return salida(carIdVigente, false, false);
    }
    // Ni el vigente ni un saliente → es una repesca. No ancla nada.
  }

  // 2. ANÓNIMO CON PARTIDA EMPEZADA. Su ancla es el sello del token, que va
  //    firmado junto al contador de intentos: no puede quedarse con el coche
  //    viejo Y con cinco intentos nuevos.
  if (selloCliente && intentosAnon > 0) {
    const congelado = prev.find((id) => sellosPorCarId[id] === selloCliente);
    if (congelado) return salida(congelado, true, false);
  }

  // 3. EL RESTO JUEGA EL COCHE VIGENTE. Y si traía un sello que no es el suyo,
  //    está mirando una foto que ya no corresponde: hay que avisarle antes de
  //    que responda, o se le puntuaría un intento sobre el coche equivocado.
  const cocheCambiado = Boolean(
    selloCliente && selloCliente !== sellosPorCarId[carIdVigente]
  );
  return salida(carIdVigente, false, cocheCambiado);
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run api/_lib/coche-de-hoy.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add api/_lib/coche-de-hoy.js api/_lib/coche-de-hoy.test.js
git commit -m "feat(coche-de-hoy): resolvedor puro del coche anclado a cada jugador"
```

---

> **Nota (2026-08-25, tras la revisión adversarial):** el código de esta tarea
> se corrigió después de escribirlo. La firma real recibe `filasUsuario`
> (array), `hayUsuario`, y `cocheCambiado` exige que HAYA salientes y que el
> sello del vigente se conozca. Lo que manda es el fichero
> `api/_lib/coche-de-hoy.js` en la rama, no el bloque de arriba. Las Tareas 6 y
> 8 ya están escritas contra la firma corregida.

## Tarea 4: `version-imagen.js` — el `v` deja de estar escrito a mano

**Files:**
- Create: `api/_lib/version-imagen.js`
- Modify: `api/get-daily-car.js` (donde se calcula `imgVersion`)

El `v` de `/api/daily-image?d=…&v=…` era un cache-buster. Pasa a ser **el
selector de revisión**: la foto la pide un `<img>`, que no manda cabeceras, así
que la URL es lo único que identifica qué coche está viendo ese jugador.

- [ ] **Step 1: Crear el módulo**

```js
// api/_lib/version-imagen.js
// El `v` de /api/daily-image?d=…&v=…
//
// Nació como cache-buster: si el admin reemplaza la foto, cambia image_url,
// cambia el hash y el CDN sirve la nueva al instante. Sigue haciendo eso.
//
// Pero desde el cambio de emergencia hace algo más importante: es lo ÚNICO que
// le dice a daily-image qué revisión del día está mirando quien pide la foto.
// Una etiqueta <img> no manda Authorization ni X-Anon-Session, así que ahí no
// hay usuario que resolver — solo la URL. Como el hash sale del coche, un
// congelado y un jugador nuevo piden URLs distintas y la caché compartida del
// CDN no puede servirle la foto de uno al otro.
//
// Por eso vive aquí y no escrito a mano en cada endpoint: si las dos copias
// divergieran, la del proxy dejaría de reconocer las URLs que emite la otra.

import { sha1Hex } from "./edge/crypto.js";

/**
 * @param {string|null} imageUrl
 * @param {number} zoomBase  Entra en el hash porque cambia el crop servido: si
 *   el admin ajusta la dificultad, la entrada cacheada tiene que invalidarse.
 * @returns {Promise<string>} 8 hex, o "0" si el coche no tiene imagen.
 */
export async function versionDeImagen(imageUrl, zoomBase) {
  if (!imageUrl) return "0";
  return (await sha1Hex(`${imageUrl}:${zoomBase}`)).slice(0, 8);
}
```

- [ ] **Step 2: Usarlo en `get-daily-car.js`**

Sustituye el cálculo en línea (busca `const imgVersion`) por la llamada, y
añade el import junto a los demás de `_lib`:

```js
import { versionDeImagen } from "./_lib/version-imagen.js";
```

```js
  // El hash identifica al coche, y daily-image lo usa para saber qué revisión
  // del día pide quien carga la foto. Ver api/_lib/version-imagen.js.
  const imgVersion = await versionDeImagen(imgRow?.image_url, zoomBase);
  const dailyImgUrl = `/api/daily-image?d=${today}&v=${imgVersion}`;
```

- [ ] **Step 3: Verificar que el bundle sigue compilando**

Run: `npm run build`
Expected: build correcto, sin errores de import.

- [ ] **Step 4: Commit**

```bash
git add api/_lib/version-imagen.js api/get-daily-car.js
git commit -m "refactor(imagen): centralizar el calculo del v del proxy"
```

---

## Tarea 5: El token anónimo aprende a decir con qué coche venía

**Files:**
- Modify: `api/_lib/edge/anon-session.js`
- Modify: `api/_lib/anon-session.js`
- Create: `api/_lib/anon-session.replicas.test.js`

Las dos son **réplicas con el mismo formato de wire**: un token firmado por una
lo verifica la otra. El campo nuevo tiene que entrar en las dos a la vez.

- [ ] **Step 1: Escribir el test que falla**

```js
// api/_lib/anon-session.replicas.test.js
// api/_lib/anon-session.js (Node) y api/_lib/edge/anon-session.js (Edge) son
// réplicas: get-daily-car firma el token en Edge y validate-guess lo verifica
// en Node. Si divergen, el jugador anónimo pierde sus intentos a mitad de
// partida — y el síntoma aparece lejos de la causa.

import { describe, it, expect, beforeAll } from "vitest";
import { signAnonSession as firmarNode, verifyAnonSession as verificarNode } from "./anon-session.js";
import {
  signAnonSession as firmarEdge,
  verifyAnonSession as verificarEdge,
} from "./edge/anon-session.js";

const SESION = { d: "2026-08-25", n: 2, s: "playing", c: "selloDelCoche01" };

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("las dos réplicas hablan el mismo idioma", () => {
  it("lo que firma Edge lo verifica Node, con el sello incluido", async () => {
    const token = await firmarEdge(SESION);
    expect(verificarNode(token)).toEqual(SESION);
  });

  it("lo que firma Node lo verifica Edge, con el sello incluido", async () => {
    const token = firmarNode(SESION);
    expect(await verificarEdge(token)).toEqual(SESION);
  });

  it("un token sin `c` (emitido antes de esto) sigue siendo válido", async () => {
    const viejo = { d: "2026-08-25", n: 1, s: "playing" };
    expect(await verificarEdge(firmarNode(viejo))).toEqual(viejo);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx vitest run api/_lib/anon-session.replicas.test.js`
Expected: FAIL — el token firmado en un runtime no se verifica en el otro, o el
campo `c` no sobrevive.

Si ya pasara sin tocar nada (porque ambas serializan el payload entero), sigue
igualmente al paso 3: hay que documentar el campo en las dos cabeceras para que
nadie lo borre por «no se usa».

- [ ] **Step 3: Documentar `c` en las dos réplicas**

En `api/_lib/edge/anon-session.js`, en la cabecera del fichero:

```js
// El payload es `{d, n, s, c}`:
//   d → día (YYYY-MM-DD)
//   n → intentos gastados
//   s → estado de la partida
//   c → SELLO del coche con el que venía jugando (api/_lib/sello.js). Es lo que
//       permite congelarle la partida si el coche del día se cambia por
//       emergencia: sin él no hay forma de saber si su tablero es de este coche
//       o del anterior. NO es el car_id y no puede serlo — este payload es
//       base64 legible desde el navegador (regla 5).
//   Un token sin `c` (emitido antes de esto) es válido: se trata como «no
//   sabemos», que es el fallo seguro — no se congela a nadie por si acaso.
```

El mismo bloque, palabra por palabra, en la cabecera de
`api/_lib/anon-session.js` (donde hoy dice `Devuelve el payload {d, n, s}`).

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npx vitest run api/_lib/anon-session.replicas.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add api/_lib/anon-session.js api/_lib/edge/anon-session.js api/_lib/anon-session.replicas.test.js
git commit -m "feat(anon-session): el token lleva el sello del coche en juego"
```

---

## Tarea 6: `get-daily-car` — servir a cada uno su coche

**Files:**
- Modify: `api/get-daily-car.js`

- [ ] **Step 1: Cambiar la RPC por la envoltura, con caída al comportamiento actual**

Sustituye la rama `pick_daily_car` del `Promise.all` de FASE 1 por una llamada a
`coche_de_hoy`, y **deja el fallback**: si la RPC no existe todavía o falla, se
usa `pick_daily_car` y `prevCarIds` vacío, que es exactamente lo que hace hoy
(regla 9 — la home no se degrada por una optimización que falta).

```js
    // coche_de_hoy() = pick_daily_car() + los salientes del día, en un solo
    // viaje. Los salientes hacen falta para anclar a quien ya estaba jugando
    // cuando se cambió el coche por emergencia, y leerlos aparte añadiría un
    // round-trip al único request bloqueante del primer paint.
    //
    // Con reintento: sin coche del día no hay juego. La RPC es idempotente
    // (fija el coche de la fecha y después lo devuelve), así que repetirla no
    // tiene efectos.
    conTimeoutReintentando(
      () => supabaseAdmin.rpc("coche_de_hoy", { p_date: today }),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "coche_de_hoy sin respuesta a tiempo" } },
      { etiqueta: "coche_de_hoy" }
    ),
```

Y justo después de desestructurar `rpcResult`, antes del `if (rpcErr || !todayCarId)`:

```js
  // `returns table` → PostgREST devuelve un array de filas.
  let todayCarId = rpcResult.data?.[0]?.car_id || null;
  let prevCarIds = rpcResult.data?.[0]?.prev_car_ids || [];
  let rpcErr = rpcResult.error;

  // RESPALDO: si la envoltura no está desplegada en esta base (o falla), se
  // sigue con el sorteo de siempre. El código puede llegar a producción antes
  // que el SQL.
  //
  // Pero los salientes hay que leerlos IGUAL, con un select plano. `[]` no
  // significa «no he podido averiguarlo», significa «hoy no ha habido cambio»:
  // fabricarlo aquí haría que la lectura acotada de user_guesses no viera la
  // fila de un congelado y le sirviéramos tablero nuevo con cinco intentos —
  // justo la rejugada que todo esto existe para impedir. Si tampoco se puede
  // leer, se cae al 503 de abajo: un error honesto hace mucho menos daño que
  // un estado inventado (regla 21).
  if (rpcErr || !todayCarId) {
    console.error("[get-daily-car] coche_de_hoy:", rpcErr);
    const [respaldo, salientes] = await Promise.all([
      conTimeoutReintentando(
        () => supabaseAdmin.rpc("pick_daily_car", { p_date: today }),
        PLAZOS.SUPABASE,
        { data: null, error: { message: "pick_daily_car sin respuesta a tiempo" } },
        { etiqueta: "pick_daily_car (respaldo)" }
      ),
      conTimeoutOFallback(
        supabaseAdmin
          .from("daily_cars")
          .select("prev_car_ids")
          .eq("date", today)
          .maybeSingle(),
        PLAZOS.SUPABASE,
        { data: null, error: { message: "prev_car_ids sin respuesta a tiempo" } },
        { etiqueta: "read prev_car_ids" }
      ),
    ]);
    todayCarId = respaldo.data || null;
    rpcErr = respaldo.error;
    if (salientes.error) {
      // No sabemos si hoy hubo cambio. Antes que arriesgarnos a vaciarle el
      // tablero a alguien, 503.
      console.error("[get-daily-car] read prev_car_ids:", salientes.error);
      return respond(
        { message: "Game state temporarily unavailable" },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    prevCarIds = salientes.data?.prev_car_ids || [];
  }
```

El `if (rpcErr || !todayCarId)` que ya existe (el que responde 503) se queda
donde está, detrás de esto.

- [ ] **Step 2: Anclar al usuario antes de leer su partida**

La lectura de `user_guesses` de FASE 2 filtra hoy por `car_id`. Como el coche
que le toca depende de su propia fila, se pasa a leer por fecha **acotando a
`{vigente} ∪ prev`** — así una repesca del mismo día no se cuela:

```js
      ? conTimeoutReintentando(
          () =>
            authClient
              .from("user_guesses")
              .select("car_id, guesses, status")
              .eq("user_id", user.id)
              .eq("date", today)
              // Acotado a las revisiones del día: sin esto entraría también la
              // partida de REPESCA de hoy, que vive en esta misma tabla con la
              // misma fecha y otro car_id.
              .in("car_id", [todayCarId, ...prevCarIds]),
          PLAZOS.SUPABASE,
          { data: null, error: { message: "read user_guesses sin respuesta a tiempo" } },
          { etiqueta: "read user_guesses" }
        )
```

Sin `.limit(1)` **a propósito**: si el usuario tuviera fila en el coche vigente
y en un saliente, quién gana es una decisión de negocio (gana el saliente: es la
partida que está jugando) y la toma el resolvedor, que es donde está escrita y
probada. Un `limit(1)` sin `order` se la dejaría a Postgres.

La respuesta es un **array**. Donde hoy se usa `gameRow`, ahora:

```js
  const filasUsuario = Array.isArray(gameResult.data) ? gameResult.data : [];
```

y el `gameRow` que alimenta `status`/`guesses` pasa a ser la fila del coche ya
resuelto:

```js
  const gameRow = filasUsuario.find((f) => f.car_id === carIdDelUsuario) || null;
```

- [ ] **Step 3: Resolver el coche y sellar la respuesta**

Después de tener `gameRow` y el token anónimo entrante, y **antes** de leer la
imagen (porque la imagen depende del coche resuelto):

```js
  // ¿Qué coche le toca a QUIEN PREGUNTA? Puede no ser el vigente: si hubo
  // cambio de emergencia, quien ya estaba jugando se queda con el suyo.
  // El token anónimo SOLO cuenta si no hay sesión y si es de HOY. El cliente
  // manda la cabecera X-Anon-Session esté logueado o no, y nada la borra al
  // registrarse: sin estos dos filtros, quien jugó anónimo y luego se hizo
  // cuenta arrastraría para siempre un sello rancio que no casa con nada.
  const anonVigente =
    !user && tokenAnonEntrante?.d === today ? tokenAnonEntrante : null;

  const sellosPorCarId = await sellosDe([todayCarId, ...prevCarIds], today);
  const { carId: carIdDelUsuario } = resolverCocheDelUsuario({
    carIdVigente: todayCarId,
    prevCarIds,
    filasUsuario,
    hayUsuario: Boolean(user),
    selloCliente: anonVigente?.c || null,
    sellosPorCarId,
    intentosAnon: Number.isInteger(anonVigente?.n) ? anonVigente.n : 0,
  });
```

Imports nuevos:

```js
import { resolverCocheDelUsuario } from "./_lib/coche-de-hoy.js";
import { sellosDe } from "./_lib/sello.js";
```

A partir de aquí, **todo lo que hoy usa `todayCarId` pasa a usar
`carIdDelUsuario`**: la lectura de `cars` (image_url, blur_data, zoom_base), el
`logSessionStart`, la lectura del reveal y la firma del `revealToken`.

`sellosPorCarId[carIdDelUsuario]` se añade a `base` como `sello`, y al token
anónimo como `c`:

```js
  const base = {
    date: today,
    img: dailyImgUrl,
    blurData,
    zoomBase,
    maxAttempts: MAX_ATTEMPTS,
    guesses: [],
    status: "playing",
    reveal: null,
    // Sello del coche que ESTE jugador tiene delante. Lo reenvía en
    // validate-guess para que el servidor detecte si está respondiendo sobre
    // una foto que ya no es la de su partida. Opaco: no dice qué coche es.
    sello: sellosPorCarId[carIdDelUsuario] || null,
  };
```

Y en la rama anónima, la sesión que se firma:

```js
    const session = valid
      ? { ...incoming, c: sellosPorCarId[carIdDelUsuario] || incoming.c || null }
      : { d: today, n: 0, s: "playing", c: sellosPorCarId[carIdDelUsuario] || null };
```

Nota: `readAnonTokenFromRequest` se llama hoy dentro de la rama anónima. Súbelo
a antes del resolvedor (guardándolo en `tokenAnonEntrante`) y reutilízalo allí,
en vez de leer el header dos veces.

- [ ] **Step 4: Comprobar que la cadena de plazos sigue cabiendo en el Edge**

Run: `npx vitest run api/_lib/timeout.test.js`
Expected: PASS. Ese test suma la cadena entera de `get-daily-car` y falla si se
pasa de los 25 s del runtime Edge (regla 21). Si el test nombra
`pick_daily_car` por etiqueta, actualízalo a `coche_de_hoy` — es la misma
llamada con otro nombre, no un plazo nuevo.

- [ ] **Step 5: Suite completa y build**

Run: `npm run test:unit && npm run build`
Expected: PASS y build correcto.

- [ ] **Step 6: Commit**

```bash
git add api/get-daily-car.js api/_lib/timeout.test.js
git commit -m "feat(get-daily-car): servir a cada jugador el coche al que esta anclado"
```

---

## Tarea 7: `daily-image` — el `v` decide qué foto sale

**Files:**
- Modify: `api/daily-image.js`

- [ ] **Step 1: Resolver el coche por el `v` de la URL**

Sustituye el bloque que llama a `pick_daily_car` (y la lectura de `cars` que
viene detrás) por la envoltura más la resolución por `v`:

```js
  // Qué coche sirve esta petición. Normalmente el vigente — pero si hubo un
  // cambio de emergencia, quien estaba jugando sigue pidiendo la foto del suyo,
  // y hay que dársela o vería el coche nuevo con su tablero viejo.
  //
  // Aquí NO se puede usar el resolvedor de _lib/coche-de-hoy.js: la foto la
  // pide una etiqueta <img>, que no manda Authorization ni X-Anon-Session. Lo
  // único que identifica la revisión es el `v` de la URL, que es un hash del
  // coche (api/_lib/version-imagen.js). Como el hash sale del coche, cada
  // revisión tiene su propia URL y la caché del CDN no puede cruzar las fotos.
  const { data: filas, error: rpcErr } = await supabaseAdmin.rpc("coche_de_hoy", {
    p_date: today,
  });
  let carId = filas?.[0]?.car_id || null;
  const prevCarIds = filas?.[0]?.prev_car_ids || [];

  if (rpcErr || !carId) {
    // Respaldo: sin la envoltura desplegada se sirve el coche vigente y ya.
    console.error("[daily-image] coche_de_hoy:", rpcErr);
    const { data: respaldo, error: respErr } = await supabaseAdmin.rpc(
      "pick_daily_car",
      { p_date: today }
    );
    if (respErr || !respaldo) {
      console.error("[daily-image] pick_daily_car:", respErr);
      return res.status(503).json({ message: "No daily car" });
    }
    carId = respaldo;
  }

  const vPedido = typeof req.query?.v === "string" ? req.query.v : null;

  // Lectura de los candidatos: el vigente y, si hubo cambio hoy, los salientes.
  // En un día normal `prevCarIds` está vacío y esto es la misma consulta de
  // siempre con un `in` de un elemento.
  const { data: filasCars, error: carsErr } = await supabaseAdmin
    .from("cars")
    .select("id, image_url, zoom_base, focus_x, focus_y")
    .in("id", [carId, ...prevCarIds]);
  if (carsErr || !filasCars?.length) {
    console.error("[daily-image] read cars:", carsErr);
    return res.status(503).json({ message: "No daily car" });
  }

  let carRow = filasCars.find((c) => c.id === carId);

  // ¿El `v` que pide es el de una revisión anterior? Entonces esa es su foto.
  if (vPedido && prevCarIds.length > 0) {
    for (const candidata of filasCars) {
      const v = await versionDeImagen(
        candidata.image_url,
        clampZoomBase(candidata.zoom_base)
      );
      if (v === vPedido) {
        carRow = candidata;
        carId = candidata.id;
        break;
      }
    }
  }
```

Import nuevo: `import { versionDeImagen } from "./_lib/version-imagen.js";`

**Importante:** el `select` de `cars` de arriba debe pedir **las mismas columnas
que pedía el código que sustituyes** (mira el fichero: puede incluir `focus_x`,
`focus_y`, `blur_data`…). No quites ninguna.

Un `v` que no case con nada (una foto reemplazada por el admin, una caché vieja)
cae en el vigente: es el comportamiento de siempre.

- [ ] **Step 2: Pasar el coche resuelto al gate del reveal**

`tryReadUserStatus(req, carId, today)` ya recibe el `carId`; al resolverse antes,
recibe el correcto sin tocar la función. Verifica que la llamada usa la variable
`carId` **posterior** a la resolución por `v`, no una copia anterior.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 4: Commit**

```bash
git add api/daily-image.js
git commit -m "feat(daily-image): el v de la URL selecciona la revision del dia"
```

---

## Tarea 8: `validate-guess` — validar contra el coche correcto, y avisar si no

**Files:**
- Modify: `api/validate-guess.js`

- [ ] **Step 1: Resolver el coche antes de cargar la ficha real**

Sustituye el bloque «3. Coche del día (resuelto en servidor)» por esto:

```js
    // -------- 3. Coche del día (resuelto en servidor) --------------------
    // coche_de_hoy() = pick_daily_car() + los salientes del día. Los salientes
    // hacen falta para saber si este jugador está anclado a una revisión
    // anterior (cambio de emergencia del coche del día).
    const { data: filasDia, error: pickErr } = await supabaseAdmin.rpc(
      "coche_de_hoy",
      { p_date: today }
    );
    let carIdVigente = filasDia?.[0]?.car_id || null;
    let prevCarIds = filasDia?.[0]?.prev_car_ids || [];

    if (pickErr || !carIdVigente) {
      // RESPALDO: sin la envoltura desplegada se juega el coche de siempre.
      // Los salientes se leen IGUAL con un select plano: `[]` significa «hoy no
      // hubo cambio», no «no lo sé». Inventarlo aquí haría que a un congelado
      // se le validara el intento contra el coche que no es.
      console.error("[validate-guess] coche_de_hoy:", pickErr);
      const { data: respaldo, error: respErr } = await supabaseAdmin.rpc(
        "pick_daily_car",
        { p_date: today }
      );
      if (respErr || !respaldo) {
        console.error("[validate-guess] pick_daily_car:", respErr);
        return res.status(500).json({ error: "Failed to resolve daily car" });
      }
      const { data: fila, error: filaErr } = await supabaseAdmin
        .from("daily_cars")
        .select("prev_car_ids")
        .eq("date", today)
        .maybeSingle();
      if (filaErr) {
        console.error("[validate-guess] read prev_car_ids:", filaErr);
        return res.status(503).json({ error: "Game state temporarily unavailable" });
      }
      carIdVigente = respaldo;
      prevCarIds = fila?.prev_car_ids || [];
    }
```

Y **antes** de `fetchCarById`, resuelve a quién le toca qué:

```js
    // La partida de un anónimo va en su token firmado; la de un logueado, en su
    // fila. Los dos hay que leerlos ANTES de decidir contra qué coche se valida
    // este intento, porque puede no ser el vigente.
    // El token anónimo SOLO cuenta sin sesión y si es de HOY (ver la nota del
    // mismo bloque en get-daily-car: la cabecera viaja siempre y nadie la borra
    // al registrarse). Un logueado manda su sello por el body, que es el que le
    // acaba de dar get-daily-car.
    const anonBruto = readAnonToken(req);
    const anonEntrante = !user && anonBruto?.d === today ? anonBruto : null;
    const selloCliente =
      anonEntrante?.c ||
      (typeof req.body?.sello === "string" ? req.body.sello : null);

    let filasUsuario = [];
    if (user) {
      const { data: filas, error: filaErr } = await authClient
        .from("user_guesses")
        .select("car_id, guesses, status")
        .eq("user_id", user.id)
        .eq("date", today)
        // Acotado a las revisiones del día: la partida de REPESCA de hoy vive
        // en esta misma tabla, con esta misma fecha y otro car_id.
        .in("car_id", [carIdVigente, ...prevCarIds]);
      if (filaErr) {
        console.error("[validate-guess] read user_guesses:", filaErr);
        return res.status(500).json({ error: "Failed to read attempts" });
      }
      // Sin `.limit(1)`: si hubiera fila en el vigente y en un saliente, el
      // desempate es del resolvedor, no de Postgres.
      filasUsuario = Array.isArray(filas) ? filas : [];
    }

    const sellosPorCarId = await sellosDe([carIdVigente, ...prevCarIds], today);
    const { carId: todayCarId, cocheCambiado } = resolverCocheDelUsuario({
      carIdVigente,
      prevCarIds,
      filasUsuario,
      hayUsuario: Boolean(user),
      selloCliente,
      sellosPorCarId,
      intentosAnon: Number.isInteger(anonEntrante?.n) ? anonEntrante.n : 0,
    });

    // El jugador está respondiendo sobre una foto que ya no es la de su
    // partida: el coche del día se cambió mientras tenía la pestaña abierta.
    // 409 y SIN gastar intento — puntuarle esto contra el coche nuevo sería
    // cobrarle un fallo que no ha cometido.
    if (cocheCambiado) {
      return res.status(409).json({
        error: "coche_cambiado",
        message: "El coche de hoy ha cambiado. Recarga para seguir jugando.",
      });
    }
```

Imports nuevos:

```js
import { resolverCocheDelUsuario } from "./_lib/coche-de-hoy.js";
import { sellosDe } from "./_lib/sello.js";
```

- [ ] **Step 2: Reutilizar la fila ya leída**

El bloque «5. attemptNumber AUTORITATIVO» vuelve a leer `user_guesses` filtrando
por `car_id`. Esa segunda lectura sobra: usa la fila del coche ya resuelto.

```js
      // Ya las leímos arriba para resolver el coche: no hace falta ir dos veces.
      // Y es la fila DEL COCHE RESUELTO, no una cualquiera: un congelado tiene
      // la suya en el saliente.
      const filaUsuario =
        filasUsuario.find((f) => f.car_id === todayCarId) || null;
      if (filaUsuario?.status === "won" || filaUsuario?.status === "lost") {
        return res.status(403).json({ error: "Game already finished" });
      }
      existingGuesses = Array.isArray(filaUsuario?.guesses) ? filaUsuario.guesses : [];
```

El `upsert` posterior no cambia: sigue escribiendo con `car_id: todayCarId`, que
ahora es el coche anclado del usuario — por eso un congelado sigue engordando
**su** fila en vez de crear una nueva.

- [ ] **Step 3: Devolver el sello renovado**

Donde se firma el token anónimo de vuelta:

```js
        anonToken = signAnonSession({
          d: today,
          n: attemptNumber,
          s: newStatus,
          // Se reafirma el sello del coche que está jugando: si es un congelado,
          // su token sigue diciendo «vengo del coche anterior» en el siguiente
          // intento.
          c: sellosPorCarId[todayCarId] || null,
        });
```

Y en el cuerpo de la respuesta, junto a `anonToken`, `sello: sellosPorCarId[todayCarId] || null`.

- [ ] **Step 4: Suites de seguridad**

Run: `npm run test:unit && npm run test:security && npm run test:attacks`
Expected: PASS. `test:attacks` cubre justo lo que aquí se toca (contador de
intentos server-side, partida terminada, sesión anónima).

- [ ] **Step 5: Commit**

```bash
git add api/validate-guess.js
git commit -m "feat(validate-guess): validar contra el coche anclado y avisar del cambio"
```

---

## Tarea 9: El panel — el botón, la puerta cerrada y el aviso

**Files:**
- Modify: `api/_lib/schedule-free.js`
- Modify: `api/_lib/schedule-free.test.js`
- Modify: `lib/admin-handlers/schedule.js` (`handlePost`)
- Create: `lib/admin-handlers/emergency-swap.js`
- Modify: `api/admin/[...slug].js`
- Create: `src/admin/EmergencySwapModal.jsx`
- Modify: `src/admin/SchedulePanel.jsx`

- [ ] **Step 1: Escribir el test del guard que falla**

En `api/_lib/schedule-free.test.js`, añade:

```js
describe("validateSwapDate — a hoy solo se llega por la puerta de emergencia", () => {
  it("hoy se rechaza con 409 y dice por dónde se pasa", () => {
    const r = validateSwapDate({ date: TODAY, today: TODAY, maxDate: MAX });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error).toContain("emergencia");
  });

  it("el pasado se rechaza", () => {
    const r = validateSwapDate({ date: "2026-07-25", today: TODAY, maxDate: MAX });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
  });

  it("mañana se acepta", () => {
    const r = validateSwapDate({ date: "2026-07-27", today: TODAY, maxDate: MAX });
    expect(r).toEqual({ ok: true, date: "2026-07-27" });
  });

  it("más allá de la ventana visible se rechaza con 400", () => {
    const r = validateSwapDate({ date: "2026-09-01", today: TODAY, maxDate: MAX });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
});
```

Añade `validateSwapDate` al import del principio del fichero.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npx vitest run api/_lib/schedule-free.test.js`
Expected: FAIL — `validateSwapDate is not a function`

- [ ] **Step 3: Implementar el guard**

En `api/_lib/schedule-free.js`:

```js
/**
 * ¿Se puede ASIGNAR un coche a esta fecha desde el calendario?
 *
 * Igual que validateFreeDate pero para el swap normal, y con una diferencia
 * que importa: HOY se rechaza. Hasta ahora el POST del calendario aceptaba hoy
 * y lo único que lo impedía era un botón deshabilitado en la UI — es decir, la
 * cerradura era de cortesía. Cambiar el coche de hoy tiene consecuencias que el
 * swap normal no sabe manejar (hay partidas en curso), así que se hace por su
 * propia puerta, que avisa de lo que va a pasar y guarda el saliente.
 */
export function validateSwapDate({ date, today, maxDate }) {
  const value = typeof date === "string" ? date.trim() : "";

  if (!FREE_DATE_RE.test(value)) {
    return { ok: false, status: 400, error: "Invalid date (expected YYYY-MM-DD)" };
  }
  if (value === today) {
    return {
      ok: false,
      status: 409,
      error: "El coche de hoy ya está en juego: usa el cambio de emergencia.",
    };
  }
  if (value < today) {
    return {
      ok: false,
      status: 409,
      error: "No se puede reasignar un día pasado: es el histórico del juego.",
    };
  }
  if (value > maxDate) {
    return {
      ok: false,
      status: 400,
      error: `Solo se pueden asignar fechas posteriores a hoy y hasta ${maxDate}.`,
    };
  }
  return { ok: true, date: value };
}
```

- [ ] **Step 4: Usarlo en `handlePost`**

En `lib/admin-handlers/schedule.js`, sustituye la comprobación de rango
(`if (targetDate < today || targetDate > maxDate)`) por:

```js
  const check = validateSwapDate({ date: targetDate, today, maxDate });
  if (!check.ok) {
    return res.status(check.status).json({ error: check.error });
  }
```

Y añade `validateSwapDate` al import de `schedule-free.js` que ya existe.

**Cuidado:** más abajo hay una rama `if (existing.date === today)` que devuelve
409 «Este coche es el de hoy. No se puede mover.». Se queda: protege otra cosa
(mover el coche que hoy está en juego a otro día).

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npx vitest run api/_lib/schedule-free.test.js`
Expected: PASS

- [ ] **Step 6: Commit del guard**

```bash
git add api/_lib/schedule-free.js api/_lib/schedule-free.test.js lib/admin-handlers/schedule.js
git commit -m "fix(admin): a hoy no se llega por el swap normal, solo por emergencia"
```

- [ ] **Step 7: Escribir el handler de emergencia**

```js
// lib/admin-handlers/emergency-swap.js
// Cambio de emergencia del coche del día: sustituir el coche de HOY con la
// jornada ya empezada.
//
// Por qué tiene endpoint propio y no es un flag del POST del calendario: el
// swap normal reemplaza una asignación que nadie ha jugado. Este tiene que
// preservar las partidas en curso, así que guarda el coche saliente en
// daily_cars.prev_car_ids — de ahí sale el «quien ya jugaba se queda con el
// suyo» que implementa api/_lib/coche-de-hoy.js. Un camino distinto para una
// acción distinta, y explícito: a hoy no se llega por descuido.
//
// GET  → { today, car, jugadores: { logueados, anonimos } }
//        El recuento es para el modal: enseñar a cuánta gente afecta ANTES de
//        pulsar. Si falla, se devuelve null y el panel lo dice — un número
//        inventado sería peor que ninguno.
// POST → { car_id }  Cambia el coche y devuelve { car, prevCarIds }.
//
// Seguridad: requireAdmin (whitelist por email). Toda la mutación con
// service_role; daily_cars está revocada para anon/authenticated.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shapeCar(row) {
  if (!row) return null;
  return {
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
    image_url: row.image_url ?? null,
  };
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/emergency-swap] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    return req.method === "GET" ? handleGet(req, res) : handlePost(req, res);
  } catch (err) {
    console.error("[admin/emergency-swap] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// Lee la fila de hoy. Devuelve null si no existe (nadie ha abierto el juego).
async function filaDeHoy(today) {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("date, car_id, prev_car_ids")
    .eq("date", today)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function handleGet(req, res) {
  const today = todayInMadrid();
  const fila = await filaDeHoy(today);

  if (!fila) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ today, car: null, jugadores: null });
  }

  const { data: carRow } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, image_url")
    .eq("id", fila.car_id)
    .maybeSingle();

  // Recuento: a cuánta gente le va a afectar esto. Los logueados salen exactos
  // de user_guesses; los anónimos, aproximados de guess_audit (una fila por
  // sesión del día). Si cualquiera de las dos falla se devuelve null en vez de
  // un número a medias: el modal prefiere decir «no se pudo contar».
  let logueados = null;
  let anonimos = null;

  const { count: cLog, error: eLog } = await getSupabaseAdmin()
    .from("user_guesses")
    .select("user_id", { count: "exact", head: true })
    .eq("date", today)
    .eq("car_id", fila.car_id);
  if (!eLog) logueados = cLog ?? 0;
  else console.error("[admin/emergency-swap] contar logueados:", eLog);

  const { count: cAnon, error: eAnon } = await getSupabaseAdmin()
    .from("guess_audit")
    .select("user_id", { count: "exact", head: true })
    .eq("game_date", today)
    .eq("mode", "session_start")
    .eq("is_anon", true);
  if (!eAnon) anonimos = cAnon ?? 0;
  else console.error("[admin/emergency-swap] contar anonimos:", eAnon);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    today,
    car: shapeCar(carRow),
    prevCarIds: fila.prev_car_ids || [],
    jugadores: { logueados, anonimos },
  });
}

async function handlePost(req, res) {
  const body = parseBody(req) || {};
  const carId = typeof body.car_id === "string" ? body.car_id.trim() : "";
  const today = todayInMadrid();

  if (!UUID_RE.test(carId)) {
    return res.status(400).json({ error: "Invalid car_id" });
  }

  const fila = await filaDeHoy(today);
  if (!fila) {
    return res.status(409).json({
      error: "Hoy no tiene coche asignado todavía: no hay nada que cambiar.",
    });
  }
  if (fila.car_id === carId) {
    return res.status(409).json({ error: "Ese ya es el coche de hoy." });
  }

  const { data: car, error: carErr } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, image_url, image_ready")
    .eq("id", carId)
    .maybeSingle();
  if (carErr) {
    console.error("[admin/emergency-swap] read car:", carErr);
    return res.status(500).json({ error: "Failed to read car" });
  }
  if (!car) return res.status(404).json({ error: "Car not found" });

  // Un coche sin foto deja la jornada injugable para todo el mundo: no hay
  // imagen que servir. En una emergencia es justo el error que no te puedes
  // permitir cometer con prisa.
  if (car.image_ready === false || !car.image_url) {
    return res.status(409).json({
      error: "Ese coche no tiene foto lista: dejaría la jornada injugable.",
    });
  }

  // ¿Ya salió, o está programado? Un coche con fila en daily_cars no puede
  // repetirse: mismo criterio que el swap del calendario.
  const { data: existente, error: exErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("date")
    .eq("car_id", carId)
    .maybeSingle();
  if (exErr) {
    console.error("[admin/emergency-swap] read existing:", exErr);
    return res.status(500).json({ error: "Failed to check existing" });
  }
  if (existente) {
    if (existente.date < today) {
      return res.status(409).json({
        error: `Este coche ya fue coche del día (${existente.date}). No se puede reutilizar.`,
      });
    }
    // Programado en el futuro: se libera esa fecha, como hace el swap normal.
    const { error: delErr } = await getSupabaseAdmin()
      .from("daily_cars")
      .delete()
      .eq("date", existente.date);
    if (delErr) {
      console.error("[admin/emergency-swap] free future date:", delErr);
      return res.status(500).json({ error: "Failed to free old date" });
    }
  }

  // El UPDATE lleva el coche saliente en el WHERE: si otra pestaña ha cambiado
  // el coche mientras este modal estaba abierto, no se pisa en silencio — se
  // devuelve 409 y el admin vuelve a mirar. Es lo que en el resto del panel
  // sería un upsert ciego.
  const prev = [...(fila.prev_car_ids || []), fila.car_id];
  const { data: actualizada, error: upErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .update({ car_id: carId, prev_car_ids: prev })
    .eq("date", today)
    .eq("car_id", fila.car_id)
    .select("date");
  if (upErr) {
    console.error("[admin/emergency-swap] update:", upErr);
    return res.status(500).json({ error: "Failed to swap" });
  }
  if (!actualizada?.length) {
    return res.status(409).json({
      error: "El coche de hoy ha cambiado mientras tenías esto abierto. Vuelve a mirar.",
    });
  }

  console.warn(
    `[admin/emergency-swap] coche del día ${today} cambiado; revisión ${prev.length}`
  );

  // El preload de la home apunta a la foto del coche que acaba de salir: sin
  // esto, cada visitante nuevo se descargaría una imagen que ya no va a ver.
  // Best-effort y en silencio (regla 9): si Edge Config no está configurado o
  // falla, la home carga igual, solo sin la optimización. El cron de warm-daily
  // lo reescribirá de madrugada de todos modos.
  try {
    const v = await versionDeImagen(car.image_url, clampZoomBase(car.zoom_base));
    const ec = await writeEdgeConfig("daily_preload", {
      date: today,
      img: `/api/daily-image?d=${today}&v=${v}`,
    });
    if (ec?.skipped) console.warn("[admin/emergency-swap] edge config:", ec.reason);
  } catch (err) {
    console.error("[admin/emergency-swap] edge config:", err?.message || err);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ date: today, car: shapeCar(car), revision: prev.length });
}
```

Imports que faltan arriba del handler, y **una columna más** en el `select` de
`cars` (`zoom_base`, que entra en el hash de la imagen):

```js
import { versionDeImagen } from "../../api/_lib/version-imagen.js";
import { clampZoomBase } from "../../api/_lib/zoom.js";
import { writeEdgeConfig } from "../../api/_lib/cron/warm-daily.js";
```

`writeEdgeConfig` hoy **no está exportada**: añádele el `export` en
`api/_lib/cron/warm-daily.js`. Es la misma función que usa el cron, y usar la
misma es justo el punto — dos escrituras distintas al mismo `daily_preload`
acabarían con formatos distintos.

- [ ] **Step 8: Enrutar el handler**

En `api/admin/[...slug].js`:

```js
import emergencySwap from "../../lib/admin-handlers/emergency-swap.js";
```

y en `ROUTES`, junto a `"schedule": schedule`:

```js
  "emergency-swap": emergencySwap,
```

No hace falta tocar `PLAZO_MS`: son lecturas y escrituras cortas a Supabase, así
que le vale el `_default` de 15 s.

- [ ] **Step 9: Escribir el modal**

```jsx
// src/admin/EmergencySwapModal.jsx
// Confirmación del cambio de emergencia del coche del día.
//
// Es un modal aparte del SwapCarModal del calendario a propósito: aquel cambia
// una asignación que nadie ha jugado, y este toca una jornada EN CURSO. Lo que
// justifica la pantalla extra es enseñar a cuánta gente afecta antes de pulsar,
// porque es lo único que no se puede deshacer después.

import { useEffect, useMemo, useState } from "react";
import ModalShell from "../components/ModalShell";
import CloseButton from "../components/CloseButton";
import { supabase } from "../supabaseClient";
import { useFreshCatalog } from "../data/catalog";

export default function EmergencySwapModal({ open, onClose, onSwapped }) {
  const { data: catalog, reload: reloadCatalog } = useFreshCatalog();
  const CARS = catalog?.cars ?? [];

  const [info, setInfo] = useState(null);
  const [query, setQuery] = useState("");
  const [elegido, setElegido] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setElegido(null);
      setError(null);
      setEnviando(false);
      return;
    }
    reloadCatalog().catch(() => {});
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/admin/emergency-swap", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setInfo(await res.json());
      } catch (err) {
        console.error("[EmergencySwapModal] info:", err);
        setInfo(null);
      }
    })();
  }, [open]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...CARS].sort((a, b) =>
      `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`)
    );
    if (!q) return base;
    return base.filter((c) =>
      `${c.marca} ${c.modelo} ${c.anio}`.toLowerCase().includes(q)
    );
  }, [CARS, query]);

  async function confirmar() {
    if (!elegido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");
      const res = await fetch("/api/admin/emergency-swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ car_id: elegido.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (typeof onSwapped === "function") onSwapped(body.car);
      onClose();
    } catch (err) {
      console.error("[EmergencySwapModal] swap:", err);
      setError(err?.message || "No se pudo cambiar el coche.");
    } finally {
      setEnviando(false);
    }
  }

  const jugadores = info?.jugadores;
  const recuento =
    jugadores && (jugadores.logueados !== null || jugadores.anonimos !== null)
      ? `${jugadores.logueados ?? "?"} con cuenta y ${jugadores.anonimos ?? "?"} anónimos`
      : "no se pudo contar";

  return (
    <ModalShell
      open={open}
      onClose={enviando ? undefined : onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4"
      panelClassName="relative flex w-full max-w-md max-h-[90vh] flex-col border border-border bg-bg-primary"
    >
      <div className="absolute right-2 top-2 z-10">
        <CloseButton onClick={onClose} disabled={enviando} />
      </div>

      <header className="border-b border-border px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-rojo">
          Cambio de emergencia
        </p>
        <h2 className="mt-1 font-display text-xl tracking-widest text-white">
          El coche de hoy
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Hoy hay <span className="text-white">{recuento}</span> jugando.
          Quien ya haya empezado <span className="text-white">seguirá con el
          coche actual</span> hasta medianoche: no se le corta la partida ni
          puede volver a jugar. El coche que sale vuelve al bombo y aparecerá
          otro día.
        </p>
      </header>

      {!elegido ? (
        <>
          <div className="border-b border-border px-5 py-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar marca, modelo o año..."
              className="h-10 w-full border border-border bg-black/40 px-3 text-sm text-white outline-none placeholder:text-muted focus:border-rojo"
            />
          </div>
          <ul className="flex-1 overflow-y-auto px-3 py-2">
            {filtrados.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setElegido(c)}
                  className="w-full px-2 py-2.5 text-left text-sm text-white transition hover:bg-white/5"
                >
                  {c.marca} {c.modelo}{" "}
                  <span className="text-muted tabular-nums">{c.anio}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex-1 px-5 py-6">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">
            Vas a poner como coche de hoy
          </p>
          <p className="mt-2 font-display text-lg text-white">
            {elegido.marca} {elegido.modelo}{" "}
            <span className="tabular-nums text-muted">{elegido.anio}</span>
          </p>
          {error && <p className="mt-4 text-sm text-rojo">{error}</p>}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setElegido(null)}
              disabled={enviando}
              className="flex-1 border border-border px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-white transition hover:bg-white/5 disabled:opacity-40"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className="flex-1 border border-rojo bg-rojo/10 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-rojo transition hover:bg-rojo/20 disabled:opacity-40"
            >
              {enviando ? "Cambiando..." : "Cambiar ahora"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
```

- [ ] **Step 10: Enganchar el botón en la fila de hoy**

En `src/admin/SchedulePanel.jsx`, el botón «Cambiar coche» tiene hoy
`disabled={item.isToday}`. Para la fila de hoy se pinta **otro** botón:

```jsx
                {item.isToday ? (
                  <button
                    type="button"
                    onClick={() => setEmergenciaAbierta(true)}
                    className="
                      flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-rojo
                      transition hover:bg-rojo/10
                    "
                    title="Sustituir el coche de hoy con la jornada empezada"
                  >
                    Cambio de emergencia
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      typeof onSwapCar === "function" &&
                      onSwapCar(item.date, item.car?.id || null)
                    }
                    className="
                      flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-accent
                      transition hover:bg-accent/10
                    "
                  >
                    Cambiar coche
                  </button>
                )}
```

Añade el estado `const [emergenciaAbierta, setEmergenciaAbierta] = useState(false);`
y monta el modal al final del componente, recargando el calendario al terminar:

```jsx
      <EmergencySwapModal
        open={emergenciaAbierta}
        onClose={() => setEmergenciaAbierta(false)}
        onSwapped={() => setLocalRefresh((prev) => prev + 1)}
      />
```

`setLocalRefresh` es el contador que ya usa el panel para repintarse tras
aleatorizar o liberar: incrementarlo vuelve a disparar el `useEffect` que lee
`/api/admin/schedule`.

El botón «Liberar» de la fila de hoy **se queda deshabilitado**: liberar sigue
sin poder tocar hoy (borraría la fila y con ella los salientes).

- [ ] **Step 11: R2 — que el anti-trampas no confunda a los congelados con repescas**

`lib/admin-handlers/audit.js` aísla las partidas diarias comparando el `car_id`
con el coche del día: `if (dailyByDate.get(r.date) !== r.car_id) continue;`.
Tras un cambio de emergencia, las partidas congeladas de ese día llevan el
`car_id` viejo y se descartarían como si fueran repescas — el ranking de
sospecha perdería ese día.

Cambia el mapa para que guarde **todos** los coches que fueron el del día:

```js
    // Un día con cambio de emergencia tiene más de un coche (daily_cars.car_id
    // es el vigente, prev_car_ids son los salientes). Las partidas de los
    // jugadores que se quedaron congelados llevan el car_id viejo y son
    // DIARIAS: sin esto se descartarían como repescas y ese día desaparecería
    // del ranking de sospecha.
    let dq = admin.from("daily_cars").select("date, car_id, prev_car_ids");
```

y donde se construye `dailyByDate`, guarda un `Set` por fecha:

```js
    const dailyByDate = new Map(
      (dailyRows || []).map((d) => [
        d.date,
        new Set([d.car_id, ...(d.prev_car_ids || [])]),
      ])
    );
```

El filtro pasa a ser:

```js
    if (!dailyByDate.get(r.date)?.has(r.car_id)) continue; // descarta repescas
```

Busca **todos** los usos de `dailyByDate` en el fichero antes de dar el cambio
por hecho: si hay más de un sitio que lo compara con `!==`, todos tienen que
pasar a `.has()`.

- [ ] **Step 12: R5 — comprobar qué hace el Garaje con el coche saliente**

Lee `api/garage.js` alrededor de la lectura de `daily_cars` (el bloque «3)
Historial de coches del día»). Confirma estas dos consecuencias y **déjalas
documentadas con un comentario ahí mismo**, sin cambiar el comportamiento:

- El coche saliente pierde su fila en `daily_cars`, así que ese día **no cuenta
  como portada** y no tiene nº de edición. Se cura solo: vuelve al bombo y
  cuando salga de verdad, lo recibe.
- Quien lo **perdió** hoy no puede repescarlo mientras no vuelva a salir, porque
  la repesca solo mira fechas estrictamente pasadas de `daily_cars`.

Comentario a dejar en `api/garage.js`, sobre la lectura de `daily_cars`:

```js
    //    OJO con los cambios de emergencia (api/_lib/coche-de-hoy.js): el coche
    //    saliente pierde su fila aquí, así que ese día no le cuenta como
    //    portada ni le da nº de edición, y quien lo perdió no puede repescarlo
    //    todavía. Es deliberado y se cura solo: el saliente vuelve al bombo, y
    //    cuando salga de verdad recibe su fecha, su número y su repesca.
```

- [ ] **Step 13: Suite completa**

Run: `npm test`
Expected: PASS. Incluye `test:estetica`, que rechaza emoji, paleta cruda de
Tailwind y glows — `src/admin/` está exento, pero el modal usa tokens del tema
igualmente.

- [ ] **Step 14: Build**

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 15: Commit**

```bash
git add lib/admin-handlers/emergency-swap.js api/admin api/_lib/cron/warm-daily.js api/garage.js src/admin
git commit -m "feat(admin): cambio de emergencia del coche del dia"
```

- [ ] **Step 16: Abrir el PR**

```bash
git push -u origin HEAD
gh pr create --title "Cambio de emergencia del coche del día" --body "$(cat <<'EOF'
Permite sustituir el coche del día con la jornada ya empezada, sin que nadie
pueda rejugar y sin cortarle la partida a quien ya estaba jugando.

El día pasa a tener revisiones: quien ya tiene partida se queda con su coche
hasta medianoche, quien no ha empezado ve el nuevo.

**Requiere ejecutar `scripts/2026-08-cambio-emergencia-coche-del-dia.sql` en
Supabase antes de mergear.** Sin el parche de `record_daily_result_v2` que lleva
dentro, un jugador congelado gana y no se le registra ni puntos ni racha.

Diseño: `docs/superpowers/specs/2026-08-25-cambio-emergencia-coche-del-dia-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Tarea 10: El cliente (entrega aparte — viaja en el APK)

**Files:**
- Modify: `src/hooks/useGame.js`
- Modify: `android/app/build.gradle`

Esta tarea toca `src/` fuera de `admin/`, así que llega al APK: va **directa a
`main`** (regla 13) y **con subida de versión** (regla 17). Hazla **después** de
mergear el PR: antes, el servidor todavía no devuelve `sello`.

- [ ] **Step 1: Guardar el sello que devuelve el servidor**

En la carga inicial (donde se hace `setRevealToken(daily.revealToken || null)`):

```js
      // Sello del coche que este jugador tiene delante. Se reenvía en cada
      // intento para que el servidor detecte que está respondiendo sobre una
      // foto que ya no es la de su partida (cambio de emergencia del coche del
      // día) y no le cobre el intento. Opaco: no dice qué coche es.
      const [sello, setSello] = useState(null);
      ...
      setSello(daily.sello || null);
```

(`useState` va con el resto de estados del hook, arriba; aquí se muestra junto
para que se vea qué guarda.)

- [ ] **Step 2: Reenviarlo en cada intento**

```js
    const payload = {
      guessCarId,
      anio,
      attemptNumber: guesses.length + 1,
      sello,
    };
```

Y donde se persiste el token renovado, también el sello:

```js
    if (data?.anonToken) setAnonToken(data.anonToken);
    if (data?.sello) setSello(data.sello);
```

- [ ] **Step 3: Manejar el 409 `coche_cambiado`**

En el bloque `if (!response.ok)`, **antes** del toast genérico:

```js
      // El coche del día se cambió mientras esta pestaña estaba abierta: la
      // foto que hay en pantalla ya no es la de la partida. El intento NO se ha
      // gastado (el servidor cortó antes de puntuarlo), así que se recarga para
      // empezar con el coche correcto.
      if (response.status === 409 && data?.error === "coche_cambiado") {
        toast.push(t("errors.cocheCambiado"), { type: "info" });
        setPendingGuess(null);
        setIsSubmitting(false);
        setTimeout(() => window.location.reload(), 2000);
        return;
      }
```

- [ ] **Step 4: Añadir el texto a los dos idiomas**

En `src/i18n/locales/es.json`, dentro de `errors`:

```json
"cocheCambiado": "El coche de hoy ha cambiado. Recargando..."
```

En `src/i18n/locales/en.json`:

```json
"cocheCambiado": "Today's car has changed. Reloading..."
```

Regla: nada de strings de cara al usuario en el código.

- [ ] **Step 5: Subir la versión de Android**

En `android/app/build.gradle`: `versionCode 53` → `54`, y
`versionName "1.8.4"` → `"1.8.5"` (patch: es un arreglo, no una pantalla nueva).

- [ ] **Step 6: Verificar antes de empujar**

Sin PR no hay Preview que mirar, así que la red de seguridad va entera por
delante (regla 13).

Run: `npm test && npm run build`
Expected: ambas en verde.

- [ ] **Step 7: Commit y push a main**

```bash
git add src/hooks/useGame.js src/i18n/locales/es.json src/i18n/locales/en.json android/app/build.gradle
git commit -m "feat(juego): avisar y recargar si el coche del dia cambia a media jornada"
git commit --allow-empty -m "chore(android): v54/1.8.5"
git push origin HEAD:main
```

- [ ] **Step 8: Sincronizar el checkout principal**

En el checkout principal (no en el worktree), porque los assets web están
gitignorados y sin esto el APK sale con la compilación anterior:

```bash
git pull && npm run cap:sync
```

Después dile al usuario qué versión va a salir (v54 / 1.8.5) y que ya solo tiene
que pulsar *Build* en Android Studio.

---

## Verificación final (en el Preview de Vercel, tras mergear el PR)

El cambio de emergencia no se puede probar dos veces el mismo día sin dejar
rastro, así que el orden importa:

1. Abre el juego en el Preview **sin sesión** y haz **un** intento. Deja la
   pestaña abierta.
2. En otra pestaña, entra al panel y haz el cambio de emergencia.
3. Vuelve a la primera pestaña y **recarga**: debes seguir viendo **el coche
   viejo**, con tu intento gastado y las pistas coherentes.
4. Abre una **ventana de incógnito**: debes ver el **coche nuevo**, con cinco
   intentos.
5. Con una cuenta que ya hubiera jugado hoy: recarga y comprueba que sigue con
   su partida y que **no** puede empezar de cero.
6. Si esa cuenta gana, comprueba que **suma puntos y racha** — es lo que verifica
   que el parche SQL de la Tarea 1 está aplicado en esa base.
