// api/get-daily-car.js
// Endpoint del PRIMER PAINT: lo que el cliente pide nada más arrancar para
// saber qué coche es hoy, qué imagen pintar y en qué estado está la partida
// del usuario. Es el único request bloqueante del path crítico, así que aquí
// se nota cada milisegundo.
//
// ARQUITECTURA — Vercel Edge Function:
//   - Runtime "edge" (V8 isolate compartido) en vez de serverless Node.
//     Cold start típico <50 ms vs 200-500 ms del serverless. Para una
//     visita fresca (primera del día por región), esto solo ya recorta
//     ~300 ms al primer paint.
//   - Region pinneada a `fra1` (Frankfurt) — el más cercano a Supabase
//     EU y a la base de usuarios principal (es). Sin pin, el Edge se
//     ejecutaría cerca del visitante pero tendría que cruzar Atlántico
//     hasta Supabase EU — peor que el actual.
//
// HARDENING DE SEGURIDAD (preservado del handler Node anterior):
//   - NO se devuelve `id` del coche del día (antes permitía cruzarlo con
//     /api/list-cars y deducir marca/modelo/año).
//   - NO se devuelve la URL real del CDN. En su lugar apuntamos al proxy
//     /api/daily-image, que sirve los bytes desde nuestro servidor.
//   - Para usuarios logueados también devolvemos el estado guardado
//     (intentos, status, score) leyéndolo server-side de user_guesses,
//     para que el frontend no tenga que conocer el car_id.
//
// PARALELIZACIÓN DE I/O (lo nuevo en esta versión):
//   - pick_daily_car y auth.getUser() se ejecutan en paralelo: son
//     independientes y entre los dos solían sumar 250-500 ms en
//     secuencial.
//   - Después de tener carId: la lectura de cars.image_url y la
//     lectura de user_guesses se hacen en paralelo.
//   - Para partidas terminadas: la lectura de los datos del reveal
//     (marca/modelo/año/país) y la firma del revealToken corren a la vez.
//   En total: pasamos de 5 round-trips secuenciales a 3.

import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "./_lib/supabase.js";
import { todayInMadrid } from "./_lib/date.js";
import { signRevealToken } from "./_lib/edge/reveal-token.js";
import { readAnonTokenFromRequest, signAnonSession } from "./_lib/edge/anon-session.js";
import { sha1Hex } from "./_lib/edge/crypto.js";
import { logSessionStart } from "./_lib/edge/audit.js";
import { clampZoomBase } from "./_lib/zoom.js";
import { checkRateLimit, getClientIpEdge } from "./_lib/ratelimit.js";
import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./_lib/cors.js";
import { conTimeout, conTimeoutOFallback, TimeoutError, PLAZOS } from "./_lib/timeout.js";

// Intentos máximos de la partida diaria. Este valor viaja al cliente en la
// respuesta para que la UI no tenga que hardcodearlo — pero es SOLO
// informativo: la validación real (cortar la partida al 5º intento) vive en
// api/validate-guess.js con su propia constante, porque el servidor nunca
// puede fiarse de un valor que ha pasado por el navegador. Si cambias el
// número, cámbialo también allí.
const MAX_ATTEMPTS = 5;

export const config = {
  runtime: "edge",
  // Pinneamos a Frankfurt: el Edge se ejecuta físicamente cerca del
  // visitante por defecto, pero después tiene que hablar con Supabase
  // EU. Sin pin, un visitante en US ejecutaría en us-east → cruzaría
  // Atlántico cada query → peor latencia que el serverless EU actual.
  // Con `fra1`, todos los visitantes pagan el ping inicial a Frankfurt
  // (~30-150 ms según geo) pero las queries a Supabase son sub-20 ms.
  // Para la audiencia mayoritariamente española de cochedeldia.com es
  // el trade-off correcto.
  regions: ["fra1"],
};

// Helper de respuesta JSON con headers consistentes. Centralizar evita
// olvidar el Cache-Control no-store o el Content-Type en algún return.
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const h = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  return new Response(JSON.stringify(body), { status, headers: h });
}

// CORS para la app Android (origen https://localhost). En web (same-origin)
// devuelve {} → no añade headers.
function corsHeadersFor(request) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}

