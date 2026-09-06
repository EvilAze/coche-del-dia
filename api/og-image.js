// api/og-image.js
// La tarjeta Open Graph VIVA: el recorte del coche de hoy, montado sobre la
// portada del periódico. Es lo que ve alguien cuando pegan un enlace de
// cochedeldia.com en WhatsApp, Telegram, Discord o X.
//
// POR QUÉ EXISTE
// El og:image era un JPEG estático (public/og-image.jpg) con una foto de stock,
// idéntico todos los días desde hace meses. En un juego de FOTOS diarias eso es
// tirar a la basura el único escaparate gratis que tenemos: en un grupo de
// aficionados al motor, lo que detiene el scroll es un coche, no un wordmark.
// Cada vez que un jugador comparte su resultado, la tarjeta debería enseñar el
// coche de ese día. Convierte cada compartición en un teaser jugable.
//
// QUÉ SE ENSEÑA Y POR QUÉ NO FILTRA NADA (regla 5)
// El recorte del INTENTO 1 — el más cerrado de todos (zoom máximo, un faro, una
// llanta). La regla prohíbe servir más imagen de la que ve un jugador legítimo
// en el intento 5, que es la vista MÁS ABIERTA; el intento 1 está en el extremo
// contrario, así que va sobradamente dentro. Y no da ventaja: es exactamente lo
// que ese mismo visitante verá al abrir la web un segundo después.
//
// El crop se calcula con `cropPctForAttempt` de _lib/zoom.js, la misma fuente
// que usa daily-image.js. Nada de reimplementar la fórmula aquí (regla 7).
//
// SI ALGO FALLA, LA TARJETA NO SE ROMPE (regla 9)
// Cualquier error —Supabase caído, el CDN de la imagen sin responder, sharp
// petardeando— cae a un 302 hacia /og-image.jpg, el respaldo estático que sigue
// versionado en public/. Un preview con la tarjeta genérica es infinitamente
// mejor que un enlace sin preview, que en un chat parece un enlace roto.

import sharp from "sharp";
import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { methodGuard } from "./_lib/http.js";
import { todayInMadrid } from "./_lib/date.js";
import { clampZoomBase, cropPctForAttempt } from "./_lib/zoom.js";
import { componerTarjetaOG } from "./_lib/og-card.js";
import { leerImagenOrigen } from "./_lib/imagen-origen.js";
import { decodeResult } from "./_lib/result-code.js";

// Intento cuyo encuadre se publica. 1 = el más cerrado. Ver la nota de arriba.
const INTENTO = 1;

/**
 * Segundos que faltan para la medianoche de Madrid. Es la vida útil exacta de
 * esta tarjeta: a las 00:00 hay coche nuevo y la de hoy deja de ser cierta.
 * Con suelo de 60s para no emitir un max-age de 0 justo en el cambio de día.
 */
function segundosHastaMedianocheMadrid() {
  const ahora = new Date();
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(ahora);
  const get = (t) => parseInt(partes.find((p) => p.type === t)?.value ?? "0", 10);
  const transcurridos = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.max(60, 86400 - transcurridos);
}

