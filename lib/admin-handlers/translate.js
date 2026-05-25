// api/admin/translate.js
// Traduce un texto usando DeepL (Free API). Solo admin (whitelist), para
// que no se convierta en un translator gratis abierto al mundo.
//
// Body JSON:
//   { text: string, source?: "ES", target?: "EN" }
//
// Response:
//   { translated: string, source: "ES", target: "EN" }
//
// Env vars necesarias:
//   DEEPL_API_KEY              clave de DeepL Free o Pro
//   DEEPL_API_HOST?            override opcional; default "api-free.deepl.com"
//                              (cambia a "api.deepl.com" si tienes Pro)
//
// Notas de implementación:
//   - DeepL acepta múltiples textos en la misma request (`text` repetido),
//     pero aquí solo traducimos uno — descripciones de coches, ~150-300
//     caracteres. No vale la pena complicar la API.
//   - Auth: mismo patrón que add-car/update-car (Bearer + whitelist email).
//     Sin esto, alguien podría llamar al endpoint desde DevTools y quemar
//     nuestros 500k chars/mes gratis.
//   - target/source son códigos ISO-639-1 en mayúsculas como espera DeepL.

import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_HOST = process.env.DEEPL_API_HOST || "api-free.deepl.com";

// Tope defensivo: descripciones largas serían un abuso del free tier.
// Coincide con MAX_DESCRIPTION_LEN del admin → si el form lo respeta,
// nunca debería saltar.
const MAX_TEXT_LEN = 1000;

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    if (!DEEPL_API_KEY) {
      return res.status(500).json({ error: "Server misconfigured (DEEPL_API_KEY)" });
    }

    // Identidad + whitelist.
    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const body = parseBody(req);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const source = (body.source || "ES").toUpperCase();
    const target = (body.target || "EN").toUpperCase();

    if (!text) {
      return res.status(400).json({ error: "text requerido" });
    }
    if (text.length > MAX_TEXT_LEN) {
      return res.status(400).json({
        error: `text supera ${MAX_TEXT_LEN} caracteres`,
      });
    }

    // DeepL Free endpoint. Form-urlencoded (no JSON). Auth con header
    // `Authorization: DeepL-Auth-Key <KEY>`.
    const params = new URLSearchParams();
    params.append("text", text);
    params.append("source_lang", source);
    params.append("target_lang", target);
    // preserve_formatting=1 → mantiene mayúsculas/minúsculas y puntuación
    // como vienen, sin "limpieza" agresiva. Útil para descripciones técnicas.
    params.append("preserve_formatting", "1");

    const deeplRes = await fetch(`https://${DEEPL_API_HOST}/v2/translate`, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!deeplRes.ok) {
      const errText = await deeplRes.text().catch(() => "");
      console.error("[admin/translate] DeepL error", deeplRes.status, errText);
      return res.status(502).json({
        error: "Translation provider error",
        detail: `DeepL ${deeplRes.status}`,
      });
    }

    const data = await deeplRes.json();
    const translated = data?.translations?.[0]?.text;
    if (typeof translated !== "string") {
      console.error("[admin/translate] Unexpected DeepL payload", data);
      return res.status(502).json({ error: "Translation provider returned no text" });
    }

    return res.status(200).json({
      translated,
      source,
      target,
    });
  } catch (err) {
    console.error("[admin/translate] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail: err?.message || String(err),
    });
  }
}
