// api/daily-image.js
// Proxy de la imagen del coche del día. El cliente solo recibe los bytes;
// la URL real del CDN (que contenía marca-modelo-año en el filename) NUNCA
// se expone al navegador.
//
// Flujo:
//   1) Resolvemos el coche del día con coche_de_hoy (service_role: las RPC
//      están revocadas de anon/authenticated por hardening previo), y el `v`
//      de la URL decide cuál de las revisiones del día sirve esta petición.
//   2) Leemos image_url de la fila (columna privilegiada).
//   3) Hacemos un fetch server-side al CDN.
//   4) Si el cliente pidió `?w` o `?f`, redimensionamos / recodificamos con
//      sharp. Si no, passthrough literal.
//
// Query params:
//   ?d=YYYY-MM-DD   → cache buster diario (no se lee aquí; es solo cache key).
//   ?v=<hash>       → hash corto de (image_url, zoom_base). Sigue siendo cache
//                     buster —invalida solo cuando el admin cambia la foto
//                     desde /admin/edit-car— pero ADEMÁS es lo único que dice
//                     qué revisión del día está mirando quien pide la foto:
//                     ver la nota larga del bloque de resolución más abajo.
//   ?w=320|640|1280 → ancho objetivo. Allowlist estricta para evitar DoS por
//                     resize a tamaños absurdos.
//   ?f=avif|webp|jpeg → formato de salida. Allowlist estricta.
//
// Cache:
//   Cada combinación (d, v, w, f) tiene su propia entrada en el edge cache
//   de Vercel. El cost de sharp se paga una vez por entrada y región, y
//   luego durante 24 h se sirve desde el CDN sin tocar la función.
//
// PLAZOS (regla 21). Esta función tiene un presupuesto de 60 s que NO es todo
// para la I/O: sharp puede llevarse segundos en frío (ver la nota de effort 2
// en AVIF, más abajo), y ese trozo no se puede acotar con un plazo porque es
// CPU nuestra, no espera ajena. Así que las esperas van cortas y, sobre todo,
// no se encadenan: cada respaldo de aquí abajo lleva escrito por qué se
// intenta o por qué no. El principio que gobierna las decisiones es que este
// handler YA sabe degradar —sirve el original si sharp peta, sirve el recorte
// si no puede confirmar el reveal— y un plazo nunca debe convertir en error
// algo que hoy se degrada con gracia.

import sharp from "sharp";
import { verifyRevealToken } from "./_lib/reveal-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { authClientAndUser } from "./_lib/auth.js";
import { leerImagenOrigen } from "./_lib/imagen-origen.js";
import { todayInMadrid } from "./_lib/date.js";
import { methodGuard } from "./_lib/http.js";
import { getClientIp } from "./_lib/ratelimit.js";
import { logCanary } from "./_lib/audit.js";
import { clampZoomBase, cropPctForAttempt } from "./_lib/zoom.js";
import { versionDeImagen } from "./_lib/version-imagen.js";
import { selloDeCoche } from "./_lib/sello.js";
import {
  conTimeoutOFallback,
  conTimeoutReintentando,
  fuePorPlazo,
  PLAZOS,
} from "./_lib/timeout.js";

// Allowlists. Cambiar aquí también requiere actualizar CarImage.jsx (los
// srcset del front), que es donde se decide qué tamaños se piden.
// 1920 quitado: en móvil/desktop normal nunca se pide y solo añadía una
// cache key más que calentar y otra ocasión de cold-start de sharp.
const ALLOWED_WIDTHS = new Set([640, 1280, 1920]);
const FORMAT_MIME = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

