// import-descriptions.js
// Importa descripciones desde un CSV a la columna `cars.description` de Supabase.
// Empareja por `id` (UUID). Salta filas con descripción plantilla auto-generada.
//
// Uso:
//   node import-descriptions.js                 → dry-run (no escribe nada)
//   node import-descriptions.js --apply         → ejecuta los UPDATEs
//
// CSV esperado:
//   id,make,model,year,image_url,created_at,pais,description

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const CSV_PATH =
  process.argv.find((a) => a.endsWith(".csv")) ||
  "C:\\Users\\Ruben\\Downloads\\descripciones_completas_carguessr.csv";
const APPLY = process.argv.includes("--apply");

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Patrón de descripción plantilla auto-generada que vamos a saltar.
const PLACEHOLDER_RE = /robustez mecánica y las inconfundibles/i;

// Parser CSV RFC 4180-ish: soporta campos con comas y saltos de línea dentro
// de comillas, y comillas escapadas como "". Devuelve array de arrays.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim()));
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error("No existe el CSV:", CSV_PATH);
    process.exit(1);
  }

  console.log(`\nModo: ${APPLY ? "APPLY (escritura real)" : "DRY-RUN (no escribe)"}`);
  console.log(`CSV : ${CSV_PATH}\n`);

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  const header = rows.shift();
  const idx = {
    id: header.indexOf("id"),
    make: header.indexOf("make"),
    model: header.indexOf("model"),
    year: header.indexOf("year"),
    description: header.indexOf("description"),
  };
  if (Object.values(idx).some((v) => v < 0)) {
    console.error("Cabecera incompleta. Esperado: id, make, model, year, description.");
    console.error("Encontrado:", header);
    process.exit(1);
  }

  // 1) Filtrar y normalizar
  const all = rows.map((r) => ({
    id: r[idx.id]?.trim(),
    make: r[idx.make]?.trim(),
    model: r[idx.model]?.trim(),
    year: r[idx.year]?.trim(),
    description: (r[idx.description] || "").trim(),
  }));

  const skipped = all.filter(
    (r) => !r.description || PLACEHOLDER_RE.test(r.description)
  );
  const toImport = all.filter(
    (r) => r.description && !PLACEHOLDER_RE.test(r.description) && r.id
  );

  // 2) Sacar IDs que existen en DB para detectar no-matches
  const { data: dbCars, error: dbErr } = await supabase
    .from("cars")
    .select("id, make, model, year, description");
  if (dbErr) {
    console.error("Error leyendo cars:", dbErr);
    process.exit(1);
  }
  const dbById = new Map(dbCars.map((c) => [c.id, c]));

  const matchedRaw = toImport.filter((r) => dbById.has(r.id));
  const unmatched = toImport.filter((r) => !dbById.has(r.id));
  // Política: NO sobrescribir descripciones que ya existen en DB.
  // Las descripciones manuales suelen estar más cuidadas que las del CSV.
  const preserved = matchedRaw.filter(
    (r) => dbById.get(r.id).description && dbById.get(r.id).description.trim()
  );
  const matched = matchedRaw.filter(
    (r) => !(dbById.get(r.id).description && dbById.get(r.id).description.trim())
  );

  // 3) Reporte
  console.log("─────────── RESUMEN ───────────");
  console.log(`Filas CSV total          : ${all.length}`);
  console.log(`  · Plantillas saltadas  : ${skipped.length}`);
  console.log(`  · A importar           : ${toImport.length}`);
  console.log(`Match contra DB`);
  console.log(`  · Para UPDATE          : ${matched.length}`);
  console.log(`  · NO encontrados       : ${unmatched.length}`);
  console.log(`  · Preservados          : ${preserved.length} (ya tenían description, no se tocan)`);
  console.log(`DB total cars            : ${dbCars.length}`);
  console.log(`DB cars sin description tras import: ${
    dbCars.filter((c) => !matched.find((m) => m.id === c.id)).filter((c) => !c.description?.trim()).length
  }`);
  console.log("───────────────────────────────\n");

  if (skipped.length) {
    console.log(`Plantilla / vacías (${skipped.length}):`);
    for (const r of skipped) {
      console.log(`  - ${r.make} ${r.model} (${r.year})  id=${r.id}`);
    }
    console.log("");
  }
  if (unmatched.length) {
    console.log(`Sin match en DB (${unmatched.length}):`);
    for (const r of unmatched) {
      console.log(`  - ${r.make} ${r.model} (${r.year})  id=${r.id}`);
    }
    console.log("");
  }
  if (preserved.length) {
    console.log(`Preservados (ya tenían description en DB, NO se tocan) (${preserved.length}):`);
    for (const r of preserved) {
      console.log(`  - ${r.make} ${r.model} (${r.year})`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("Dry-run terminado. Ejecuta con --apply para escribir en Supabase.");
    return;
  }

  // 4) Apply: UPDATE uno a uno (fiable, sin upsert que podría romper otros campos)
  console.log(`Aplicando ${matched.length} UPDATEs...`);
  let ok = 0;
  let fail = 0;
  for (const r of matched) {
    const { error } = await supabase
      .from("cars")
      .update({ description: r.description })
      .eq("id", r.id);
    if (error) {
      fail++;
      console.error(`  ✗ ${r.make} ${r.model}:`, error.message);
    } else {
      ok++;
      if (ok % 20 === 0) console.log(`  ... ${ok}/${matched.length}`);
    }
  }
  console.log(`\nHecho. OK: ${ok}, fallos: ${fail}.`);
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
