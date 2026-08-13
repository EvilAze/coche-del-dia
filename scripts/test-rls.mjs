// scripts/test-rls.mjs
//
// Tests ONLINE de RLS contra la BD real. Se conecta con la SUPABASE_ANON_KEY
// — la misma que tiene el navegador en producción — e intenta leer/mutar
// las tablas sensibles. Cualquier ataque que pase aquí pasaría desde
// DevTools de un usuario cualquiera.
//
// Diferencia con test-security.mjs y test-attacks.mjs:
//   - Aquellos son OFFLINE: testean primitivos (HMAC, cookie, rate-limit
//     en memoria) sin tocar Supabase. Corren en CI sin secretos.
//   - Este es ONLINE: necesita SUPABASE_URL + SUPABASE_ANON_KEY de un
//     entorno real (staging o prod). NO escribe nada — todas las
//     mutaciones que intenta DEBEN fallar; si una pasa, hay agujero.
//
// Uso:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJhbGciOi... \
//     node scripts/test-rls.mjs
//
// (o lee VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY si las tienes ya
//  exportadas para el dev server).
//
// Exit code:
//   0 → todos los checks pasan
//   1 → al menos un leak detectado (revisa policies y GRANTs)
//   2 → faltan env vars

import { createClient } from "@supabase/supabase-js";

const URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error(
    "[test-rls] Faltan SUPABASE_URL / SUPABASE_ANON_KEY (o sus VITE_*).\n" +
      "          Exporta las variables del proyecto real antes de correr este test."
  );
  process.exit(2);
}

// Cliente "anónimo" — mismas credenciales que tiene el browser. Sin
// persistSession para no tocar localStorage del entorno donde se corre.
const anon = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------- harness mínimo --------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function pass(label, extra = "") {
  passed++;
  console.log(`  ✓ ${label}${extra ? ` ${extra}` : ""}`);
}

function fail(label, extra = "") {
  failed++;
  failures.push(`${label}${extra ? `\n      ${extra}` : ""}`);
  console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
}

// Una SELECT está "bloqueada" si:
//   (a) llega un error explícito (42501 insufficient_privilege, etc.), o
//   (b) llega data con 0 filas (RLS oculta filas silenciosamente: este es
//       el comportamiento típico de Postgres cuando no hay policy SELECT
//       que aplique al rol que pregunta).
// Cualquiera de las dos cumple "el cliente no puede leer datos".
function expectSelectBlocked(label, response) {
  const { data, error } = response;
  if (error) {
    pass(label, `(error: ${error.code || error.message})`);
    return;
  }
  if (Array.isArray(data) && data.length === 0) {
    pass(label, "(0 rows — RLS oculta)");
    return;
  }
  const sample =
    data == null
      ? String(data)
      : JSON.stringify(data).slice(0, 160) + (JSON.stringify(data).length > 160 ? "…" : "");
  fail(label, `LEAK: data devuelta = ${sample}`);
}

// Una mutación (INSERT/UPDATE/DELETE) está "bloqueada" si:
//   (a) llega un error (42501 si REVOKE'd, o policy violation), o
//   (b) `data` es null o array vacío (la mutación no afectó filas — sea
//       porque RLS las oculta o porque el rol no tiene permisos).
// IMPORTANTE: este test asume que el WHERE clause no matchea filas reales.
// Usamos UUIDs nulos / filtros imposibles para no arriesgar tocar nada real.
function expectMutationBlocked(label, response) {
  const { data, error } = response;
  if (error) {
    pass(label, `(${error.code || error.message})`);
    return;
  }
  if (data == null || (Array.isArray(data) && data.length === 0)) {
    pass(label, "(no rows affected)");
    return;
  }
  fail(label, `AFECTÓ FILAS: ${JSON.stringify(data).slice(0, 160)}`);
}

const NULL_UUID = "00000000-0000-0000-0000-000000000000";

// ============================================================================
console.log("\n[daily_cars] — el calendario del juego NO debe leerse del cliente");
// ============================================================================

