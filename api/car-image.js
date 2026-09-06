// api/car-image.js
// Proxy de imagen para el Garaje. Recibe un token opaco
// firmado/cifrado con AES-GCM (ver api/_lib/image-token.js) y devuelve:
//   - mode "c" (clear)  → la portada del cromo desbloqueado, ya redimensionada.
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
//
// ── POR QUÉ EL MODO CLEAR YA NO REDIRIGE (septiembre de 2026) ──
//
// Hasta ahora un cromo desbloqueado se servía con un 302 a la URL pública de
// Supabase Storage. Sonaba a ahorro —"no gastamos ancho de banda de nuestra
// función"— y era justo lo contrario: mandaba a CADA navegador a descargarse
// el ORIGINAL ENTERO (~1,3 MB, ~2700 px de lado corto) para pintarlo en una
// miniatura de 170 px de la rejilla del Archivo. Y como el 302 saca la
// petición de nuestro dominio, el CDN de Vercel no cachea NADA: el coste no
// se pagaba una vez por coche, sino una vez por jugador y por hora
// (`max-age=3600`), contra la cuota de Supabase.
//
// Las cuentas de por qué esto se comió el plan gratuito: el archivo crece con
// cada partida ganada, así que el consumo sube solo aunque no entre gente
// nueva. Con ~213 cuentas y ~30 cromos cada una, UNA pasada completa del
// Archivo son ~8 GB. La cuota entera son 5,5 GB.
//
// Ojo con el matiz, porque es el que engaña: el arreglo de agosto
// (`perf(imagenes)`, máster WebP + caché de proceso en imagen-origen.js) tocó
// solo `daily-image`, que era precisamente la ruta que YA iba cacheada en
// Vercel. Esta de aquí, que es la que escala con el número de jugadores, se
// quedó fuera. De ahí que el egress subiera DESPUÉS de optimizarlo.
//
// Ahora servimos los bytes nosotros, con dos consecuencias:
//   1. El CDN de Vercel se pone delante. Supabase sirve el original una vez
//      por coche y semana, no una vez por jugador y hora.
//   2. Pasamos por `leerImagenOrigen` (máster WebP + caché del proceso) y
//      redimensionamos. El cromo baja de ~1,3 MB a decenas de KB.
// De regalo, la URL real del CDN —que lleva marca-modelo-año en el nombre del
// fichero— deja de llegar al navegador también para los desbloqueados.

import sharp from "sharp";
import {
  verifyImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
} from "./_lib/image-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { leerImagenOrigen } from "./_lib/imagen-origen.js";
import { versionDePortada } from "./_lib/version-imagen.js";
import { methodGuard } from "./_lib/http.js";

// Anchuras permitidas para la portada. Allowlist estricta por el mismo motivo
// que en daily-image: un `?w` libre es un DoS por resize a tamaños absurdos, y
// además cada valor nuevo es otra entrada de caché que calentar.
const ANCHURAS_PORTADA = new Set([320, 640, 1080]);

// Por defecto servimos la GRANDE, no la de la rejilla. El mismo `car.img`
// alimenta dos sitios: la miniatura del álbum (~170 px CSS) y el detalle del
// cromo, que es un ModalShell `max-w-sm` — ~350 px CSS, o sea ~1050 físicos en
// un móvil a DPR 3. Servir 640 dejaría el detalle visiblemente blando, y el
// detalle es justo donde el jugador va a MIRAR el coche que se ha ganado.
// Recortar la rejilla a 320/640 es la segunda vuelta, y hay que hacerla desde
// el front (añadir `&w=` a los `<img>` de Garage.jsx): eso sí viaja en el APK,
// así que va en su propia entrega con su subida de versión.
const ANCHURA_POR_DEFECTO = 1080;

function anchuraPedida(query) {
  const w = Number.parseInt(String(query?.w ?? ""), 10);
  return ANCHURAS_PORTADA.has(w) ? w : ANCHURA_POR_DEFECTO;
}

