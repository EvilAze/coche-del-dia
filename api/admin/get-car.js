// api/admin/get-car.js
// Devuelve datos completos de un coche (incluyendo image_url) a un admin
// autenticado. Necesario para Preview.jsx tras revocar SELECT(image_url) a
// anon/authenticated.

import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = ["ievilaze@gmail.com"];

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Only GET" });
  }

  if (!supabaseAdmin) {
    console.error("[admin/get-car] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Validar identidad y email contra la whitelist.
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const email = (userData.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const id = req.query.id;
  if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const { data, error } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year, pais, description, description_en, image_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[admin/get-car]", error);
    return res.status(500).json({ message: "Read failed" });
  }
  if (!data) return res.status(404).json({ message: "Not found" });

  res.status(200).json({
    id: data.id,
    marca: data.make,
    modelo: data.model,
    anio: data.year,
    pais: data.pais,
    description: data.description ?? null,
    description_en: data.description_en ?? null,
    img: data.image_url,
  });
}
