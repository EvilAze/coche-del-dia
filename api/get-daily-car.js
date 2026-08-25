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
//   - coche_de_hoy y auth.getUser() se ejecutan en paralelo: son
//     independientes y entre los dos solían sumar 250-500 ms en
//     secuencial.
//   - Después de tener carId: la lectura de cars.image_url y la
//     lectura de user_guesses se hacen en paralelo.
//   - Para partidas terminadas: la lectura de los datos del reveal
//     (marca/modelo/año/país) y la firma del revealToken corren a la vez.
//   En total: pasamos de 5 round-trips secuenciales a 3.

import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { authClientAndUser } from "./_lib/auth.js";
import { todayInMadrid } from "./_lib/date.js";
import { signRevealToken } from "./_lib/edge/reveal-token.js";
import { readAnonTokenFromRequest, signAnonSession } from "./_lib/edge/anon-session.js";
import { logSessionStart } from "./_lib/edge/audit.js";
import { versionDeImagen } from "./_lib/version-imagen.js";
import { resolverCocheDelUsuario } from "./_lib/coche-de-hoy.js";
import { sellosDe } from "./_lib/sello.js";
import { clampZoomBase } from "./_lib/zoom.js";
import { checkRateLimit, getClientIpEdge } from "./_lib/ratelimit.js";
import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./_lib/cors.js";
import {
  conTimeoutOFallback,
  conTimeoutReintentando,
  fuePorPlazo,
  PLAZOS,
} from "./_lib/timeout.js";

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

/**
 * Qué coche es el de hoy y qué salientes tiene, RESPALDO INCLUIDO.
 *
 * Vive en una función —y no suelto en el handler— por dos motivos que son el
 * mismo: así el respaldo cabe DENTRO de la fase paralela, corriendo a la vez
 * que la resolución de identidad en vez de detrás de ella. Cuando el respaldo
 * colgaba del handler, sus plazos se sumaban EN SERIE a los de auth y el peor
 * caso encadenado se iba a 31,5 s — por encima de los 25 s del Edge, o sea el
 * 504 con cuerpo HTML que la regla 21 existe para eliminar. Aquí la resolución
 * entera (RPC + respaldo) queda acotada por PLAZOS.SUPABASE × 2, que es lo que
 * ya costaba antes de haber respaldo, y el `max()` con auth se la come.
 *
 * @returns {Promise<{carId?: string, prevCarIds?: string[], salientesDesconocidos?: boolean, fallo?: "plazo"|"sin-coche"}>}
 */