// Cliente Supabase con el JWT del usuario, llamada local porque el helper
// existente vive en auth.js que usa req.headers estilo Vercel. Aquí lo
// inline para que la cadena de imports sea estrictamente Edge-safe.
async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createAuthClient(accessToken);
    if (!client) return { client: null, user: null };
    // Con plazo, igual que la copia de _lib/auth.js, y con la misma distinción
    // entre «el token no vale» y «no hemos podido comprobarlo».
    //
    // Y aquí esa distinción importa MÁS que en el panel, porque la degradación
    // tentadora es la mala: si GoTrue no contesta, tratar al usuario como
    // anónimo NO es servir una versión reducida, es servirle un tablero
    // VACÍO. La rama anónima devuelve `guesses: []` y `status: "playing"`, y
    // el cliente no compensa con localStorage cuando hay sesión (useGame solo
    // lee el snapshot local `if (!session)`, y con razón: para un usuario
    // logueado la fuente de verdad es el servidor). O sea que quien llevara
    // tres intentos se encontraría la partida a cero a media mañana. Un 503
    // con el mensaje de siempre es mucho menos daño que eso.
    const { data, error } = await conTimeout(
      client.auth.getUser(),
      PLAZOS.AUTH,
      { etiqueta: "auth.getUser" }
    );
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch (err) {
    if (err instanceof TimeoutError) {
      return { client: null, user: null, timedOut: true };
    }
    return { client: null, user: null };
  }
}