// Zoom levels y mapeo a porcentaje del crop centrado.
//
// El motor del juego trabajaba antes así: una imagen FULL del coche bajaba
// al navegador y el cliente aplicaba `transform: scale(3.5x → 1.8x)` CSS
// para "tapar" lo que el jugador todavía no se había ganado ver. Eso es
// puramente visual: el atacante con DevTools podía abrir Network → Preview
// y ver la imagen entera en dos clicks.
//
// Ahora el servidor RECORTA la imagen al área que el jugador legítimo
// estaría viendo en ese intento, antes de devolverla. La imagen completa
// nunca sale del servidor mientras el juego está activo.
//
// El porcentaje del crop es `1 / zoom_del_intento`, y el zoom depende del
// `zoom_base` de CADA coche (cars.zoom_base). NO es una resta lineal: la curva
// es log-lerp entre los extremos con easing back-loaded, y vive en _lib/zoom.js
// (compartida conceptualmente con el cliente, src/lib/zoom.js). Para el base por
// defecto (3.7): z=1 → 27.0%, z=2 → 30.7%, z=3 → 37.1%, z=4 → 46.1%, z=5 → 58.8%.
// Si no se pasa `z` o el valor está fuera del set, NO se aplica crop:
// devolvemos la imagen completa. El cliente solo debería pedir sin `z`
// cuando el juego ha terminado (status=won|lost) y queremos revelar.
const ALLOWED_Z = new Set([1, 2, 3, 4, 5]);

// Si llega un Bearer, intentamos identificar al usuario para gatear el
// reveal a su `user_guesses.status`. Es opcional: el flujo normal de
// reveal pasa por el revealToken firmado, pero este check es defensivo
// para clientes que aún no tengan token (cache antigua, refresh raro).
/**
 * ¿El revealToken que presenta este visitante abre la foto que está pidiendo?
 *
 * El token trae el SELLO del coche que su portador se ganó (_lib/reveal-token.js),
 * y aquí se compara con el sello del coche que hemos resuelto por el `v` de la
 * URL. Si no casan, el token es de otra revisión del día y no abre nada: se le
 * sirve el recorte, como a cualquiera.
 *
 * COMPATIBILIDAD CON LOS TOKENS VIEJOS (sin sello), que siguen circulando en
 * clientes que no han recargado: se aceptan SOLO si el día no tiene salientes.
 * Ahí el razonamiento antiguo —«un día = un coche»— sigue siendo verdad y el
 * token no puede abrir nada que su portador no se hubiera ganado ya. En cuanto
 * hay salientes, un token sin sello no puede demostrar de qué revisión es, y el
 * fallo seguro es no revelar: como mucho le cuesta una recarga al legítimo
 * (get-daily-car le emite uno nuevo, ya con sello).
 */
async function tokenAbreEstaFoto(selloDelToken, carId, today, hayCambioHoy) {
  if (!selloDelToken) return !hayCambioHoy;
  const esperado = await selloDeCoche(carId, today);
  return Boolean(esperado) && esperado === selloDelToken;
}

