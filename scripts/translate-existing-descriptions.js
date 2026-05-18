// scripts/translate-existing-descriptions.js
// Backfill one-shot: traduce a inglés (DeepL) todas las descripciones de
// coches que tienen `description` en español pero `description_en` NULL.
// Idempotente — vuelve a ejecutarlo sin miedo: solo procesa filas con EN
// pendiente. Si quieres re-traducir TODO (p.ej. tras ajustar el prompt en
// el futuro), pasa --force y procesará TODAS las filas con description ES,
// pisando el EN existente.
//
// Uso:
//   node scripts/translate-existing-descriptions.js              # traduce los pendientes
//   node scripts/translate-existing-descriptions.js --force      # re-traduce todos
//   node scripts/translate-existing-descriptions.js --check      # solo lista pendientes, no traduce
//
// Requisitos (en .env / .env.local):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   DEEPL_API_KEY
//   DEEPL_API_HOST  (opcional, default "api-free.deepl.com")
//
// Comportamiento:
//   - Lee todas las filas pendientes en un solo SELECT (~200 max, va sobrado).
//   - Llama a DeepL secuencialmente (~200 ms por request) — no merece la
//     pena paralelizar para este volumen y evita el rate limit del free tier.
//   - Tras cada traducción exitosa hace UPDATE de solo description_en para
//     no pisar nada más.
//   - Errores por fila se loguean y siguen — al final imprime un resumen
//     ok/skip/err.

const fs = require("node:fs");
const path = require("node:path");

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotenv(path.join(__dirname, "..", ".env.local"));
loadDotenv(path.join(__dirname, "..", ".env"));

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_HOST = process.env.DEEPL_API_HOST || "api-free.deepl.com";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env / .env.local");
  process.exit(1);
}
if (!DEEPL_API_KEY && !checkOnly) {
  console.error("Falta DEEPL_API_KEY en .env / .env.local");
  process.exit(1);
}

const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");

// --check no necesita la key de DeepL: solo lee de Supabase y lista. Esta
// validación va antes de exigir DEEPL_API_KEY más abajo, así puedes
// inspeccionar sin tenerla configurada.
if (checkOnly && force) {
  console.error("--check y --force son incompatibles");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function translate(text) {
  const params = new URLSearchParams();
  params.append("text", text);
  params.append("source_lang", "ES");
  params.append("target_lang", "EN");
  params.append("preserve_formatting", "1");

  const res = await fetch(`https://${DEEPL_API_HOST}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`DeepL ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const out = data?.translations?.[0]?.text;
  if (typeof out !== "string") {
    throw new Error("DeepL devolvió payload inesperado");
  }
  return out;
}

async function main() {
  if (checkOnly) {
    console.log("Modo CHECK: solo listo pendientes (no se traduce nada).");
  } else if (force) {
    console.log("Modo FORCE: re-traduciendo todo.");
  } else {
    console.log("Modo normal: solo pendientes.");
  }

  // Construimos el SELECT con un filtro distinto según --force.
  // .not("description", "is", null) → solo filas con ES presente
  // (sin esto traduciríamos NULL → DeepL daría error 400).
  let query = supabase
    .from("cars")
    .select("id, make, model, description, description_en")
    .not("description", "is", null);

  if (!force) {
    query = query.is("description_en", null);
  }

  const { data: cars, error } = await query;
  if (error) {
    console.error("Error leyendo cars:", error.message);
    process.exit(1);
  }
  if (!cars || cars.length === 0) {
    console.log(checkOnly ? "Todos los coches tienen traducción EN. ✓" : "Nada que traducir. Salgo.");
    return;
  }

  if (checkOnly) {
    console.log(`Coches pendientes de traducción: ${cars.length}\n`);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const preview = (c.description || "").slice(0, 60).replace(/\s+/g, " ");
      console.log(`${i + 1}/${cars.length}  ${c.make} ${c.model}  —  "${preview}${c.description.length > 60 ? "…" : ""}"`);
    }
    console.log(`\nTotal pendientes: ${cars.length}. Lanza sin --check para traducir.`);
    return;
  }

  console.log(`Coches a traducir: ${cars.length}\n`);

  let ok = 0;
  let skip = 0;
  let err = 0;

  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    const label = `${i + 1}/${cars.length}  ${c.make} ${c.model}`;

    const text = (c.description || "").trim();
    if (!text) {
      console.log(`SKIP  ${label}  (description vacía tras trim)`);
      skip++;
      continue;
    }

    try {
      const translated = await translate(text);
      const { error: updErr } = await supabase
        .from("cars")
        .update({ description_en: translated })
        .eq("id", c.id);
      if (updErr) {
        console.error(`ERR   ${label}  update: ${updErr.message}`);
        err++;
      } else {
        console.log(`OK    ${label}`);
        ok++;
      }
    } catch (e) {
      console.error(`ERR   ${label}  ${e?.message || e}`);
      err++;
    }
  }

  console.log(`\nResumen: ${ok} ok · ${skip} skip · ${err} err`);
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error("UNCAUGHT:", e?.stack || e);
  process.exit(1);
});
