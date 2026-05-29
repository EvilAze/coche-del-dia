// scripts/audit-oracle.mjs
// READ-ONLY. Lee la tabla oculta public.guess_audit y delata el patrón de
// "oráculo": una misma IP (ip_hash) que sondea el coche de un día bajo una
// identidad (anónima u otra cuenta) y luego lo gana al PRIMER intento con
// una cuenta logueada.
//
// Uso:
//   node scripts/audit-oracle.mjs                  -> escanea todo
//   node scripts/audit-oracle.mjs 2026-05-28       -> solo ese día
//   node scripts/audit-oracle.mjs navaro           -> filtra por email (fragmento)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const arg = (process.argv[2] || "").trim();
const isDate = /^\d{4}-\d{2}-\d{2}$/.test(arg);

// Mapa user_id -> email (para imprimir algo legible).
const emailById = new Map();
async function loadEmails() {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data?.users || []) emailById.set(u.id, u.email || u.id);
    if (!data?.users?.length || data.users.length < 200) break;
  }
}
await loadEmails();

let emailNeedle = null;
if (arg && !isDate) emailNeedle = arg.toLowerCase();

let q = admin
  .from("guess_audit")
  .select("ts, mode, game_date, car_id, user_id, is_anon, attempt_number, ip_hash, ua, guess_make, guess_model, guess_year, win")
  .order("ts", { ascending: true });
if (isDate) q = q.eq("game_date", arg);

const { data: rows, error } = await q;
if (error) {
  console.error("Error leyendo guess_audit:", error.message || error);
  console.error("(¿Aplicaste scripts/supabase-guess-audit.sql en Supabase?)");
  process.exit(2);
}
if (!rows?.length) {
  console.log("Sin filas de auditoría todavía. Vuelve cuando se hayan jugado partidas con el logging activo.");
  process.exit(0);
}

// Agrupar por (game_date, car_id, ip_hash).
const groups = new Map();
for (const r of rows) {
  if (!r.ip_hash) continue;
  const k = `${r.game_date}|${r.car_id}|${r.ip_hash}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const flags = [];
for (const [k, list] of groups) {
  const [game_date, car_id, ip_hash] = k.split("|");
  const userIds = new Set(list.filter((r) => r.user_id).map((r) => r.user_id));
  const hasAnon = list.some((r) => r.is_anon);
  // Identidades distintas desde la MISMA IP en el mismo coche/día.
  const identities = userIds.size + (hasAnon ? 1 : 0);
  // ¿Hay un win logueado al primer intento desde esta IP?
  const winFirst = list.find(
    (r) => r.win && !r.is_anon && r.attempt_number === 1
  );
  // Sospechoso: ganó a la primera, pero esta IP además probó bajo OTRA
  // identidad (anónima, o una segunda cuenta) en el mismo coche/día.
  const probedElsewhere =
    hasAnon || userIds.size > 1 || list.some((r) => !r.win && r.attempt_number >= 1 && r.user_id !== winFirst?.user_id);
  if (winFirst && identities >= 1 && (hasAnon || userIds.size > 1)) {
    flags.push({ game_date, car_id, ip_hash, list, winFirst });
  }
}

if (emailNeedle) {
  // Filtrar flags donde el ganador coincide con el email buscado.
  const wanted = [...emailById.entries()]
    .filter(([, e]) => (e || "").toLowerCase().includes(emailNeedle))
    .map(([id]) => id);
  const wantedSet = new Set(wanted);
  for (let i = flags.length - 1; i >= 0; i--) {
    if (!wantedSet.has(flags[i].winFirst.user_id)) flags.splice(i, 1);
  }
}

console.log(`\nFilas analizadas: ${rows.length}  |  grupos (día+coche+IP): ${groups.size}`);
console.log(`=== Posibles oráculos detectados: ${flags.length} ===\n`);

for (const f of flags) {
  const winner = emailById.get(f.winFirst.user_id) || f.winFirst.user_id;
  console.log(`■ ${f.game_date}  coche=${f.car_id}  ip_hash=${f.ip_hash.slice(0, 12)}…`);
  console.log(`  GANÓ a la 1ª: ${winner}`);
  console.log(`  Cronología desde esa misma IP:`);
  for (const r of f.list) {
    const who = r.is_anon ? "ANON" : (emailById.get(r.user_id) || r.user_id);
    const res = `${r.marca_status ?? r.guess_make}/${r.modelo_status ?? ""}`;
    console.log(
      `    ${r.ts}  [${r.mode}] ${who}  intento ${r.attempt_number}  ` +
      `guess="${r.guess_make} ${r.guess_model} ${r.guess_year}"  ${r.win ? "★WIN" : ""}`
    );
  }
  console.log("");
}

if (!flags.length) {
  console.log("Nada sospechoso con los datos actuales (o aún no hay suficientes intentos registrados).");
}