async function tryReadUserStatus(req, carId, today) {
  const auth = req.headers?.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (!token) return null;
  try {
    // Por el helper compartido: firma verificada en local, sin viaje a GoTrue.
    // Este check es DEFENSIVO —el camino normal del reveal va por el
    // revealToken firmado—, así que ante cualquier duda seguimos sin él antes
    // que dejar la foto del día colgada.
    const { client, user } = await authClientAndUser(token);
    if (!client || !user) return null;
    // Plazo, sin reintento y sin 5xx: si esta lectura no llega, se sigue sin
    // ella. Es el mismo criterio que ya declara la nota de arriba —ante
    // cualquier duda, el recorte antes que la foto colgada— y el ámbito
    // correcto para la protección, porque el camino normal del reveal es el
    // revealToken firmado y este check solo lo alcanza el cliente raro.
    const { data: row } = await conTimeoutOFallback(
      client
        .from("user_guesses")
        .select("status")
        .eq("user_id", user.id)
        .eq("car_id", carId)
        .eq("date", today)
        .maybeSingle(),
      PLAZOS.SUPABASE,
      { data: null },
      { etiqueta: "read user_guesses (daily-image)" }
    );
    return row?.status || null;
  } catch (err) {
    console.error("[daily-image] tryReadUserStatus:", err?.message || err);
    return null;
  }
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "HEAD"])) return;

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error(`[daily-image] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const today = todayInMadrid();

  // 1) Qué coche sirve esta petición. Normalmente el vigente — pero si hubo un
  //    cambio de emergencia, quien estaba jugando sigue pidiendo la foto del
  //    suyo, y hay que dársela o vería el coche nuevo con su tablero viejo.
  //
  //    Aquí NO se puede usar el resolvedor de _lib/coche-de-hoy.js: la foto la
  //    pide una etiqueta <img>, que no manda Authorization ni X-Anon-Session.
  //    Ahí no hay usuario que resolver. Lo único que identifica la revisión es
  //    el `v` de la URL, que es un hash del coche (_lib/version-imagen.js).
  //    Como el hash sale del coche, cada revisión tiene su propia URL y la
  //    caché compartida del CDN no puede servirle la foto de un jugador a
  //    otro. Esa propiedad es la que hace viable todo esto.
  //
  //    DOS INTENTOS: sin coche resuelto no hay foto que servir, y la RPC es
  //    idempotente. El plazo pelado convertiría en «sin foto» una lectura lenta
  //    que hoy acaba llegando; el reintento deja el corte para el atranco de
  //    verdad.
  const rpcResult = await conTimeoutReintentando(
    () => supabaseAdmin.rpc("coche_de_hoy", { p_date: today }),
    PLAZOS.SUPABASE,
    { data: null, error: { message: "coche_de_hoy sin respuesta a tiempo" } },
    { etiqueta: "coche_de_hoy" }
  );
  const { data: filas, error: rpcErr } = rpcResult;
  let carId = filas?.[0]?.car_id || null;
  const prevCarIds = filas?.[0]?.prev_car_ids || [];

  if (rpcErr || !carId) {
    console.error("[daily-image] coche_de_hoy:", rpcErr);

    // El respaldo NO se intenta si el fallo fue por PLAZO: `coche_de_hoy`
    // envuelve a `pick_daily_car`, así que si el primero no contesta el segundo
    // tampoco. El respaldo cubre «la función no está desplegada», que falla al
    // instante; detrás de una espera agotada solo gastaría otro plazo del
    // presupuesto de la función.
    if (fuePorPlazo(rpcResult)) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ message: "No daily car" });
    }

    // Respaldo: sin la envoltura desplegada se sirve el coche vigente y ya.
    // Aquí sí se puede prescindir de los salientes (a diferencia de
    // get-daily-car, donde inventarlos vaciaría un tablero): un `v` que no
    // case cae en el vigente, que es exactamente el comportamiento histórico
    // de este proxy. Lo peor que pasa es que un congelado vea la foto nueva.
    //
    // Un solo intento: acabamos de comprobar que PostgREST responde.
    const { data: respaldo, error: respErr } = await conTimeoutOFallback(
      supabaseAdmin.rpc("pick_daily_car", { p_date: today }),
      PLAZOS.SUPABASE,
      { data: null, error: { message: "pick_daily_car sin respuesta a tiempo" } },
      { etiqueta: "pick_daily_car (respaldo)" }
    );
    if (respErr || !respaldo) {
      console.error("[daily-image] pick_daily_car:", respErr);
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ message: "No daily car" });
    }
    carId = respaldo;
  }

  const vPedido = typeof req.query?.v === "string" ? req.query.v : null;

  // 2) URL real del CDN + punto focal. Nunca salen de este proceso.
  //    focus_x/focus_y indican el centro del crop en [0,1]. Si están a
  //    null (compat con coches anteriores a la columna) o fuera de rango,
  //    cae al 0.5/0.5 — equivalente al crop centrado del comportamiento
  //    histórico.
  //
  //    Se leen los candidatos del día —el vigente y, si hubo cambio hoy, los
  //    salientes— en una sola consulta. En un día normal `prevCarIds` está
  //    vacío y esto es la consulta de siempre con un `in` de un elemento.
  //
  //    Con dos intentos, por lo mismo que la RPC: es la lectura que decide si
  //    hay foto o no, y no hay degradación posible al otro lado —sin image_url
  //    no hay bytes que servir—, así que el reintento es lo único que separa
  //    «la base va lenta» de «hoy no se ve el coche».
  const { data: filasCars, error: carsErr } = await conTimeoutReintentando(
    () =>
      supabaseAdmin
        .from("cars")
        .select("id, image_url, focus_x, focus_y, zoom_base")
        .in("id", [carId, ...prevCarIds]),
    PLAZOS.SUPABASE,
    { data: null, error: { message: "read cars sin respuesta a tiempo" } },
    { etiqueta: "read cars" }
  );
  if (carsErr || !filasCars?.length) {
    console.error("[daily-image] read cars:", carsErr);
    res.setHeader("Retry-After", "5");
    return res.status(503).json({ message: "No daily car" });
  }

  let carRow = filasCars.find((c) => c.id === carId);

  // ¿El `v` que pide es el de una revisión anterior? Entonces esa es su foto.
  // El bucle solo se paga los días que hubo cambio: esto se sirve en CADA
  // carga de foto, y hashear por gusto un coche al día sería un coste diario
  // por un caso excepcional. Un `v` que no case con nada (una foto que el
  // admin reemplazó, una caché vieja) cae en el vigente: es el comportamiento
  // de siempre y no es un error.
  if (vPedido && prevCarIds.length > 0) {
    for (const candidata of filasCars) {
      const v = await versionDeImagen(
        candidata.image_url,
        clampZoomBase(candidata.zoom_base)
      );
      if (v === vPedido) {
        carRow = candidata;
        carId = candidata.id;
        break;
      }
    }
  }

  const row = carRow;
  if (!row?.image_url) {
    console.error("[daily-image] fetch car: sin image_url para", carId);
    return res.status(500).json({ message: "Failed to load daily car" });
  }
  // Zoom base por coche (dificultad). clampZoomBase cae al default 3.7 si la
  // fila es de antes de la columna o trae un valor fuera de rango.
  const zoomBase = clampZoomBase(row.zoom_base);
  const focusX =
    Number.isFinite(row.focus_x) && row.focus_x >= 0 && row.focus_x <= 1
      ? row.focus_x
      : 0.5;
  const focusY =
    Number.isFinite(row.focus_y) && row.focus_y >= 0 && row.focus_y <= 1
      ? row.focus_y
      : 0.5;

  // 3) Validamos params de procesamiento. Las allowlists son estrictas: si
  //    el cliente pide algo fuera del set, lo ignoramos (no devolvemos 400)
  //    para que un visitante con un srcset cacheado obsoleto no rompa.
  const wRaw = Number(req.query?.w);
  const wantedWidth =
    Number.isFinite(wRaw) && ALLOWED_WIDTHS.has(wRaw) ? wRaw : null;

  const fRaw = String(req.query?.f || "").toLowerCase();
  const wantedFormat = fRaw in FORMAT_MIME ? fRaw : null;

  const zRaw = Number(req.query?.z);
  const zRequested =
    Number.isFinite(zRaw) && ALLOWED_Z.has(zRaw) ? zRaw : null;

  // ---- Gateo del REVEAL (imagen completa) ------------------------------
  // Antes, "sin z" significaba "imagen completa" — un cheater abría
  // DevTools, copiaba la URL, quitaba `&z=5` y veía el coche entero. Ahora
  // exigimos prueba server-verificable de que el visitante ha terminado
  // la partida. Dos vías equivalentes:
  //   (a) ?t=<revealToken> firmado por hoy Y PARA ESTE COCHE (lo emiten
  //       get-daily-car y validate-guess cuando aplican — también al anónimo
  //       que GANÓ, así que el incógnito ganador revela por aquí, no por su
  //       sesión). El sello del token tiene que corresponder al coche que
  //       hemos resuelto por el `v`: la fecha sola dejó de bastar el día que
  //       un día pudo tener dos coches.
  //   (b) Bearer del usuario y user_guesses.status ∈ {won, lost}.
  // Si NINGUNA aplica, forzamos el crop más amplio que un jugador
  // legítimo podría ver durante la partida (z=5 = 55,6% central).
  let canReveal = false;

  const tParam = typeof req.query?.t === "string" ? req.query.t : "";
  if (tParam) {
    const datos = verifyRevealToken(tParam);
    if (datos?.date !== today) {
      // CANARIO: un cliente legítimo solo presenta tokens que el servidor
      // emitió para HOY. Un token con firma inválida (datos === null) es
      // forjado; uno válido pero de otra fecha es caducado/replay (puede ser
      // una pestaña vieja, señal más débil). Registramos ambos con motivo
      // distinto. Best-effort: nunca rompe la entrega de la imagen — y con
      // plazo corto dentro de audit.js, porque «best-effort» y «await» juntos
      // significan que una tabla de auditoría atrancada retrasaría la foto de
      // todo el que llegue con un token caducado (una pestaña vieja, sin ir más
      // lejos).
      await logCanary({
        req,
        reason: datos === null ? "forged_reveal_token" : "stale_reveal_token",
        carId,
        gameDate: today,
        isAnon: !String(req.headers?.authorization || "").startsWith("Bearer "),
        ip: getClientIp(req),
      });
    } else if (
      await tokenAbreEstaFoto(datos.sello, carId, today, prevCarIds.length > 0)
    ) {
      canReveal = true;
    } else {
      // Token bien firmado y de hoy, pero de OTRA revisión del día. NO es un
      // ataque: es exactamente lo que le pasa a quien terminó su partida con el
      // coche saliente y luego carga la foto del vigente. Registrarlo como
      // canario llenaría la auditoría anti-trampas de falsos positivos justo
      // el día en que más falta hace poder leerla. Se le sirve el recorte y ya.
      console.warn("[daily-image] revealToken de otra revisión: se sirve recorte");
    }
  }

  if (!canReveal) {
    // UN SOLO PRESUPUESTO PARA TODO EL CHECK, y no la suma de sus partes. Por
    // dentro esto resuelve identidad (que ya tiene su plazo, hasta 2×AUTH) y
    // luego lee user_guesses (otro plazo): encadenados, una comprobación
    // OPCIONAL —el camino normal del reveal es el revealToken firmado— podría
    // costarle 14 s a la foto del día. La protección no puede ser más cara que
    // el problema que protege; al vencer se sigue sin ella, que es exactamente
    // lo que ya hacía este helper ante cualquier otro fallo.
    const userStatus = await conTimeoutOFallback(
      tryReadUserStatus(req, carId, today),
      PLAZOS.SUPABASE,
      null,
      { etiqueta: "tryReadUserStatus" }
    );
    if (userStatus === "won" || userStatus === "lost") canReveal = true;
  }

  // Decisión final del crop:
  //   - canReveal=true  → respetamos lo que el cliente pidió (sin z = full,
  //                       con z = un crop concreto si lo quiere por motivos
  //                       de bandwidth — raro, pero válido).
  //   - canReveal=false → SIEMPRE crop. Si el cliente mandó un z válido,
  //                       lo usamos; si no, fallback a z=5.
  const wantedZ = canReveal ? zRequested : zRequested ?? 5;

  // 4) Bytes de origen. Por el helper: prefiere el master WebP —misma
  //    resolución, la mitad de peso— y cae al original si aún no existe,
  //    además de cachear en el proceso para que las 54 variantes del día no
  //    se descarguen 54 veces. El porqué completo, en imagen-origen.js.
  const origen = await leerImagenOrigen(row.image_url);
  if (!origen) {
    return res.status(502).json({ message: "Upstream image unavailable" });
  }
  const originalContentType = origen.contentType;
  const originalBuffer = origen.buffer;

  // 5) Procesamiento. Si el cliente pidió tamaño o formato, pasamos por
  //    sharp. Si no, passthrough (mantenemos backward-compat con cualquier
  //    enlace antiguo que llegue sin params, p.ej. tarjetas OG cacheadas).
  let outBuffer = originalBuffer;
  let outContentType = originalContentType;

  if (wantedWidth !== null || wantedFormat !== null || wantedZ !== null) {
    try {
      let pipeline = sharp(originalBuffer).rotate(); // rotate() respeta EXIF

      if (wantedZ !== null) {
        // Crop centrado al área correspondiente al zoom-level del intento.
        // Importante: sharp.metadata() devuelve las dimensiones FÍSICAS del
        // fichero, antes de aplicar EXIF orientation. Pero el pipeline ya
        // hizo .rotate() arriba, así que la imagen efectiva puede estar
        // girada 90/270 respecto a lo que dice meta.width/meta.height.
        // Si orientation ≥ 5, las dimensiones reales están intercambiadas.
        const meta = await sharp(originalBuffer).metadata();
        if (meta?.width && meta?.height) {
          const rotated90 = meta.orientation && meta.orientation >= 5;
          const W = rotated90 ? meta.height : meta.width;
          const H = rotated90 ? meta.width : meta.height;
          // Cuadrado centrado en (focusX, focusY) en lugar del centro de
          // la imagen. Lado = min(W,H) × cropPct. Cuadrado porque el
          // container del juego es 1:1; así el resultado entra exacto sin
          // que el cliente tenga que recortar nada con object-cover.
          //
          // El clamp con (W - size) / (H - size) garantiza que el crop no
          // se salga por los bordes cuando el foco está cerca de una
          // esquina y el `size` es grande (intento 5). En esos casos el
          // cuadrado se "pega" al borde — visualmente lógico.
          const minDim = Math.min(W, H);
          const size = Math.max(1, Math.round(minDim * cropPctForAttempt(wantedZ, zoomBase)));
          const rawLeft = Math.round(W * focusX - size / 2);
          const rawTop = Math.round(H * focusY - size / 2);
          const left = Math.max(0, Math.min(W - size, rawLeft));
          const top = Math.max(0, Math.min(H - size, rawTop));
          pipeline = pipeline.extract({ left, top, width: size, height: size });
        }
      }

      if (wantedWidth !== null) {
        pipeline = pipeline.resize(wantedWidth, null, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      if (wantedFormat === "avif") {
        // quality 74 (subido de 68) y chromaSubsampling 4:4:4: la imagen del coche es
        // el centro de la web y los primeros intentos aplican un zoom grande (hasta 3.7x),
        // donde los artefactos de compresión se hacen muy visibles. Desactivar el subsampling
        // de croma (4:4:4) mantiene la nitidez absoluta en insignias y faros con muy poco peso extra.
        // effort 2: NO subir. Effort 4 hace el cold-start de sharp pasar de 1-2 s a 3-8 s.
        pipeline = pipeline.avif({ quality: 74, effort: 2, chromaSubsampling: "4:4:4" });
      } else if (wantedFormat === "webp") {
        // Calidad 90 y smartSubsample: reduce artefactos en bordes contrastados sin penalizar peso
        pipeline = pipeline.webp({ quality: 90, smartSubsample: true });
      } else if (wantedFormat === "jpeg") {
        // Calidad 93 y chromaSubsampling 4:4:4 para máxima fidelidad de color
        pipeline = pipeline.jpeg({
          quality: 93,
          mozjpeg: true,
          progressive: true,
          chromaSubsampling: "4:4:4",
        });
      }
      outBuffer = await pipeline.toBuffer();
      if (wantedFormat !== null) outContentType = FORMAT_MIME[wantedFormat];
    } catch (err) {
      // Si sharp falla por cualquier motivo (input corrupto, OOM, formato
      // raro), seguimos sirviendo el original. Mejor entregar una imagen
      // grande que ningún LCP.
      console.error("[daily-image] sharp pipeline:", err?.message || err);
      outBuffer = originalBuffer;
      outContentType = originalContentType;
    }
  }

  // Cache:
  //   - Si el cliente pasó un revealToken válido (?t=...), la URL incluye
  //     ese token y es única para "reveal de hoy". Misma respuesta para
  //     todos los que lo presenten → CDN-cacheable 24 h.
  //   - Si la cache key es la URL "sin t" pero entregamos imagen completa
  //     porque el usuario está logueado-con-win, NO podemos cachear
  //     públicamente: la siguiente request anónima a esa
  //     misma URL recibiría la imagen completa del cache → fuga total.
  //     Marcamos no-store.
  //   - El resto (crop forzado a z=5) es público y determinista, sin
  //     leak: el crop es lo mismo que ve cualquier jugador legítimo.
  const cacheable = !canReveal || Boolean(tParam);
  res.setHeader("Content-Type", outContentType);
  res.setHeader("Content-Length", String(outBuffer.length));
  res.setHeader(
    "Cache-Control",
    cacheable
      ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400, immutable"
      : "private, no-store"
  );
  // Por si acaso algún proxy intermedio mira el Content-Disposition:
  // forzamos inline sin filename, evitando filtrar el original del CDN.
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  return res.status(200).send(outBuffer);
}
