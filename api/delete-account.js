// api/delete-account.js
// Borrado de cuenta a petición del propio jugador.
//
// POR QUÉ EXISTE: Google Play exige, para toda app que permita crear cuenta, un
// camino DENTRO de la app para pedir el borrado de la cuenta y sus datos, más
// una URL pública que se declara en el formulario de Data safety (aquí la
// cumple /eliminar-cuenta). No es una mejora opcional: sin esto la solicitud de
// acceso a producción se rechaza. Y en la web es lo que da cuerpo al derecho de
// supresión que ya promete /privacidad.
//
// ─── QUÉ SE BORRA Y QUÉ NO (y por qué) ──────────────────────────────────────
// Se borra TODO lo que identifica a la persona; se conservan las partidas ya
// desligadas de ella:
//
//   FUERA · profiles           → el nickname es el único nombre público del
//                                juego. Sin fila en profiles el jugador
//                                desaparece del ranking, del Salón de
//                                Campeones y del perfil público, porque las
//                                tres consultas hacen JOIN contra profiles y
//                                exigen display_name no vacío.
//   FUERA · push_subscriptions → el endpoint de push identifica al dispositivo
//                                y además seguiría avisando a alguien que se
//                                ha ido.
//   FUERA · mensajes           → lo que escribió al buzón del juego, con su
//                                texto y a veces una dirección de correo suya.
//                                Es PII y se va con la persona.
//   FUERA · identidad de auth  → email, teléfono, credenciales, identidades de
//                                Google y los metadatos que trae el proveedor
//                                (nombre y foto). Lo hace GoTrue con su borrado
//                                blando (ver abajo).
//   ANÓNIMA · guess_audit      → la fila se queda sin user_id y sin las huellas
//                                del dispositivo (user-agent, idioma). El
//                                ip_hash sí permanece: ya es un HMAC, no PII
//                                cruda, y es lo único que sostiene la
//                                detección de "oráculo". Borrarlo entero
//                                convertiría este endpoint en un botón de
//                                «bórrame las huellas» para un tramposo.
//   SE QUEDAN · user_guesses, stats, rank_snapshots, monthly_podium,
//               season_podium → son las partidas, ya huérfanas de identidad.
//               Se conservan porque los podios pasados se RECALCULAN desde
//               user_guesses (compute_monthly_podium / compute_season_podium
//               son idempotentes): si desaparecieran, un mes cerrado hace medio
//               año cambiaría de campeón la próxima vez que alguien lo
//               recalcule. Nadie puede volver a poner un nombre encima.
//
// ─── POR QUÉ BORRADO BLANDO Y NO deleteUser() A SECAS ───────────────────────
// `auth.admin.deleteUser(id)` borra la fila de auth.users, y TODAS las tablas
// del juego cuelgan de ella con `REFERENCES auth.users(id) ON DELETE CASCADE`:
// se llevaría por delante partidas y podios (justo lo que queremos conservar).
// El segundo argumento activa el borrado BLANDO de GoTrue, que hace exactamente
// lo que necesitamos: deja la fila (así los FK aguantan), ofusca email y
// teléfono, borra credenciales y tokens, ofusca las identidades y marca
// deleted_at — con lo que la cuenta ya no puede volver a iniciar sesión.
//
// ─── ORDEN DELIBERADO ───────────────────────────────────────────────────────
// Primero nuestras tablas, la identidad de auth la ÚLTIMA. Son cuatro llamadas
// sin transacción común (el admin de auth vive en otro servicio, no en
// Postgres), así que si algo revienta a mitad preferimos que sea con la cuenta
// todavía viva: el jugador reintenta y el borrado es idempotente. Al revés
// dejaríamos a alguien sin poder entrar y con su nickname aún en el ranking.
//
// Edge y no Node: es una función de latencia irrelevante pero las Edge no
// gastan uno de los 12 slots de Serverless del plan Hobby (mismo criterio que
// api/push.js y api/get-daily-car.js).

import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "./_lib/supabase.js";
import { checkRateLimit, getClientIpEdge } from "./_lib/ratelimit.js";
import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./_lib/cors.js";

export const config = { runtime: "edge" };

// CORS para la app Android (origen https://localhost). En web (same-origin)
// devuelve {} → no añade headers.
function corsHeadersFor(request) {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}

/**
 * Claves de metadatos del usuario puestas a null. GoTrue MEZCLA el objeto que
 * recibe en `user_metadata` en vez de sustituirlo, así que mandar `{}` no borra
 * nada: la única forma de quitar una clave es enviarla explícitamente a null.
 * De ahí que enumeremos las que YA tiene (name, avatar_url, email… los que
 * planta el proveedor de Google al entrar).
 */
function metadataANull(metadata) {
  const out = {};
  for (const clave of Object.keys(metadata || {})) out[clave] = null;
  return out;
}