async function resolverElDia(supabaseAdmin, today) {
  // coche_de_hoy() = pick_daily_car() + los salientes del día, en un solo
  // viaje. Los salientes hacen falta para anclar a quien ya estaba jugando
  // cuando se cambió el coche por emergencia, y leerlos aparte añadiría un
  // round-trip al único request bloqueante del primer paint.
  //
  // Con reintento: sin coche del día no hay juego, así que es la lectura que
  // menos nos podemos permitir dar por perdida a la primera. La RPC es
  // idempotente (fija el coche de la fecha y después lo devuelve), así que
  // repetirla no tiene efectos.
  const rpcResult = await conTimeoutReintentando(
    () => supabaseAdmin.rpc("coche_de_hoy", { p_date: today }),
    PLAZOS.SUPABASE,
    { data: null, error: { message: "coche_de_hoy sin respuesta a tiempo" } },
    { etiqueta: "coche_de_hoy" }
  );

  // `returns table` → PostgREST devuelve un array de filas.
  const fila = rpcResult.data?.[0] || null;
  if (!rpcResult.error && fila?.car_id) {
    return { carId: fila.car_id, prevCarIds: fila.prev_car_ids || [] };
  }
  console.error("[get-daily-car] coche_de_hoy:", rpcResult.error);

  // EL RESPALDO NO SE INTENTA SI EL FALLO FUE POR PLAZO, y este es el porqué:
  // `coche_de_hoy` es un envoltorio finísimo que por dentro llama a
  // `pick_daily_car`. Si no ha contestado porque Supabase está atrancado,
  // `pick_daily_car` tampoco va a contestar — el respaldo no compra
  // resiliencia contra eso, solo contra «la función todavía no está
  // desplegada», que falla INSTANTÁNEAMENTE (PostgREST devuelve PGRST202 al
  // momento). O sea: detrás de una espera agotada el respaldo no arregla nada
  // y sí gasta otro plazo del presupuesto de la función. 503 honesto y fuera.
  if (fuePorPlazo(rpcResult)) return { fallo: "plazo" };

  // A partir de aquí sabemos que PostgREST ha contestado —mal, pero al
  // momento—, así que el respaldo va con UN SOLO intento. El reintento existe
  // para el tartamudeo (regla 21, corolario 1) y aquí acabamos de medir que no
  // hay tartamudeo: la base responde. Un segundo intento solo añadiría plazo a
  // un presupuesto que ya está contado.
  //
  // Los salientes hay que leerlos IGUAL, con un select plano. `[]` no significa
  // «no he podido averiguarlo», significa «hoy no ha habido cambio»: fabricarlo
  // a ciegas haría que la lectura acotada de user_guesses no viera la fila de un
  // congelado y le sirviéramos tablero nuevo con cinco intentos — justo la
  // rejugada que todo esto existe para impedir. Si no se puede leer se avisa con
  // `salientesDesconocidos` y decide el handler, que es quien sabe a quién le
  // afecta.
  const [respaldo, salientes] = await Promise.all([
    conTimeoutOFallback(
      supabaseAdmin.rpc("pick_daily_car", { p_date: today }),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "pick_daily_car sin respuesta a tiempo" } },
      { etiqueta: "pick_daily_car (respaldo)" }
    ),
    conTimeoutOFallback(
      supabaseAdmin
        .from("daily_cars")
        .select("prev_car_ids")
        .eq("date", today)
        .maybeSingle(),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "prev_car_ids sin respuesta a tiempo" } },
      { etiqueta: "read prev_car_ids" }
    ),
  ]);

  if (respaldo.error || !respaldo.data) {
    console.error("[get-daily-car] pick_daily_car:", respaldo.error);
    return { fallo: "sin-coche" };
  }
  if (salientes.error) {
    console.error("[get-daily-car] read prev_car_ids:", salientes.error);
    return { carId: respaldo.data, prevCarIds: [], salientesDesconocidos: true };
  }
  return {
    carId: respaldo.data,
    prevCarIds: salientes.data?.prev_car_ids || [],
  };
}

