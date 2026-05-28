// api/cron/warm-daily.js
// Cron diario que pre-calienta el path crítico del primer paint del día:
//
//   1. Llama a /api/get-daily-car → fuerza pick_daily_car a fijar el coche
//      del día en daily_cars, y calienta la Edge Function en fra1.
//   2. Para las 3 variantes AVIF del crop z=5 (640/1280/1920 px), hace
//      GET a /api/daily-image → fuerza el cold start de sharp y popula el
//      Vercel CDN cache con las respuestas (cache-control public,
//      s-maxage=86400). Las siguientes peticiones de usuarios reales a
//      esas mismas URLs son cache hits sin tocar serverless.
//
// LIMITACIONES HONESTAS (lee esto antes de creer que arregla todo):
//   - Sharp cold-start se calienta, pero las funciones serverless se
//     enfrían tras ~5-15 minutos de idle. Si tu primer visitante real del
//     día llega 1h después del cron, sharp estará frío otra vez. Lo que
//     sí persiste 24h es el CDN cache: las URLs AVIF que el cron pidió
//     se sirven desde edge sin tocar la función, ahí sí ganamos.
//   - El CDN cache de Vercel es regional. La región exacta que cachea
//     depende de dónde se ejecute esta función (típicamente iad1 / la
//     región default del proyecto). Usuarios en regiones lejanas
//     (Asia, Sudamérica) pueden seguir pagando la primera petición.
//     Para una audiencia mayoritariamente española servida desde edges
//     EU, la cobertura es alta.
//
// AUTH: Vercel añade automáticamente `Authorization: Bearer ${CRON_SECRET}`
// a las peticiones que dispara el scheduler. Verificamos aquí para que
// nadie externo pueda spamear el endpoint. CRON_SECRET tienes que
// configurarlo manualmente en el dashboard de Vercel (Settings → Env Vars).

export default async function handler(req, res) {
  // ---- AUTH --------------------------------------------------------------
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[cron/warm-daily] CRON_SECRET env var not configured");
    return res.status(500).json({ error: "Cron secret not configured" });
  }
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${expectedSecret}`) {
    // No logueamos el header recibido para no filtrar secrets a logs.
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- BASE URL para fetches internos -----------------------------------
  // Usamos el header `host` que llega en la request del cron. Vercel lo
  // pone con el dominio del deployment activo (cochedeldia.com en prod).
  const host = req.headers.host;
  if (!host) {
    return res.status(500).json({ error: "Missing host header" });
  }
  const baseUrl = `https://${host}`;

  const result = {
    ok: false,
    startedAt: new Date().toISOString(),
    steps: [],
    totalMs: 0,
  };
  const t0 = Date.now();

  try {
    // ---- PASO 1: get-daily-car ------------------------------------------
    // Calienta la Edge function en fra1 y dispara pick_daily_car. El
    // primer visitante humano del día llegará con el daily_cars row ya
    // fijado (lectura plana en vez de inserción + lock).
    const step1Start = Date.now();
    const r1 = await fetch(`${baseUrl}/api/get-daily-car`, {
      headers: { "User-Agent": "VercelCron/warm-daily" },
    });
    let body1 = null;
    try {
      body1 = await r1.json();
    } catch {
      // Si la respuesta no es JSON (p.ej. error 500 HTML), seguimos con body1=null.
    }
    result.steps.push({
      step: "get-daily-car",
      status: r1.status,
      ms: Date.now() - step1Start,
      img: body1?.img || null,
      date: body1?.date || null,
    });

    if (!r1.ok || !body1?.img) {
      result.totalMs = Date.now() - t0;
      console.error("[cron/warm-daily] get-daily-car failed:", r1.status);
      return res.status(500).json({ ...result, error: "get-daily-car failed" });
    }

    // ---- PASO 2: daily-image AVIF × 3 anchos en paralelo ----------------
    // Solo AVIF: es el formato que sirve a >90% de visitantes modernos
    // (Chrome, Edge, Firefox 93+, Safari 16+). WebP y JPEG fallback se
    // generarán bajo demanda cuando llegue su primer visitante (raro);
    // calentarlos también triplicaría las requests de este cron sin ganancia
    // material.
    //
    // Consumimos arrayBuffer() para que el upstream complete la respuesta
    // y el CDN la guarde. Si solo leyésemos los headers, Vercel podría
    // cancelar el stream antes de cachear.
    const widths = [640, 1280, 1920];
    const imageUrlBase = `${baseUrl}${body1.img}`;
    const step2Start = Date.now();
    const settled = await Promise.allSettled(
      widths.map(async (w) => {
        const r = await fetch(`${imageUrlBase}&f=avif&w=${w}`, {
          headers: { "User-Agent": "VercelCron/warm-daily" },
        });
        await r.arrayBuffer();
        return { width: w, status: r.status, bytes: r.headers.get("content-length") || null };
      })
    );
    result.steps.push({
      step: "daily-image-avif",
      ms: Date.now() - step2Start,
      results: settled.map((s, i) =>
        s.status === "fulfilled"
          ? s.value
          : { width: widths[i], error: s.reason?.message || "unknown" }
      ),
    });

    result.ok = true;
    result.totalMs = Date.now() - t0;
    return res.status(200).json(result);
  } catch (err) {
    result.totalMs = Date.now() - t0;
    console.error("[cron/warm-daily] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      ...result,
      error: err?.message || "Internal error",
    });
  }
}
