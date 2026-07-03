// api/car-image.js
// Proxy de imagen para el Garaje y el Túnel de viento. Recibe un token opaco
// firmado/cifrado con AES-GCM (ver api/_lib/image-token.js) y devuelve:
//   - mode "c" (clear)  → 302 a la URL real de Supabase (coche desbloqueado).
//   - mode "b" (blurred) → JPEG procesado server-side con desenfoque fuerte
//     y oscurecido (coche bloqueado).
//   - mode "g" (game-blur) → imagen de juego del Túnel: recorte cuadrado en
//     el punto focal + desenfoque del ÚLTIMO intento horneado (api/_lib/
//     blur.js). El cliente añade blur CSS encima para los intentos previos;
//     como el gaussiano compone, quitar el CSS solo muestra el nivel final —
//     mismo principio que el crop ?z=5 del juego diario.
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

import sharp from "sharp";
import {
  verifyImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
  IMAGE_MODE_GAME_BLUR,
} from "./_lib/image-token.js";
import { serverSigmaPx } from "./_lib/blur.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { methodGuard } from "./_lib/http.js";

// Allowlists del modo game-blur. El srcset de CarImage pide 640/1280/1920 y
// avif/webp/jpeg; 1920 se clampa a 1280 — desenfocada, la diferencia es
// invisible y ahorra una cache key gorda de sharp por coche.
const GAME_WIDTHS = new Set([640, 1280]);
const GAME_FORMAT_MIME = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "HEAD"])) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.error(`[car-image] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const token = String(req.query?.t || "");
    if (!token) return res.status(400).json({ error: "Missing token" });

    const claims = verifyImageToken(token);
    if (!claims) return res.status(403).json({ error: "Invalid token" });

    // image_url es columna privilegiada → service_role. focus_x/focus_y solo
    // los consume el modo game-blur (centro del recorte cuadrado); pedirlos
    // siempre evita una segunda query y no filtran nada (no salen de aquí).
    const { data: row, error } = await supabaseAdmin
      .from("cars")
      .select("image_url, focus_x, focus_y")
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

    // ---- Modo GAME-BLUR: imagen de juego del Túnel de viento.
    // A diferencia del thumb "b" (160×200, oscurecido, decorativo), aquí la
    // imagen ES el juego: tamaño real, recorte cuadrado centrado en el punto
    // focal del coche (el contenedor del juego es 1:1) y el sigma del último
    // intento horneado. Honramos ?w y ?f para que el srcset AVIF/WebP de
    // CarImage funcione de verdad (una imagen borrosa en AVIF pesa KBs).
    if (claims.mode === IMAGE_MODE_GAME_BLUR) {
      const wRaw = Number(req.query?.w);
      // 1920 (u otro valor fuera de allowlist) clampa a 640; el srcset legítimo
      // solo pide tamaños del set, así que esto solo toca clientes obsoletos.
      const width = GAME_WIDTHS.has(wRaw) ? wRaw : 640;
      const fRaw = String(req.query?.f || "").toLowerCase();
      const format = fRaw in GAME_FORMAT_MIME ? fRaw : "jpeg";

      let upstream;
      try {
        upstream = await fetch(row.image_url);
      } catch (err) {
        console.error("[car-image] upstream fetch (game):", err);
        return res.status(502).json({ error: "Upstream unavailable" });
      }
      if (!upstream.ok) {
        console.error("[car-image] upstream status (game):", upstream.status);
        return res.status(502).json({ error: "Upstream error" });
      }
      const inputBuf = Buffer.from(await upstream.arrayBuffer());

      // Recorte cuadrado del lado menor centrado en (focus_x, focus_y), mismo
      // clamp de bordes que daily-image.js. Cuadrado porque el contenedor del
      // juego es 1:1: el resultado entra exacto sin recorte extra del cliente.
      // Ojo EXIF: metadata() da dimensiones FÍSICAS pre-rotación; si
      // orientation ≥ 5 el alto/ancho efectivos están intercambiados.
      let pipeline = sharp(inputBuf).rotate();
      try {
        const meta = await sharp(inputBuf).metadata();
        if (meta?.width && meta?.height) {
          const rotated90 = meta.orientation && meta.orientation >= 5;
          const W = rotated90 ? meta.height : meta.width;
          const H = rotated90 ? meta.width : meta.height;
          const fx =
            Number.isFinite(row.focus_x) && row.focus_x >= 0 && row.focus_x <= 1
              ? row.focus_x
              : 0.5;
          const fy =
            Number.isFinite(row.focus_y) && row.focus_y >= 0 && row.focus_y <= 1
              ? row.focus_y
              : 0.5;
          const size = Math.min(W, H);
          const left = Math.max(0, Math.min(W - size, Math.round(W * fx - size / 2)));
          const top = Math.max(0, Math.min(H - size, Math.round(H * fy - size / 2)));
          pipeline = pipeline.extract({ left, top, width: size, height: size });
        }
      } catch (err) {
        // Sin metadata seguimos sin recorte: mejor una imagen no cuadrada
        // (object-cover del cliente la encaja) que ninguna imagen.
        console.error("[car-image] game metadata:", err?.message || err);
      }

      // Blur DESPUÉS del resize: sobre menos píxeles es mucho más barato y el
      // sigma está definido en % del ancho FINAL (ver api/_lib/blur.js).
      pipeline = pipeline.resize(width, width, { fit: "cover" }).blur(serverSigmaPx(width));

      if (format === "avif") {
        // effort 2, igual que daily-image: subirlo dispara el cold start.
        pipeline = pipeline.avif({ quality: 60, effort: 2 });
      } else if (format === "webp") {
        pipeline = pipeline.webp({ quality: 75 });
      } else {
        pipeline = pipeline.jpeg({ quality: 78, mozjpeg: true, progressive: true });
      }

      const out = await pipeline.toBuffer();
      res.setHeader("Content-Type", GAME_FORMAT_MIME[format]);
      res.setHeader("Content-Length", String(out.length));
      res.setHeader("Content-Disposition", "inline");
      // Cache pública fuerte: el output es determinista por (carId, w, f) y el
      // token es igual para todos los usuarios → sharp corre UNA vez por coche
      // y combinación, no una por jugador. Es la clave de coste del Túnel.
      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=86400, immutable"
      );
      if (req.method === "HEAD") return res.status(200).end();
      return res.status(200).send(out);
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
