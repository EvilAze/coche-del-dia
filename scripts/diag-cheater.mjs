// scripts/diag-cheater.mjs
// READ-ONLY. Busca un usuario por fragmento de email y analiza su historial
// de partidas (user_guesses) para detectar el patrón de "oráculo":
// aciertos marca+modelo+año exactos al primer intento de forma sistemática.
//
// Uso:  node scripts/diag-cheater.mjs navaro
//       node scripts/diag-cheater.mjs fakenavaro@gmail.com

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// --- Carga manual de .env / .env.local (sin dependencias) ---------------
for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    process.env[k] = vRaw.replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const needle = (process.argv[2] || "navaro").toLowerCase();
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- 1) Encontrar el usuario por email (paginando auth.admin) -----------
async function findUser(needle) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users || []).find((u) =>
      (u.email || "").toLowerCase().includes(needle)
    );
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

const user = await findUser(needle);
if (!user) {
  console.error(`No encontré ningún usuario cuyo email contenga "${needle}".`);
  process.exit(2);
}
console.log(`\n=== Usuario ===`);
console.log(`email:    ${user.email}`);
console.log(`user_id:  ${user.id}`);
console.log(`creado:   ${user.created_at}`);

// --- 2) Historial de partidas ------------------------------------------
const { data: rows, error: gErr } = await admin
  .from("user_guesses")
  .select("car_id, date, status, guesses, updated_at")
  .eq("user_id", user.id)
  .order("date", { ascending: true });
if (gErr) {
  console.error("Error leyendo user_guesses:", gErr);
  process.exit(3);
}

const total = rows.length;
const won = rows.filter((r) => r.status === "won").length;
const lost = rows.filter((r) => r.status === "lost").length;
const playing = rows.filter((r) => r.status === "playing").length;

// Para cada partida ganada, en qué intento ganó y si el PRIMER intento
// fue ya marca+modelo+año exactos (huella de oráculo).
let wonOnFirst = 0;
let firstGuessFullExact = 0; // primer guess con marca+modelo+año correctos
const attemptHist = {}; // intento_ganador -> count
const detail = [];

for (const r of rows) {
  const g = Array.isArray(r.guesses) ? r.guesses : [];
  const winIdx = g.findIndex((x) => x?.win === true);
  const first = g[0];
  const firstExact =
    first &&
    first.marca?.status === "correct" &&
    first.modelo?.status === "correct" &&
    first.anio?.status === "correct";
  if (firstExact) firstGuessFullExact++;
  if (r.status === "won") {
    const n = winIdx >= 0 ? winIdx + 1 : g.length;
    attemptHist[n] = (attemptHist[n] || 0) + 1;
    if (n === 1) wonOnFirst++;
  }
  detail.push({
    date: r.date,
    status: r.status,
    intentos: g.length,
    ganoEn: winIdx >= 0 ? winIdx + 1 : "-",
    primerExacto: firstExact ? "SI" : "",
  });
}

console.log(`\n=== Resumen (${total} partidas) ===`);
console.log(`ganadas:  ${won}  (${total ? ((won / total) * 100).toFixed(0) : 0}%)`);
console.log(`perdidas: ${lost}`);
console.log(`en curso: ${playing}`);
console.log(`\nGanadas al 1er intento:        ${wonOnFirst} / ${won}`);
console.log(`Primer intento marca+mod+año EXACTO: ${firstGuessFullExact} / ${total}  <-- huella de oráculo`);
console.log(`\nDistribución de intento ganador:`);
for (const k of Object.keys(attemptHist).sort()) {
  console.log(`  ${k}/5: ${attemptHist[k]}`);
}

console.log(`\n=== Detalle por partida ===`);
console.table(detail);
