// api/car-image.js
// Proxy de imagen para el Garaje. Recibe un token opaco firmado/cifrado
// con AES-GCM (ver api/_lib/image-token.js) y devuelve:
//   - mode "c" (clear)  → 302 a la URL real de Supabase (coche desbloqueado).
//   - mode "b" (blurred) → JPEG procesado server-side con desenfoque fuerte
//     y oscurecido (coche bloqueado).
//
// Por qué server-side blur en lugar de CSS:
//   Con CSS blur el cliente recibe la imagen original; basta abrir DevTools
//   y mirar el src para ver el coche nítido. Aquí la URL original NUNCA
//   llega al navegador para los bloqueados — solo el buffer JPEG ya borroso.
//
// Auth:
//   No requiere Bearer header — los <img> tags no pueden mandarlo. La
//   autorización está embebida en el token cifrado (un atacante no puede
//   fabricar uno sin REPESCA_TOKEN_SECRET, ni cambiar mode "b" por "c").

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  verifyImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
} from "./_lib/image-token.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      console.error("[car-image] missing SUPABASE_SERVICE_ROLE_KEY");
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const token = String(req.query?.t || "");
    if (!token) return res.status(400).json({ error: "Missing token" });

    const claims = verifyImageToken(token);
    if (!claims) return res.status(403).json({ error: "Invalid token" });

    // image_url es columna privilegiada → service_role.
    const { data: row, error } = await supabaseAdmin
      .from("cars")
      .select("image_url")
      .eq("id", claims.carId)
      .maybeSingle();
    if (error) {
      console.error("[car-image] read cars:", error);
      return res.status(500).json({ error: "DB error" });
    }
    if (!row?.image_url) {
      return res.status(404).json({ error: "Not found" });
    }

    // ---- Modo CLEAR: desbloqueado. 302 a la URL pública del CDN.
    // No exponemos nuestra ruta interna como CDN; un redirect mantiene la
    // semántica del original (caching, range requests si los hubiese) y
    // ahorra ancho de banda en nuestra función.
    if (claims.mode === IMAGE_MODE_CLEAR) {
      // 1 h en navegador. El token es estable (IV determinista) así que el
      // cache hit es real, no se invalida en cada apertura del Garaje.
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("Location", row.image_url);
      return res.status(302).end();
    }

    // ---- Modo BLURRED: bloqueado. Procesamos en memoria con sharp.
    if (claims.mode !== IMAGE_MODE_BLURRED) {
      // Defensa en profundidad — verifyImageToken ya valida esto.
      return res.status(400).json({ error: "Unsupported mode" });
    }

    let upstream;
    try {
      upstream = await fetch(row.image_url);
    } catch (err) {
      console.error("[car-image] upstream fetch:", err);
      return res.status(502).json({ error: "Upstream unavailable" });
    }
    if (!upstream.ok) {
      console.error("[car-image] upstream status:", upstream.status);
      return res.status(502).json({ error: "Upstream error" });
    }

    const inputBuf = Buffer.from(await upstream.arrayBuffer());

    // Pipeline sharp:
    //   - resize 160x200 (4:5 igual que las cards) ANTES de blur: el blur
    //     se aplica sobre menos píxeles → mucho más rápido y barato.
    //   - blur(5) sigma bajo → silueta del coche reconocible (coupé vs SUV,
    //     colores y forma de ruedas/ventanas se intuyen) pero detalles
    //     específicos ilegibles. Si subes de 8 empieza a perderse la
    //     silueta; si bajas de 3 se podría leer el modelo.
    //   - modulate brightness 0.45 → oscurece para reforzar el overlay
    //     CSS y dar el look "noche". El frontend pone encima un gradient
    //     adicional.
    //   - jpeg 50 → buffer pequeño (~3-5 KB), ideal para CDN.
    const out = await sharp(inputBuf)
      .rotate() // respeta EXIF orientation por si el original viene rotado
      .resize(160, 200, { fit: "cover", position: "center" })
      .blur(5)
      .modulate({ brightness: 0.45 })
      .jpeg({ quality: 50, mozjpeg: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(out.length));
    res.setHeader("Content-Disposition", "inline");
    // Cache fuerte: el output es determinista por (carId, mode) y el token
    // que lleva la URL también lo es. Inmutable hasta que el secreto rote.
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=86400, immutable"
    );

    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(out);
  } catch (err) {
    console.error(
      "[car-image] UNCAUGHT:",
      err && err.stack ? err.stack : err
    );
    return res.status(500).json({ error: "Internal error" });
  }
}