// ── LAS TRES CACHÉS, Y POR QUÉ SON TRES ──────────────────────────────────────
//
// El problema de fondo: el token es determinista por (carId, mode) —tiene que
// serlo, o el navegador no cachearía nada entre renders del Garaje— así que la
// URL de un cromo sería la MISMA para siempre. Con una caché eterna, la foto
// que el admin sustituye no se vería nunca más.
//
// Lo resuelve el `v` que emite garage.js: un hash corto de image_url. Cambiar
// la foto cambia la ruta en el Storage (EditCarPanel sube a `${Date.now()}-…`
// con upsert:false, nunca pisa una ruta), cambia el hash y cambia la URL. Con
// eso `immutable` pasa a ser seguro, y el egress contra Supabase se va a cero:
// una descarga por coche y ya, en vez de una por PoP y semana.
//
// ETERNA: el camino normal. Todo lo que emite garage.js hoy cae aquí.
const CACHE_VERSIONADA = "public, max-age=31536000, immutable";
//
// SIN `v`: una URL emitida ANTES de este cambio y que sigue viva en el
// navegador de alguien o en un payload de /api/garage ya servido. Se sirve
// igual —romperlas sería dejar el álbum sin fotos hasta recargar— pero con la
// caché conservadora de siempre, que no puede quedarse clavada.
const CACHE_SIN_VERSION = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
//
// `v` QUE NO CUADRA: o un cliente con el payload viejo justo después de que el
// admin cambiara la foto, o alguien inventándose valores. En los dos casos
// servimos la foto BUENA (nadie se queda sin cromo), pero en caché PRIVADA:
// una respuesta con `v` arbitrario no puede crear entradas en el CDN
// compartido, o inventarse valores sería una forma barata de forzar fallos de
// caché en cadena — exactamente el gasto que este PR viene a cerrar. El
// cliente se cura solo en su siguiente /api/garage.
const CACHE_DESCUADRADA = "private, max-age=60";

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

    if (claims.mode !== IMAGE_MODE_CLEAR && claims.mode !== IMAGE_MODE_BLURRED) {
      // Defensa en profundidad — verifyImageToken ya valida esto.
      return res.status(400).json({ error: "Unsupported mode" });
    }

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

    // Los bytes de origen, para los dos modos: prefiere el máster WebP (misma
    // resolución, la mitad de peso) y reaprovecha la caché del proceso, que en
    // una instancia caliente sirve varios cromos con una sola descarga.
    // `leerImagenOrigen` nunca lanza por el máster: si no existe, cae al
    // original y ya.
    const origen = await leerImagenOrigen(row.image_url);
    if (!origen) {
      return res.status(502).json({ error: "Upstream unavailable" });
    }

    // ---- Modo CLEAR: desbloqueado. La portada, a tamaño de portada.
    if (claims.mode === IMAGE_MODE_CLEAR) {
      const ancho = anchuraPedida(req.query);
      let outBuffer = origen.buffer;
      let outContentType = origen.contentType;
      try {
        outBuffer = await sharp(origen.buffer)
          .rotate() // respeta EXIF orientation por si el original viene rotado
          // `inside` + `withoutEnlargement`: acota el lado largo sin deformar
          // ni estirar un original que ya fuera más pequeño. El detalle del
          // cromo usa object-contain, así que la proporción tiene que
          // sobrevivir intacta.
          .resize(ancho, ancho, { fit: "inside", withoutEnlargement: true })
          // 82 y smartSubsample: el cromo se mira de cerca en el detalle, pero
          // no lleva el zoom bestia del juego (donde daily-image sube a 90).
          .webp({ quality: 82, smartSubsample: true })
          .toBuffer();
        outContentType = "image/webp";
      } catch (err) {
        // Si sharp falla (input corrupto, OOM, formato raro) servimos el
        // origen tal cual: mejor una portada pesada que un hueco en el álbum.
        console.error("[car-image] sharp portada:", err?.message || err);
      }

      const vPedida = req.query?.v ? String(req.query.v) : null;
      const vEsperada = await versionDePortada(row.image_url);
      const cache = !vPedida
        ? CACHE_SIN_VERSION
        : vPedida === vEsperada
          ? CACHE_VERSIONADA
          : CACHE_DESCUADRADA;

      res.setHeader("Content-Type", outContentType);
      res.setHeader("Content-Length", String(outBuffer.length));
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", cache);
      if (req.method === "HEAD") return res.status(200).end();
      return res.status(200).send(outBuffer);
    }

    // ---- Modo BLURRED: bloqueado. Procesamos en memoria con sharp.
    //
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
    const out = await sharp(origen.buffer)
      .rotate() // respeta EXIF orientation por si el original viene rotado
      .resize(160, 200, { fit: "cover", position: "center" })
      .blur(5)
      .modulate({ brightness: 0.45 })
      .jpeg({ quality: 50, mozjpeg: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(out.length));
    res.setHeader("Content-Disposition", "inline");
    // El bloqueado NO lleva `v` (ver versionDePortada: sería un identificador
    // estable del fichero real de un coche que el jugador no ha ganado), así
    // que se queda con la caché conservadora: no puede ser eterna porque su
    // URL no cambiaría al sustituir la foto. Da igual para la factura — son
    // 3-5 KB de JPEG borroso, no el original.
    res.setHeader("Cache-Control", CACHE_SIN_VERSION);

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
