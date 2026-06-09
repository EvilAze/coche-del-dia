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
//
// PASO 3 (Edge Config): tras calentar, el cron escribe la URL del coche
// del día en Vercel Edge Config con la clave `daily_preload`. El
// middleware (middleware.js) la lee en <1ms e inyecta un `Link: rel=preload`
// en el HTML de la home, para que el navegador empiece a descargar la
// imagen hero EN PARALELO con el bundle JS (rompe el waterfall
// get-daily-car → daily-image). Requiere estas env vars adicionales:
//   - VERCEL_API_TOKEN  → token de cuenta Vercel con permiso de escritura
//   - EDGE_CONFIG_ID     → id del store (ecfg_...), visible en su dashboard
//   - VERCEL_TEAM_ID     → solo si el proyecto está bajo un team (opcional)
// Si faltan, el cron sigue calentando igual; solo se salta la escritura.
//
// PASO 4 (dificultad / DDA Arquitectura A): tras calentar, dispara la RPC
// recompute_car_difficulty() (service_role). Relee daily_stats atribuido a cada
// coche y deja en cars.suggested_zoom_base el zoom_base propuesto para que el
// admin lo revise. Va aquí (piggyback) en vez de en un cron propio para no
// superar el límite de 2 cron jobs del plan Hobby. Best-effort: si falla, el
// warming —que es el trabajo principal— no se ve afectado.
// Ver scripts/2026-06-difficulty-observatory.sql y api/cron/recalc-difficulty.js.

import { getSupabaseAdmin } from "../_lib/supabase.js";

/**
 * Escribe (upsert) un item en Vercel Edge Config vía REST API. La SDK
 * `@vercel/edge-config` es READ-ONLY; las escrituras van por la API HTTP.
 * No es fatal si falla: el warming es el trabajo principal, el Edge Config
 * es la optimización extra del preload.
 */
async function writeEdgeConfig(key, value) {
  const token = process.env.VERCEL_API_TOKEN;
  const configId = process.env.EDGE_CONFIG_ID;
  if (!token || !configId) {
    return { skipped: true, reason: "VERCEL_API_TOKEN / EDGE_CONFIG_ID ausentes" };
  }
  const url = new URL(`https://api.vercel.com/v1/edge-config/${configId}/items`);
  const teamId = process.env.VERCEL_TEAM_ID;
  if (teamId) url.searchParams.set("teamId", teamId);

  const r = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key, value }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    return { ok: false, status: r.status, body: body.slice(0, 200) };
  }
  return { ok: true, status: r.status };
}

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
  // CRÍTICO: usamos el dominio público de producción (cochedeldia.com), NO
  // la URL del deployment (*.vercel.app). Razón:
  //
  // Cuando Vercel dispara este cron, lo hace contra la URL del deployment.
  // Vercel infrastructure firma esa request inicial para que pase la
  // Deployment Protection que tienes activa por defecto en Hobby. PERO el
  // fetch que esta función hace internamente (cron → /api/get-daily-car)
  // sale como una request externa normal, sin esa firma. Si lo enviamos
  // a la URL del deployment, Deployment Protection lo bloquea con 401 y
  // el cron entero falla.
  //
  // El dominio público (cochedeldia.com) no tiene esa protección — es
  // accesible para cualquiera, así que el fetch interno pasa sin problema.
  //
  // `VERCEL_PROJECT_PRODUCTION_URL` lo setea Vercel automáticamente con
  // el host de producción (sin protocolo). Fallback al host header solo
  // para casos raros (env no inyectada, dev local con `vercel dev`).
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = productionHost || req.headers.host;
  if (!host) {
    return res.status(500).json({ error: "Missing host" });
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
        const r = await fetch(`${imageUrlBase}&z=5&f=avif&w=${w}`, {
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

    // ---- PASO 3: escribir el preload del día en Edge Config -------------
    // Guardamos `{ date, img }` para que el middleware (1) verifique que es
    // de hoy antes de inyectar el Link header (guard anti-stale si el cron
    // falla un día) y (2) construya el srcset/sizes a partir de `img`.
    // `body1.img` es exactamente `/api/daily-image?d=YYYY-MM-DD&v=HASH`,
    // la misma base que pide CarImage en el cliente.
    const step3Start = Date.now();
    const ecResult = await writeEdgeConfig("daily_preload", {
      date: body1.date,
      img: body1.img,
    });
    result.steps.push({
      step: "edge-config-write",
      ms: Date.now() - step3Start,
      ...ecResult,
    });

    // ---- PASO 4: recalcular dificultad por telemetría (DDA Arq. A) ------
    // Piggyback best-effort: relee daily_stats y deja suggested_zoom_base por
    // coche. NO usamos los fetches HTTP de arriba — llamamos la RPC directa con
    // service_role (la lógica vive en Supabase). Un fallo aquí no debe tumbar
    // el resultado del warming, así que va en su propio try/catch.
    const step4Start = Date.now();
    try {
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        result.steps.push({ step: "recalc-difficulty", skipped: true, reason: "admin envs ausentes" });
      } else {
        const { data, error } = await supabaseAdmin.rpc("recompute_car_difficulty");
        result.steps.push({
          step: "recalc-difficulty",
          ms: Date.now() - step4Start,
          ...(error
            ? { ok: false, error: error.message || "RPC failed" }
            : { ok: true, carsRecomputed: typeof data === "number" ? data : data ?? null }),
        });
      }
    } catch (err) {
      result.steps.push({
        step: "recalc-difficulty",
        ms: Date.now() - step4Start,
        ok: false,
        error: err?.message || "uncaught",
      });
    }

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