// Este es el bloque del audit. Si daily_cars filtra, el atacante tiene
// la programación entera (pasado y futuro) y puede cruzar con /api/list-cars
// para saber qué coche tocará mañana o reconstruir el histórico para
// sesgar la repesca.
expectSelectBlocked(
  "SELECT * FROM daily_cars",
  await anon.from("daily_cars").select("*").limit(5)
);
expectSelectBlocked(
  "SELECT car_id, date FROM daily_cars (subset de columnas)",
  await anon.from("daily_cars").select("car_id, date").limit(5)
);
expectSelectBlocked(
  "SELECT * FROM daily_cars WHERE date >= hoy (calendario futuro)",
  await anon
    .from("daily_cars")
    .select("*")
    .gte("date", new Date().toISOString().slice(0, 10))
    .limit(5)
);
expectSelectBlocked(
  "SELECT count(*) FROM daily_cars (head)",
  await anon.from("daily_cars").select("*", { count: "exact", head: true })
);

// ============================================================================
console.log("\n[cars] — image_url / description solo desde server-side");
// ============================================================================

// El hardening [B.5] revoca SELECT general y solo permite columnas no
// sensibles vía GRANT específico. Si el atacante pide image_url y se le
// devuelve, la imagen completa de un coche cualquiera está expuesta
// (rompe el server-side blurring).
expectSelectBlocked(
  "SELECT * FROM cars (debe rechazar — incluye image_url/description)",
  await anon.from("cars").select("*").limit(1)
);
expectSelectBlocked(
  "SELECT id, image_url FROM cars",
  await anon.from("cars").select("id, image_url").limit(1)
);
expectSelectBlocked(
  "SELECT id, description FROM cars",
  await anon.from("cars").select("id, description").limit(1)
);
expectSelectBlocked(
  "SELECT id, description_en FROM cars",
  await anon.from("cars").select("id, description_en").limit(1)
);
// cars.tags — etiquetas de Temporada Temática. NO tienen GRANT a propósito
// (scripts/2026-07-temporadas-tematicas.sql): son la pertenencia de cada coche
// al tema en curso. Legibles desde el cliente, cruzarlas con el catálogo
// público reduciría el coche del día a la lista exacta de candidatos.
expectSelectBlocked(
  "SELECT id, tags FROM cars (pool de la temporada temática)",
  await anon.from("cars").select("id, tags").limit(1)
);
// cars.video_id — el vídeo del coche en las temporadas presentadas. Tampoco
// lleva GRANT (scripts/2026-08-temporada-presentada-y-video.sql) y por partida
// doble: un ID de YouTube NOMBRA el coche del día, y además la columna estará
// poblada justo en los coches del ciclo, así que leerla es leer el pool. Al
// jugador solo le llega dentro del `reveal` de una partida ya cerrada.
expectSelectBlocked(
  "SELECT id, video_id FROM cars (el vídeo es la respuesta)",
  await anon.from("cars").select("id, video_id").limit(1)
);

// Contra-test: la query que SÍ debe funcionar (la que usa /api/list-cars
// para el autocomplete). Verificamos que no rompemos funcionalidad
// legítima al endurecer. Nombres de columna canónicos en BD: make / model
// / year / pais (el endpoint los mapea a marca/modelo/anio para el front).
{
  const { data, error } = await anon
    .from("cars")
    .select("id, make, model, year, pais")
    .limit(3);
  if (error) {
    fail(
      "[cars] SELECT campos públicos (autocomplete)",
      `ROTO: ${error.code || error.message}. ¿Has revocado SELECT sin re-GRANT?`
    );
  } else if (!data || data.length === 0) {
    // Puede ser legítimo si el catálogo está vacío en el entorno testeado.
    console.log(
      `  ⚠ [cars] SELECT campos públicos devolvió 0 filas — ¿catálogo vacío en este entorno?`
    );
  } else {
    pass(
      "[cars] SELECT campos públicos (autocomplete) funciona",
      `(${data.length} filas)`
    );
  }
}

// ============================================================================
console.log("\n[seasons] — el filtro temático NO debe leerse del cliente");
// ============================================================================