function caerAlRespaldo(res, motivo) {
  console.error("[og-image] respaldo estático:", motivo);
  // 302 y no 301: el fallo es transitorio y no queremos que un crawler se
  // quede con "esta URL es la estática" grabado para siempre.
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Location", "/og-image.jpg");
  return res.status(302).end();
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "HEAD"])) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return caerAlRespaldo(res, `envs: ${getMissingAdminEnvs().join(", ")}`);
    }

    const hoy = todayInMadrid();

    // 1) Coche del día. Misma RPC que daily-image: una sola fuente de verdad
    //    sobre qué coche toca hoy.
    const { data: carId, error: rpcErr } = await supabaseAdmin.rpc("pick_daily_car", {
      p_date: hoy,
    });
    if (rpcErr || !carId) return caerAlRespaldo(res, `pick_daily_car: ${rpcErr?.message}`);

    // 2) URL real del CDN + punto focal + dificultad. NADA de esto sale de
    //    este proceso: lo que se publica es el JPEG ya compuesto.
    const { data: row, error: filaErr } = await supabaseAdmin
      .from("cars")
      .select("image_url, focus_x, focus_y, zoom_base")
      .eq("id", carId)
      .single();
    if (filaErr || !row?.image_url) {
      return caerAlRespaldo(res, `fila del coche: ${filaErr?.message}`);
    }

    const zoomBase = clampZoomBase(row.zoom_base);
    const enRango = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
    const focusX = enRango(row.focus_x) ? row.focus_x : 0.5;
    const focusY = enRango(row.focus_y) ? row.focus_y : 0.5;

    // 3) Bytes de origen, por el MISMO helper que daily-image: prefiere el
    //    máster WebP (misma resolución, la mitad de peso) y cae al original si
    //    ese coche aún no lo tiene. El `fetch` a pelo que había aquí se traía
    //    el ORIGINAL ENTERO (~1,3 MB) para acabar publicando una tarjeta de
    //    1200×630, y no se paga una sola vez: cada plataforma social revalida
    //    el preview por su cuenta, y el `?r=` de cada partida compartida es una
    //    URL distinta que vuelve a entrar aquí en frío.
    //
    //    De propina entra el plazo de PLAZOS.CDN (regla 21): esto era un fetch
    //    sin fecha de caducidad, así que un Storage atrancado se comía el
    //    presupuesto entero de la función y acababa en un 504 en vez de en el
    //    respaldo estático, que es justo lo que caerAlRespaldo existe para
    //    evitar.
    const origen = await leerImagenOrigen(row.image_url);
    if (!origen) return caerAlRespaldo(res, "imagen de origen no disponible");
    const original = origen.buffer;

    // 4) Recorte del intento 1. Calcado de daily-image.js, incluida la
    //    corrección de EXIF: sharp.metadata() da las dimensiones FÍSICAS,
    //    anteriores a la orientación, así que con orientation ≥ 5 el ancho y
    //    el alto reales están intercambiados. Sin esto, una foto vertical de
    //    móvil recorta por donde no es.
    const meta = await sharp(original).metadata();
    let recorte = sharp(original).rotate(); // rotate() aplica el EXIF
    if (meta?.width && meta?.height) {
      const girada = meta.orientation && meta.orientation >= 5;
      const ancho = girada ? meta.height : meta.width;
      const alto = girada ? meta.width : meta.height;
      const lado = Math.max(
        1,
        Math.round(Math.min(ancho, alto) * cropPctForAttempt(INTENTO, zoomBase))
      );
      // Clamp a los bordes: con el foco cerca de una esquina, el cuadrado se
      // "pega" al borde en vez de salirse.
      const left = Math.max(0, Math.min(ancho - lado, Math.round(ancho * focusX - lado / 2)));
      const top = Math.max(0, Math.min(alto - lado, Math.round(alto * focusY - lado / 2)));
      recorte = recorte.extract({ left, top, width: lado, height: lado });
    }
    const foto = await recorte.toBuffer();

    // 5) La portada. Con `?r=` viene la partida de quien compartió el enlace y
    //    la tarjeta lleva su rejilla; sin él sale genérica (el caso de quien
    //    entra a la home directamente, sin venir del enlace de nadie).
    //
    //    El código llega de una URL pública que cualquiera puede teclear, así
    //    que decodeResult está escrito para no lanzar jamás: la basura acaba en
    //    una lista vacía y la tarjeta sale genérica. Falsificarlo es posible
    //    —se puede escribir "7" y presumir de haberlo sacado a la primera—
    //    igual que en Wordle se puede teclear la rejilla a mano. Son derechos
    //    de fanfarronería, no un saldo.
    const codigo = new URL(req.url, "https://cochedeldia.com").searchParams.get("r");
    const intentos = codigo ? decodeResult(codigo) : null;
    const tarjeta = await componerTarjetaOG(foto, { intentos });

    // 6) Cache hasta la medianoche de Madrid, que es cuando deja de ser cierta.
    //    Las plataformas sociales cachean por su cuenta y de forma bastante
    //    caprichosa; esto es lo máximo que podemos declarar. Lo que de verdad
    //    fuerza un preview nuevo cada día es que el enlace compartido lleve la
    //    fecha (ver buildShareText en src/lib/shareText.js).
    const ttl = segundosHastaMedianocheMadrid();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", String(tarjeta.length));
    res.setHeader(
      "Cache-Control",
      `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=86400`
    );
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(tarjeta);
  } catch (err) {
    return caerAlRespaldo(res, err?.message || String(err));
  }
}
