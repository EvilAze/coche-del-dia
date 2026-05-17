// scripts/backfill-blur-data.js
// Genera blur_data para todos los coches existentes que aún no lo tienen.
// Idempotente — vuelve a ejecutarlo sin miedo. Si quieres regenerar TODO
// (p.ej. tras cambiar el helper), pasa --force.
//
// Uso:
//   node scripts/backfill-blur-data.js
//   node scripts/backfill-blur-data.js --force
//
// Requisitos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env / .env.local.
// El script los carga manualmente desde .env.local (sin dotenv para no
// añadir dependencias).

const fs = require("node:fs");
const path = require("node:path");

// Carga ligera de .env.local. No reemplaza dotenv ni resuelve `export VAR=`
// — solo "KEY=value" por línea, suficiente para nuestro caso.
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
const sharp = require("sharp");

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env / .env.local"
  );
  process.exit(1);
}

const force = process.argv.includes("--force");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LQIP_WIDTH = 24;
const LQIP_QUALITY = 30;

// Reimplementamos generateBlurData aquí en CommonJS para que el script sea
// auto-contenido (los endpoints usan ESM y este script Node "plain").
// La lógica DEBE mantenerse idéntica a api/_lib/blur-data.js.
async function generateBlurData(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
    return null;
  }
  let upstream;
  try {
    upstream = await fetch(imageUrl);
  } catch (err) {
    console.error("  fetch err:", err?.message || err);
    return null;
  }
  if (!upstream.ok) {
    console.error("  upstream status:", upstream.status);
    return null;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  try {
    const out = await sharp(buf)
      .rotate()
      .resize(LQIP_WIDTH, null, { fit: "inside", withoutEnlargement: true })
      .blur(1)
      .jpeg({ quality: LQIP_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch (err) {
    console.error("  sharp err:", err?.message || err);
    return null;
  }
}

async function main() {
  // Diagnóstico inicial: confirmamos que la conexión funciona y que la
  // columna blur_data existe, antes de empezar a iterar. Si algo falla aquí
  // es síntoma de problema de schema o de credenciales, no de datos.
  const probe = await supabase
    .from("cars")
    .select("id, blur_data", { count: "exact", head: false })
    .limit(1);
  if (probe.error) {
    console.error("Probe falló (¿columna blur_data añadida en Supabase?):");
    console.error(probe.error);
    process.exitCode = 1;
    return;
  }
  console.log(`Conexión OK. Total de coches en 'cars': ${probe.count ?? "?"}`);

  // Trabajamos en lotes pequeños. Idempotente:
  //   - Modo normal: filtramos blur_data IS NULL. Las filas procesadas
  //     dejan de aparecer en el siguiente SELECT, así que el bucle termina
  //     naturalmente cuando ya no quedan.
  //   - Modo --force: paginamos por cursor `id > lastId` para visitar todas
  //     las filas una sola vez.
  const PAGE = 50;
  let total = 0;
  let okCount = 0;
  let failCount = 0;
  let cursor = null;

  while (true) {
    let query = supabase
      .from("cars")
      .select("id, image_url, blur_data")
      .order("id", { ascending: true })
      .limit(PAGE);

    if (force) {
      if (cursor !== null) query = query.gt("id", cursor);
    } else {
      query = query.is("blur_data", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Error leyendo cars:", error);
      process.exitCode = 1;
      return;
    }
    if (!data || data.length === 0) break;

    for (const car of data) {
      total++;
      if (!force && car.blur_data) continue; // por si concurrencia rara

      console.log(`[${total}] ${car.id} ← ${car.image_url}`);
      const blur = await generateBlurData(car.image_url);
      if (!blur) {
        console.log("  → skip (no se pudo generar)");
        failCount++;
        continue;
      }

      const { error: upErr } = await supabase
        .from("cars")
        .update({ blur_data: blur })
        .eq("id", car.id);
      if (upErr) {
        console.error("  → update err:", upErr.message);
        failCount++;
        continue;
      }
      console.log(`  → OK (${blur.length} chars)`);
      okCount++;
    }

    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }

  console.log("");
  console.log(`Listo. OK: ${okCount} · Fallidos: ${failCount}`);
  // No llamamos a process.exit(0). En Windows, hacerlo mientras el cliente
  // de Supabase / undici aún tiene sockets/agentes abiertos dispara el bug
  // de libuv (Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)).
  // Con exitCode + return, el proceso termina cuando se vacía el event loop
  // de forma limpia. Si en algún caso quedara colgado, dejamos un safety
  // net con un timer que fuerza el exit tras 2 s (suficiente para que los
  // sockets keep-alive de undici expiren).
  setTimeout(() => process.exit(0), 2000).unref();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