// La resolución de identidad vive en _lib/auth.js y se IMPORTA, no se copia.
//
// Aquí hubo una réplica inline con este motivo: «el helper existente vive en
// auth.js que usa req.headers estilo Vercel». La premisa no se sostenía —
// `authClientAndUser(token)` recibe un string y no toca `req`; quien lee
// cabeceras es `requireUser`, que desde aquí no se llama— y la cadena de
// imports de auth.js es Edge-safe entera: createAuthClient, timeout.js y
// jwks.js no usan nada de Node.
//
// Y desde que la identidad se verifica criptográficamente en local, la copia
// dejó de ser solo redundante: serían DOS verificaciones de firma que
// mantener, con el riesgo de endurecer una y olvidar la otra. Una sola.

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

  // FASE 1: arranque paralelo. Ni la resolución del día ni la de sesión
  // dependen de la otra. El usuario anónimo paga solo la del día.
  // Cada rama con su plazo, y NO uno solo alrededor del Promise.all: así una
  // dependencia atrancada no arrastra a la otra, y en los logs se ve cuál de
  // las dos fue. El respaldo de la RPC va DENTRO de resolverElDia y por tanto
  // también dentro de este paralelo: colgándolo del handler, su plazo se
  // sumaba en serie al de auth y se salía del presupuesto del Edge.
  const [dia, authResult] = await Promise.all([
    resolverElDia(supabaseAdmin, today),
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

  if (dia.fallo === "plazo") {
    // Supabase no contesta. No hay plan B que valga (ver resolverElDia): 503
    // en cuanto lo sabemos, que es lo contrario de morir por presupuesto.
    return respond(
      { message: "Daily car temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  if (dia.fallo === "sin-coche") {
    // 503 y no 500: sin coche del día no hay juego, pero esto se arregla solo
    // en cuanto la base vuelva. El 500 invitaba a buscar un bug que no existe.
    return respond(
      { message: "Failed to pick daily car" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  if (dia.salientesDesconocidos) {
    // No sabemos si hoy hubo cambio. Antes que arriesgarnos a vaciarle el
    // tablero a alguien, 503.
    return respond(
      { message: "Game state temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const todayCarId = dia.carId;
  const prevCarIds = dia.prevCarIds;
  const { client: authClient, user } = authResult;

  // FASE 2: con las revisiones del día resueltas, paralelizamos:
  //   - Lectura de image_url + blur_data (necesarios para construir el
  //     URL del proxy + el LQIP).
  //   - Si hay usuario, lectura de su user_guesses (status + guesses).
  //
  // Para anónimos, la rama de user_guesses cae a un resolve(null) y solo
  // hacemos la lectura de imagen.
  const [imgResult, gameResult] = await Promise.all([
    // Se leen TODOS los candidatos del día —el vigente y los salientes— en vez
    // de solo el vigente, porque qué coche le toca a este jugador depende de su
    // propia fila de user_guesses, que se está leyendo AQUÍ AL LADO. Resolver
    // primero y leer la imagen después costaría un round-trip en serie en el
    // único request bloqueante del primer paint. En un día normal prevCarIds
    // está vacío y esto es la consulta de siempre con un `in` de un elemento.
    conTimeoutOFallback(
      supabaseAdmin
        .from("cars")
        .select("id, image_url, blur_data, zoom_base")
        .in("id", [todayCarId, ...prevCarIds]),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "read image_url sin respuesta a tiempo" } },
      { etiqueta: "read image_url" }
    ),
    // También con reintento: si esta lectura se pierde, el usuario logueado se
    // come un 503 aunque su partida esté ahí. Es la otra que sostiene el juego.
    user
      ? conTimeoutReintentando(
          () =>
            authClient
              .from("user_guesses")
              .select("car_id, guesses, status")
              .eq("user_id", user.id)
              .eq("date", today)
              // Acotado a las revisiones del día: sin esto entraría también la
              // partida de REPESCA de hoy, que vive en esta misma tabla con la
              // misma fecha y otro car_id.
              //
              // Sin `.limit(1)` a propósito: si el usuario tuviera fila en el
              // coche vigente y en un saliente, quién gana es una decisión de
              // negocio (gana el saliente: es la partida que está jugando) y la
              // toma el resolvedor, que es donde está escrita y probada. Un
              // `limit(1)` sin `order` se la dejaría a Postgres.
              .in("car_id", [todayCarId, ...prevCarIds]),
          PLAZOS.SUPABASE,
          { data: null, error: { message: "read user_guesses sin respuesta a tiempo" } },
          { etiqueta: "read user_guesses" }
        )
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data: filasCars, error: imgRowErr } = imgResult;
  if (imgRowErr) {
    // Si falla la lectura de image_url, seguimos sin versión (cache "vieja"
    // hasta el TTL natural). Es estrictamente mejor que romper la home.
    console.error("[get-daily-car] read image_url:", imgRowErr);
  }

  const { data: filasGuesses, error: gameErr } = gameResult;
  if (gameErr) {
    console.error("[get-daily-car] read user_guesses:", gameErr);
    // 503, no `respond(base)`. Devolver `base` era servirle al usuario un
    // tablero A CERO: `base.guesses` va vacío y `base.status` es "playing",
    // y el cliente no lo compensa con localStorage porque para una sesión
    // iniciada la fuente de verdad es el servidor. Quien llevara tres intentos
    // veía la partida en blanco y —peor— podía volver a jugarla desde el
    // principio contra un servidor que sí recuerda los intentos gastados.
    // Un error honesto es mejor que un estado inventado.
    //
    // Y se corta AQUÍ, antes de resolver: sin sus filas no se sabe a qué coche
    // está anclado, así que cualquier cosa que hiciéramos después (la foto que
    // se sirve, la fila de auditoría) saldría del coche equivocado.
    return respond(
      { message: "Game state temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  // Array, no fila: el desempate entre revisiones lo hace el resolvedor.
  const filasUsuario = Array.isArray(filasGuesses) ? filasGuesses : [];

  // Token de sesión anónima firmado (HMAC). Se lee UNA vez y se reutiliza en la
  // rama anónima de más abajo.
  //
  // SOLO cuenta si NO hay sesión y si es de HOY: el cliente manda la cabecera
  // X-Anon-Session esté logueado o no, y nada la borra al registrarse. Sin esos
  // dos filtros, quien jugó anónimo y luego se hizo cuenta arrastraría para
  // siempre un sello rancio que no casa con nada — y acabaría en un bucle de
  // recargas permanente.
  const tokenAnonEntrante = user ? null : await readAnonTokenFromRequest(request);
  const anonVigente =
    !user && tokenAnonEntrante?.d === today ? tokenAnonEntrante : null;

  // ¿Qué coche le toca a QUIEN PREGUNTA? Puede no ser el vigente: si hubo
  // cambio de emergencia, quien ya estaba jugando se queda con el suyo hasta
  // medianoche. A partir de aquí, todo lo que sea «lo que ve ESTE jugador» usa
  // carIdDelUsuario; todayCarId solo vale para hablar del día en abstracto.
  const sellosPorCarId = await sellosDe([todayCarId, ...prevCarIds], today);
  const { carId: carIdDelUsuario } = resolverCocheDelUsuario({
    carIdVigente: todayCarId,
    prevCarIds,
    filasUsuario,
    hayUsuario: Boolean(user),
    selloCliente: anonVigente?.c || null,
    sellosPorCarId,
    intentosAnon: Number.isInteger(anonVigente?.n) ? anonVigente.n : 0,
  });

  // La fila de `cars` del coche de ESTE jugador, de entre las candidatas.
  const imgRow =
    (Array.isArray(filasCars) ? filasCars : []).find(
      (c) => c.id === carIdDelUsuario
    ) || null;

  // AUDITORÍA: registra la PRIMERA visita del día por (user|ip + día).
  // Deliberadamente SIN await — el insert vuela en background; Vercel Edge
  // deja que las fetches en vuelo se completen tras devolver la Response.
  // Dedupe en memoria de la instancia warm evita filas por cada F5.
  //
  // Con el coche RESUELTO: si esta visita es la de un congelado, la fila de
  // auditoría tiene que decir qué coche está jugando él, no cuál es el vigente.
  logSessionStart({
    request,
    userId: user?.id || null,
    isAnon: !user,
    gameDate: today,
    carId: carIdDelUsuario,
  }).catch(() => {});

  // Zoom base del coche de hoy. El cliente lo usa para calcular los scales CSS
  // por intento; clampZoomBase cae al default 3.7 si la columna no existe aún.
  const zoomBase = clampZoomBase(imgRow?.zoom_base);

  // El hash identifica al coche, y daily-image lo usa para saber qué revisión
  // del día pide quien carga la foto. Ver api/_lib/version-imagen.js.
  const imgVersion = await versionDeImagen(imgRow?.image_url, zoomBase);
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
    // Sello del coche que ESTE jugador tiene delante. Lo reenvía en
    // validate-guess para que el servidor detecte si está respondiendo sobre
    // una foto que ya no es la de su partida. Opaco: no dice qué coche es.
    sello: sellosPorCarId[carIdDelUsuario] || null,
  };

  // -------- RAMA ANÓNIMA -------------------------------------------------
  if (!user) {
    // El token de sesión anónima ya se leyó arriba (lo necesitaba el
    // resolvedor). Antes era una cookie HttpOnly; ahora viaja en el body para
    // que la app Android (origen distinto) no dependa de cookies cross-site.
    // El cliente lo guarda en localStorage y lo reenvía en X-Anon-Session.
    const incoming = tokenAnonEntrante;
    const valid =
      incoming &&
      incoming.d === today &&
      Number.isInteger(incoming.n) &&
      typeof incoming.s === "string";

    // El sello del coche resuelto se REESCRIBE en cada visita: es lo que ancla
    // al anónimo a su revisión (y lo que lo reengancha al coche nuevo si no
    // había empezado). Si no hay secreto configurado no hay sello, y se
    // conserva el que trajera antes que perderlo.
    const session = valid
      ? { ...incoming, c: sellosPorCarId[carIdDelUsuario] || incoming.c || null }
      : { d: today, n: 0, s: "playing", c: sellosPorCarId[carIdDelUsuario] || null };

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
  // La fila que cuenta es la del coche RESUELTO, no «la de hoy»: si está
  // congelado en una revisión anterior, su partida es la del saliente.
  // (El error de la lectura ya se atendió arriba con un 503.)
  const gameRow = filasUsuario.find((f) => f.car_id === carIdDelUsuario) || null;

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
          // El coche del jugador, que puede no ser el vigente: revelarle el
          // coche nuevo sobre su partida vieja sería mentirle en la cara.
          .eq("id", carIdDelUsuario)
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
    ...base,
    guesses,
    status,
    reveal,
    revealToken,
  });
}