export default async function handler(request) {
  // Preflight CORS de la app Android.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  }
  const cors = corsHeadersFor(request);
  // respond(): como jsonResponse pero mezclando los headers CORS.
  const respond = (body, init = {}) =>
    jsonResponse(body, { ...init, headers: { ...cors, ...(init.headers || {}) } });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    const missing = getMissingAdminEnvs();
    console.error(`[get-daily-car] missing env vars: ${missing.join(", ")}`);
    return respond({ message: "Server misconfigured" }, { status: 500 });
  }

  // Rate limit ANTES de tocar Supabase: get-daily-car hace un RPC por visita
  // (sin caché), así que es el endpoint que más conviene proteger de bots.
  // 60/min/IP es generoso para un humano (refrescos/reconexiones) pero corta
  // en seco a un script que itere. Fail-open: si Upstash falla, pasa igual.
  const ip = getClientIpEdge(request);
  const limit = await checkRateLimit(ip, { max: 60, windowSec: 60, prefix: "gdc" });
  if (!limit.ok) {
    return respond(
      { message: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const today = todayInMadrid();

  // Extraemos el token aquí para poder lanzar auth.getUser() en paralelo
  // con pick_daily_car. Ambas son independientes y entre las dos suelen
  // sumar 250-500 ms en secuencial.
  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  // FASE 1: arranque paralelo. Ni pick_daily_car ni la resolución de
  // sesión dependen del otro. El usuario anónimo paga solo pick_daily_car.
  // Cada rama con su plazo, y NO uno solo alrededor del Promise.all: así una
  // dependencia atrancada no arrastra a la otra, y en los logs se ve cuál de
  // las dos fue. El RPC devuelve la forma de PostgREST ({data, error}) para
  // que el fallo por plazo entre por el mismo `if (rpcErr)` de siempre.
  const [rpcResult, authResult] = await Promise.all([
    conTimeoutOFallback(
      supabaseAdmin.rpc("pick_daily_car", { p_date: today }),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "pick_daily_car sin respuesta a tiempo" } },
      { etiqueta: "pick_daily_car" }
    ),
    accessToken
      ? authClientAndUser(accessToken)
      : Promise.resolve({ client: null, user: null }),
  ]);

  // Auth atrancado con token presente → 503 y fuera. Ver la nota larga de
  // authClientAndUser: seguir como anónimo aquí le vacía el tablero a un
  // usuario que está a media partida.
  if (authResult.timedOut) {
    console.error("[get-daily-car] auth.getUser sin respuesta a tiempo");
    return respond(
      { message: "Auth temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const { data: todayCarId, error: rpcErr } = rpcResult;
  if (rpcErr || !todayCarId) {
    console.error("[get-daily-car] pick_daily_car:", rpcErr);
    // 503 y no 500: sin coche del día no hay juego, pero esto se arregla solo
    // en cuanto la base vuelva. El 500 invitaba a buscar un bug que no existe.
    return respond(
      { message: "Failed to pick daily car" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  const { client: authClient, user } = authResult;

  // AUDITORÍA: registra la PRIMERA visita del día por (user|ip + día).
  // Deliberadamente SIN await — el insert vuela en background; Vercel Edge
  // deja que las fetches en vuelo se completen tras devolver la Response.
  // Dedupe en memoria de la instancia warm evita filas por cada F5.
  logSessionStart({
    request,
    userId: user?.id || null,
    isAnon: !user,
    gameDate: today,
    carId: todayCarId,
  }).catch(() => {});

  // FASE 2: con carId resuelto, paralelizamos:
  //   - Lectura de image_url + blur_data (necesarios para construir el
  //     URL del proxy + el LQIP).
  //   - Si hay usuario, lectura de su user_guesses (status + guesses).
  //
  // Para anónimos, la rama de user_guesses cae a un resolve(null) y solo
  // hacemos la lectura de imagen.
  const [imgResult, gameResult] = await Promise.all([
    conTimeoutOFallback(
      supabaseAdmin
        .from("cars")
        .select("image_url, blur_data, zoom_base")
        .eq("id", todayCarId)
        .maybeSingle(),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "read image_url sin respuesta a tiempo" } },
      { etiqueta: "read image_url" }
    ),
    user
      ? conTimeoutOFallback(
          authClient
            .from("user_guesses")
            .select("guesses, status")
            .eq("user_id", user.id)
            .eq("car_id", todayCarId)
            .eq("date", today)
            .maybeSingle(),
          PLAZOS.SUPABASE,
          { data: null, error: { message: "read user_guesses sin respuesta a tiempo" } },
          { etiqueta: "read user_guesses" }
        )
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data: imgRow, error: imgRowErr } = imgResult;
  if (imgRowErr) {
    // Si falla la lectura de image_url, seguimos sin versión (cache "vieja"
    // hasta el TTL natural). Es estrictamente mejor que romper la home.
    console.error("[get-daily-car] read image_url:", imgRowErr);
  }

  // Zoom base del coche de hoy. El cliente lo usa para calcular los scales CSS
  // por intento; clampZoomBase cae al default 3.7 si la columna no existe aún.
  const zoomBase = clampZoomBase(imgRow?.zoom_base);

  // Cache-buster sha1 corto. Si admin reemplaza la foto desde
  // /admin/edit-car, image_url cambia → hash cambia → CDN sirve la nueva
  // al instante. Si solo edita texto, image_url no se toca y el CDN
  // mantiene el hit caliente. Incluimos también el zoom_base: si admin ajusta
  // la dificultad del coche del día, el crop que sirve daily-image cambia, así
  // que el hash debe invalidar la entrada cacheada.
  const imgVersion = imgRow?.image_url
    ? (await sha1Hex(`${imgRow.image_url}:${zoomBase}`)).slice(0, 8)
    : "0";
  const dailyImgUrl = `/api/daily-image?d=${today}&v=${imgVersion}`;
  const blurData = imgRow?.blur_data || null;

  const base = {
    date: today,
    img: dailyImgUrl,
    blurData,
    zoomBase,
    maxAttempts: MAX_ATTEMPTS,
    guesses: [],
    status: "playing",
    reveal: null,
  };

  // -------- RAMA ANÓNIMA -------------------------------------------------
  if (!user) {
    // Token de sesión anónima firmado (HMAC). Antes era una cookie HttpOnly;
    // ahora viaja en el body para que la app Android (origen distinto) no
    // dependa de cookies cross-site. El cliente lo guarda en localStorage y lo
    // reenvía en el header X-Anon-Session.
    const incoming = await readAnonTokenFromRequest(request);
    const valid =
      incoming &&
      incoming.d === today &&
      Number.isInteger(incoming.n) &&
      typeof incoming.s === "string";

    const session = valid ? incoming : { d: today, n: 0, s: "playing" };

    let anonToken = null;
    try {
      anonToken = await signAnonSession(session);
    } catch (err) {
      // Si REPESCA_TOKEN_SECRET no está configurado, el usuario juega sin
      // token; validate-guess se quejará pero la home no rompe.
      console.error("[get-daily-car] signAnonSession:", err?.message || err);
    }

    // Partida cerrada (ganada O perdida) → imagen completa. La asimetría
    // anterior (solo al anónimo que ganaba) sostenía el muro del perdedor
    // anónimo; ese muro se retiró en validate-guess (ver la nota larga de su
    // «Política de revelado»), así que aquí se sigue el mismo criterio o la
    // foto volvería a recortarse al recargar.
    //
    // La IDENTIDAD del coche no viaja por aquí en la rama anónima: el anónimo
    // no tiene partida en servidor (base.guesses va vacío) y su estado —
    // incluido el `reveal` que devolvió validate-guess— vive en el snapshot
    // de localStorage que lee useGame.
    let revealToken = null;
    if (valid && (session.s === "won" || session.s === "lost")) {
      try {
        revealToken = await signRevealToken(today);
      } catch (err) {
        console.error("[get-daily-car] signRevealToken (anon):", err?.message || err);
      }
    }

    return respond({ ...base, anonToken, revealToken });
  }

  // -------- RAMA LOGUEADA ------------------------------------------------
  const { data: gameRow, error: gameErr } = gameResult;
  if (gameErr) {
    console.error("[get-daily-car] read user_guesses:", gameErr);
    // 503, no `respond(base)`. Devolver `base` era servirle al usuario un
    // tablero A CERO: `base.guesses` va vacío y `base.status` es "playing",
    // y el cliente no lo compensa con localStorage porque para una sesión
    // iniciada la fuente de verdad es el servidor. Quien llevara tres intentos
    // veía la partida en blanco y —peor— podía volver a jugarla desde el
    // principio contra un servidor que sí recuerda los intentos gastados.
    // Un error honesto es mejor que un estado inventado.
    return respond(
      { message: "Game state temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const status = gameRow?.status || "playing";
  const guesses = Array.isArray(gameRow?.guesses) ? gameRow.guesses : [];

  // Si la partida está cerrada (won|lost), necesitamos:
  //   - Datos LIVE del coche para el reveal (no la copia congelada en
  //     user_guesses — así una corrección de admin se refleja al instante).
  //   - revealToken firmado para que /api/daily-image sirva imagen completa.
  // Las dos operaciones son independientes; las paralelizamos.
  let reveal = null;
  let revealToken = null;
  if (status === "won" || status === "lost") {
    const isWon = status === "won";
    const [liveResult, signedToken] = await Promise.all([
      conTimeoutOFallback(
        supabaseAdmin
          .from("cars")
          .select("make, model, year, pais, description, description_en, video_id")
          .eq("id", todayCarId)
          .maybeSingle(),
        PLAZOS.SUPABASE,
        { data: null, error: { message: "read cars (live) sin respuesta a tiempo" } },
        { etiqueta: "read cars (live)" }
      ),
      signRevealToken(today).catch((err) => {
        console.error("[get-daily-car] signRevealToken:", err?.message || err);
        return null;
      }),
    ]);

    if (liveResult.error) {
      console.error("[get-daily-car] read cars (live):", liveResult.error);
    } else if (liveResult.data) {
      const liveCar = liveResult.data;
      reveal = {
        marca: liveCar.make,
        modelo: liveCar.model,
        anio: liveCar.year,
        pais: liveCar.pais,
        // Descripción/ficha: SOLO en victoria. La identidad del coche
        // (marca, modelo, año, país) se revela en ambos casos para que
        // el usuario sepa qué falló. La ficha de lore queda reservada
        // como recompensa para victorias.
        //
        // El gate faltaba: `isWon` se calculaba y no se usaba, así que al
        // recargar una partida PERDIDA llegaba la ficha completa — justo lo
        // que este comentario dice que no debe pasar (y que validate-guess sí
        // respeta en el momento de perder). Corregido al unificar la política.
        description: isWon ? liveCar.description ?? null : null,
        description_en: isWon ? liveCar.description_en ?? null : null,
        // El vídeo va con la IDENTIDAD y no con la ficha (gane o pierda), y por
        // eso no lleva el gate de `isWon` — el porqué está en validate-guess,
        // paso 9. Esta rama es la que reconstruye el reveal al RECARGAR una
        // partida ya cerrada: sin ella, el vídeo estaba en el panel al terminar
        // y desaparecía al refrescar la página, que es peor que no estar.
        videoId: liveCar.video_id ?? null,
      };
    }
    revealToken = signedToken;
  }

  return respond({
    date: today,
    img: dailyImgUrl,
    blurData,
    zoomBase,
    maxAttempts: MAX_ATTEMPTS,
    guesses,
    status,
    reveal,
    revealToken,
  });
}