// `seasons` es de lectura pública a propósito: el banner necesita número,
// temática y fechas, y eso es marketing. Pero `theme_filter` describe de qué
// coches sortea el juego durante la temporada — es el pool del día en forma
// declarativa. Con él, el atacante lo reproduce contra /api/list-cars y acota
// el coche del día a un puñado de candidatos.
expectSelectBlocked(
  "SELECT * FROM seasons (incluye theme_filter)",
  await anon.from("seasons").select("*").limit(1)
);
expectSelectBlocked(
  "SELECT id, theme_filter FROM seasons",
  await anon.from("seasons").select("id, theme_filter").limit(1)
);

// Contra-test: lo que SÍ lee el banner (statsService.getCurrentSeason). Si
// esto rompe, el GRANT por columna se aplicó mal y la home se queda sin
// temporada.
// `presenta_*` va en esta lista y NO en la de bloqueados, al revés que
// theme_filter: es el crédito de una colaboración («USPI · POWERART») y se
// pinta durante la partida, así que el cliente TIENE que poder leerlo. No
// filtra nada — dice de qué va el ciclo, igual que `label_es`; lo que sigue
// sin salir del servidor es la lista de coches que lo componen.
{
  const { error } = await anon
    .from("seasons")
    .select("id, number, label_es, label_en, presenta_es, presenta_en, starts_at, ends_at")
    .limit(1);
  if (error) {
    fail(
      "[seasons] SELECT campos del banner",
      `ROTO: ${error.code || error.message}. ¿Revocaste SELECT sin re-GRANT por columna?`
    );
  } else {
    pass("[seasons] SELECT campos del banner funciona");
  }
}

// ============================================================================
console.log("\n[stats] — SELECT permitido (ranking público), mutaciones NO");
// ============================================================================

// SELECT debe ir: el ranking lo lee cualquiera (anon incluido).
{
  const { data, error } = await anon
    .from("stats")
    .select("user_id, total_wins")
    .limit(1);
  if (error) {
    fail(
      "[stats] SELECT debería estar permitido (ranking)",
      `error: ${error.code || error.message}`
    );
  } else {
    pass(
      "[stats] SELECT permitido (ranking)",
      `(${data?.length ?? 0} filas)`
    );
  }
}

// Mutaciones desde anon NO deben prosperar. Si una pasa, un atacante
// puede inflarse stats sin jugar.
expectMutationBlocked(
  "INSERT en stats (anon intenta crear fila)",
  await anon
    .from("stats")
    .insert({ user_id: NULL_UUID, total_wins: 999999 })
    .select()
);
expectMutationBlocked(
  "UPDATE en stats (anon intenta modificar)",
  await anon
    .from("stats")
    .update({ total_wins: 999999 })
    .eq("user_id", NULL_UUID)
    .select()
);
expectMutationBlocked(
  "DELETE en stats (anon intenta borrar)",
  await anon.from("stats").delete().eq("user_id", NULL_UUID).select()
);

// ============================================================================
console.log("\n[user_guesses] — anon no puede leer ni escribir");
// ============================================================================

expectSelectBlocked(
  "SELECT en user_guesses sin sesión",
  await anon.from("user_guesses").select("*").limit(1)
);
expectMutationBlocked(
  "INSERT en user_guesses sin sesión",
  await anon
    .from("user_guesses")
    .insert({
      user_id: NULL_UUID,
      car_id: NULL_UUID,
      date: "2099-01-01",
    })
    .select()
);
expectMutationBlocked(
  "UPDATE en user_guesses sin sesión",
  await anon
    .from("user_guesses")
    .update({ status: "won" })
    .eq("user_id", NULL_UUID)
    .select()
);
expectMutationBlocked(
  "DELETE en user_guesses sin sesión",
  await anon
    .from("user_guesses")
    .delete()
    .eq("user_id", NULL_UUID)
    .select()
);

// ============================================================================
console.log("\n[profiles] — accesos públicos controlados");
// ============================================================================