export default async function handler(request) {
  // Preflight CORS de la app Android.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) });
  }

  const cors = corsHeadersFor(request);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[delete-account] envs admin ausentes:", missing.join(", "));
    return json({ error: "server_misconfigured" }, 500);
  }

  // Rate limit por IP. Generoso con el reintento (el borrado es idempotente y
  // un fallo a mitad invita a repetir) pero cortando el abuso: es la operación
  // más destructiva que expone la API.
  const ip = getClientIpEdge(request);
  const rl = await checkRateLimit(`delacc:${ip}`, { max: 5, windowSec: 600, prefix: "rl" });
  if (!rl.ok) return json({ error: "rate_limited" }, 429);

  // La identidad SALE DEL JWT, nunca del body: un id de usuario en el cuerpo
  // convertiría esto en un borrado de cuentas ajenas de un solo POST.
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return json({ error: "unauthorized" }, 401);

  let user;
  try {
    const client = createAuthClient(token);
    if (!client) return json({ error: "unauthorized" }, 401);
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return json({ error: "unauthorized" }, 401);
    user = data.user;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = getSupabaseAdmin();
  const uid = user.id;

  // 1) El nombre público. Con esto el jugador ya no sale en ranking, Salón de
  //    Campeones ni perfil público, que es lo que se ve desde fuera.
  const { error: errPerfil } = await admin.from("profiles").delete().eq("id", uid);
  if (errPerfil) {
    console.error("[delete-account] profiles:", errPerfil.message);
    return json({ error: "db_error" }, 500);
  }

  // 2) Suscripciones de push. Sin esto seguiría llegándole el aviso diario.
  const { error: errPush } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", uid);
  if (errPush) {
    console.error("[delete-account] push_subscriptions:", errPush.message);
    return json({ error: "db_error" }, 500);
  }

  // 2b) El buzón. Un mensaje lleva lo que la persona escribió y, a veces, una
  //     dirección de correo suya: es PII y se va con ella. Hay que borrarlo
  //     AQUÍ y no confiar en el ON DELETE CASCADE de la tabla, porque este
  //     endpoint hace borrado BLANDO —la fila de auth.users se queda— y ese
  //     cascade no llega a dispararse nunca. Misma razón por la que
  //     push_subscriptions se borra a mano justo aquí arriba.
  const { error: errMensajes } = await admin
    .from("mensajes")
    .delete()
    .eq("user_id", uid);
  if (errMensajes) {
    // «La tabla no existe» NO puede tumbar un borrado de cuenta. El código y el
    // esquema se despliegan por caminos distintos —un push contra un fichero
    // pegado a mano en el SQL editor— así que entre un deploy y el otro hay una
    // ventana en la que esta tabla todavía no está. Que un jugador no pueda
    // ejercer su derecho de supresión durante esa ventana, por una tabla que
    // además estaría vacía para él, sería el peor cambio posible: es lo único
    // de este endpoint que Play exige que funcione siempre.
    //
    // Cualquier OTRO error sí aborta: si la tabla está y no se deja borrar,
    // quedaría PII de alguien que ha pedido irse, y eso no se puede saldar con
    // un console.warn.
    const noExisteAun = ["PGRST205", "42P01"].includes(errMensajes.code);
    if (!noExisteAun) {
      console.error("[delete-account] mensajes:", errMensajes.message);
      return json({ error: "db_error" }, 500);
    }
    console.warn("[delete-account] mensajes: tabla ausente, se omite");
  }

  // 3) Auditoría antifraude: se desliga de la persona y pierde las huellas del
  //    dispositivo, pero la fila sigue ahí (ver cabecera).
  const { error: errAudit } = await admin
    .from("guess_audit")
    .update({ user_id: null, ua: null, accept_lang: null })
    .eq("user_id", uid);
  if (errAudit) {
    console.error("[delete-account] guess_audit:", errAudit.message);
    return json({ error: "db_error" }, 500);
  }

  // 4) Metadatos del proveedor (nombre y foto de Google). El borrado blando de
  //    GoTrue ofusca email, teléfono e identidades, pero NO toca
  //    raw_user_meta_data: sin este paso el nombre real se quedaría en la fila.
  const meta = metadataANull(user.user_metadata);
  if (Object.keys(meta).length) {
    const { error: errMeta } = await admin.auth.admin.updateUserById(uid, {
      user_metadata: meta,
    });
    // No abortamos: es un paso de higiene y el borrado de la identidad (5) es
    // lo que de verdad cierra la cuenta. Queda el aviso en el log para revisar.
    if (errMeta) console.error("[delete-account] user_metadata:", errMeta.message);
  }

  // 5) La identidad. Borrado BLANDO: la fila de auth.users sobrevive para que
  //    las partidas no caigan en cascada, pero sin email, sin credenciales y
  //    con deleted_at puesto — no se puede volver a entrar.
  const { error: errAuth } = await admin.auth.admin.deleteUser(uid, true);
  if (errAuth) {
    console.error("[delete-account] soft delete:", errAuth.message);
    return json({ error: "auth_error" }, 500);
  }

  // Sin datos del usuario en el log: solo que el borrado ocurrió.
  console.log("[delete-account] cuenta borrada correctamente");

  // OJO en el cliente: el access token que acaba de usarse sigue siendo válido
  // hasta que caduque (es un JWT, no se consulta en cada petición). Por eso
  // src/lib/deleteAccount.js cierra sesión y limpia el estado local ACTO
  // SEGUIDO, en vez de dejar la pantalla como estaba.
  return json({ ok: true });
}
