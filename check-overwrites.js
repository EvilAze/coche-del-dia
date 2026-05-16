// Script temporal: muestra description actual vs nueva para los 2 coches
// que ya tenían texto en la base de datos.
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const TARGETS = [
  "0a733115-8253-4bb0-93f6-8977b190f3b1", // Alfa Romeo 4c
  // Rover 400 id lo buscamos abajo
];

(async () => {
  const { data } = await supabase
    .from("cars")
    .select("id, make, model, year, description")
    .or("and(make.eq.Alfa Romeo,model.eq.4c),and(make.eq.Rover,model.eq.400)");

  for (const c of data || []) {
    console.log(`\n=== ${c.make} ${c.model} (${c.year}) ===`);
    console.log(`ACTUAL en DB:\n  ${c.description}`);
  }
})();