// El esquema permite ver perfiles públicos por display_name para el ranking,
// pero NO deberíamos exponer columnas sensibles (email, raw_user_meta_data
// si las almacenamos). La columna real de display público es `display_name`
// (ver src/hooks/useStats.js).
//
// SELECT * sobre profiles debería rechazarse (o devolver 0) — si filtra
// columnas sensibles habría leak silencioso.
expectSelectBlocked(
  "SELECT * FROM profiles (debería rechazar columnas no públicas)",
  await anon.from("profiles").select("*").limit(1)
);
// La lectura mínima (id + display_name) puede o no estar permitida según
// si el ranking lee aquí o sale ya joineado en stats. Informativo:
{
  const { data, error } = await anon
    .from("profiles")
    .select("id, display_name")
    .limit(1);
  if (error) {
    console.log(
      `  ℹ [profiles] SELECT id, display_name: ${error.code || error.message} ` +
        `(OK si el ranking no usa esta tabla públicamente)`
    );
  } else {
    console.log(
      `  ℹ [profiles] SELECT id, display_name devolvió ${data?.length ?? 0} filas (informativo)`
    );
  }
}

// ============================================================================
console.log("\n[RPC] funciones expuestas — solo las que QUEREMOS callables");
// ============================================================================

// pick_daily_car: si se puede llamar desde anon, un atacante pide el
// coche de mañana. Hardening [B.1] la revoca.
{
  const today = new Date().toISOString().slice(0, 10);
  // Probamos con el nombre canónico p_date; si la firma es distinta el
  // RPC fallará por arg mismatch (también deseable: indica que no es
  // ejecutable con args triviales).
  const { error } = await anon.rpc("pick_daily_car", { p_date: today });
  if (!error) {
    fail(
      "pick_daily_car ejecutable desde anon",
      "CRÍTICO: la RPC se ejecuta sin permisos especiales"
    );
  } else {
    pass(
      "pick_daily_car bloqueado para anon",
      `(${error.code || error.message})`
    );
  }
}

// record_daily_result_v2: si se puede llamar SIN sesión válida, podría
// asignarse stats. Debe rechazar (auth.uid() = null → exception).
{
  const { error } = await anon.rpc("record_daily_result_v2", {
    p_won: true,
    p_attempt_number: 1,
  });
  if (!error) {
    fail(
      "record_daily_result_v2 ejecutable sin sesión",
      "CRÍTICO: registra resultado anónimo"
    );
  } else {
    pass(
      "record_daily_result_v2 rechaza sin sesión",
      `(${error.code || error.message})`
    );
  }
}

// ============================================================================
console.log("\n[push_subscriptions] — admin-only: el cliente NO debe leer ni escribir");
// ============================================================================

// La tabla es deny-all (RLS ON sin policies + REVOKE ALL). Un anon no debe
// poder leer endpoints/claves de otros ni darse de alta saltándose el endpoint
// /api/push/subscribe. Si SELECT filtra, se exponen las URLs de push (semi-
// secretas) de todos los usuarios; si INSERT pasa, cualquiera escribe la tabla.
expectSelectBlocked(
  "SELECT * FROM push_subscriptions",
  await anon.from("push_subscriptions").select("*").limit(5)
);
expectSelectBlocked(
  "SELECT endpoint FROM push_subscriptions (subset)",
  await anon.from("push_subscriptions").select("endpoint").limit(5)
);
// INSERT con .select(): si tuviera éxito devolvería la fila (LEAK detectable);
// endpoint ficticio único para no colisionar con datos reales.
expectMutationBlocked(
  "INSERT INTO push_subscriptions (anon no puede darse de alta directo)",
  await anon
    .from("push_subscriptions")
    .insert({ endpoint: "https://example.com/rls-leak-test", p256dh: "x", auth: "y" })
    .select()
);
// DELETE con filtro imposible (NULL_UUID) → seguro; debe fallar por REVOKE.
expectMutationBlocked(
  "DELETE FROM push_subscriptions WHERE id = NULL_UUID",
  await anon.from("push_subscriptions").delete().eq("id", NULL_UUID).select()
);

// ============================================================================
console.log("\n──────────────────────────────────────────");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
if (failed > 0) {
  console.log("\nFAILURES detalladas:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log(
    "\nRevisa scripts/supabase-hardening.sql y comprueba que los bloques " +
      "[B.1]–[B.5] están aplicados en el proyecto Supabase real."
  );
  process.exit(1);
}
console.log("\n✓ Sin leaks detectados con la ANON_KEY actual.");
process.exit(0);
