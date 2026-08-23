// api/_lib/auth.js
// Helpers centrales de autenticación para los endpoints serverless.
//
// Flujo estándar para un endpoint autenticado:
//
//   import { requireUser } from "./_lib/auth.js";
//   const { user, authClient, error } = await requireUser(req);
//   if (error) return res.status(error.status).json({ error: error.message });
//   // ... operaciones autenticadas con authClient ...
//
// Y si además quieres restringir a admin:
//
//   const { user, authClient, error } = await requireAdmin(req);
//   ...

import { createAuthClient } from "./supabase.js";
import { conTimeout, TimeoutError, PLAZOS } from "./timeout.js";
import { getJwks } from "./jwks.js";

/**
 * Decodifica la cabecera de un JWT sin verificar nada, solo para saber con qué
 * `kid` está firmado y poder pedir esa clave concreta. Verificar es cosa de
 * getClaims; esto es leer el sobre.
 */
function kidDelToken(token) {
  try {
    const [cabecera] = token.split(".");
    const json = atob(cabecera.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json)?.kid || null;
  } catch {
    return null;
  }
}

/**
 * Identidad del portador del token, VERIFICADA EN LOCAL.
 *
 * Antes esto era una llamada a `auth.getUser()`, o sea un viaje a GoTrue en
 * CADA petición autenticada. El 23 de agosto de 2026 eso dejó la web y el
 * panel inservibles para usuarios con sesión durante una degradación del API
 * Gateway de Supabase: PostgREST contestaba en 200 ms y /auth/v1/user no
 * contestaba en 10 s. Un servicio del que dependía cada request y que no
 * teníamos forma de esquivar.
 *
 * `getClaims(jwt, { keys })` verifica la FIRMA del token con WebCrypto contra
 * las claves públicas del proyecto (ES256) y no habla con nadie. Las claves
 * las suministramos desde `jwks.js` —caché de módulo— para que la
 * verificación sea local de verdad; ver allí por qué no vale la caché de la
 * librería.
 *
 * LO QUE ESTO CAMBIA, dicho claro: la validez pasa a depender del `exp` del
 * token y no de lo que opine el servidor AHORA. Una sesión cerrada o revocada
 * sigue siendo válida hasta que caduque su access token (1 h por defecto).
 * Es el trade-off aceptado a cambio de no depender de GoTrue en el camino
 * crítico, y aplica también a admin. Lo que NO cambia es el RLS: las queries
 * siguen yendo con el JWT a PostgREST, que lo valida por su cuenta.
 *
 * Si el proyecto no usa firma asimétrica, o no hay JWKS, o la verificación
 * falla por algo que no sea un token inválido, se cae a `getUser()` — el
 * camino de siempre, con su plazo y su reintento.
 *
 * @returns {Promise<{user?: object, invalido?: boolean, sinClaves?: boolean}>}
 */
async function identidadLocal(client, accessToken) {
  const kid = kidDelToken(accessToken);
  // Sin kid es firma simétrica (HS256): getClaims acabaría llamando a getUser
  // igualmente, así que nos ahorramos el rodeo y vamos directos al respaldo.
  if (!kid) return { sinClaves: true };

  const { keys } = await getJwks({ kid });
  // Tiene que estar LA clave de este token, no basta con que haya claves. Si
  // le pasáramos a getClaims un juego que no incluye su `kid`, la librería se
  // iría por su cuenta a pedir el JWKS por red (fetchJwk cae al endpoint
  // cuando no encuentra la clave suministrada) — o sea, el viaje a GoTrue que
  // todo esto existe para evitar, colado por la puerta de atrás.
  if (!keys.some((k) => k.kid === kid)) return { sinClaves: true };

  try {
    const { data, error } = await client.auth.getClaims(accessToken, { keys });
    if (error || !data?.claims?.sub) return { sinClaves: true };
    const c = data.claims;
    // SOBRE EL `email` AUSENTE, que aquí tuvo un guard y fue un error.
    //
    // Este helper resuelve QUIÉN es el portador del token, y para eso basta
    // con `sub`: es lo único que usan el juego, la repesca y el garaje. El
    // `email` solo lo necesita `requireAdmin`, para cruzarlo con ADMIN_EMAILS.
    //
    // Puse el guard aquí —«sin email no nos vale»— para que un claim ausente
    // no se convirtiera en un 403 silencioso en el panel, y el tiro salió por
    // la culata de la peor manera: con GoTrue caído, TODO usuario cuyo token
    // no trajera email veía su identidad perfectamente verificada tirada a la
    // basura y acababa en un 503. Es decir, un guard pensado para proteger el
    // panel dejó sin jugar a la gente, que no tiene nada que ver con el panel.
    //
    // Ahora la exigencia vive donde importa: `requireAdmin` la pide por
    // `requiereEmail`, y el resto del mundo entra con su `sub` verificado.
    // Forma de `user` equivalente a la que devolvía getUser en lo que el
    // código consume: id, email y user_metadata (delete-account).
    return {
      user: {
        id: c.sub,
        email: c.email ?? null,
        user_metadata: c.user_metadata ?? {},
        app_metadata: c.app_metadata ?? {},
      },
    };
  } catch (err) {
    // Firma mala o token caducado: es un NO definitivo, no un fallo de
    // servicio. Distinguirlo importa, porque caer al respaldo aquí sería
    // pedirle a GoTrue que nos repita que no.
    const nombre = err?.name || "";
    if (nombre === "AuthInvalidJwtError" || /expired|signature|jwt/i.test(err?.message || "")) {
      return { invalido: true };
    }
    console.error("[auth] getClaims falló, se cae a getUser:", err?.message || err);
    return { sinClaves: true };
  }
}

// Whitelist de emails con permisos de admin. Lo dejamos en código (no
// env var) para evitar misconfiguración silenciosa: si quieres añadir
// o quitar un admin, lo ves en un PR y queda auditado en git.
export const ADMIN_EMAILS = ["ievilaze@gmail.com"];

/**
 * Extrae el JWT del header Authorization: "Bearer <token>".
 * Devuelve null si no hay header válido.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {string | null}
 */
export function extractAccessToken(req) {
  const header = req?.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * Pide el usuario a GoTrue con plazo y UN reintento.
 *
 * EL REINTENTO NO ES ADORNO: el modo de fallo observado no es «GoTrue está
 * caído» sino «GoTrue tartamudea». El 23 de agosto de 2026 contestó a
 * /api/garage a las 17:00:43 y dejó de contestar a /api/admin/estado a las
 * 17:03:37, con la misma sesión y el mismo token. Contra un fallo intermitente
 * el segundo intento es lo que de verdad arregla la experiencia; afinar el
 * plazo solo mueve la frontera de a quién le toca fallar.
 *
 * Y SE LE PASA EL JWT EXPLÍCITO. `getUser()` sin argumento se va por
 * `initializePromise` + `_acquireLock` + `_useSession` para acabar leyendo un
 * almacén de sesión que aquí SIEMPRE está vacío (creamos el cliente con
 * `persistSession: false`), y termina mandando la petición gracias a la
 * cabecera Authorization global. `getUser(jwt)` entra directo al request
 * —`if (jwt) return await this._getUser(jwt)`—: mismo resultado, camino corto
 * y sin estado compartido de por medio. Es el patrón que la librería
 * documenta para servidor.
 *
 * @param {string} accessToken
 * @returns {Promise<{data?: any, error?: any, timedOut?: boolean}>}
 */
async function pedirUsuario(client, accessToken) {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      return await conTimeout(client.auth.getUser(accessToken), PLAZOS.AUTH, {
        etiqueta: `auth.getUser (intento ${intento})`,
      });
    } catch (err) {
      if (!(err instanceof TimeoutError)) throw err;
      console.error(
        `[auth] GoTrue no respondió en ${PLAZOS.AUTH} ms (intento ${intento}/2)`
      );
      if (intento === 2) return { timedOut: true };
    }
  }
}

/**
 * Resuelve sesión + cliente con JWT. NO falla por sí mismo: devuelve
 * {user: null, client: null} si no hay token válido. Pensado para
 * usarse desde requireUser/requireAdmin o desde endpoints que aceptan
 * usuarios anónimos opcionalmente.
 *
 * @param {string | null} accessToken
 */
export async function authClientAndUser(accessToken, { requiereEmail = false } = {}) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createAuthClient(accessToken);
    if (!client) return { client: null, user: null };

    // 1) Camino normal: firma verificada en local, sin red.
    const local = await identidadLocal(client, accessToken);
    // `requiereEmail` solo lo pide requireAdmin: si el token no trae el claim
    // y hace falta para autorizar, se pregunta a GoTrue en vez de contestar un
    // 403 que sería mentira. Para todos los demás, con el `sub` verificado
    // sobra — y ahí está la diferencia entre que la gente juegue o no.
    if (local.user && (!requiereEmail || local.user.email)) {
      return { client, user: local.user };
    }
    if (local.user && requiereEmail) {
      console.error("[auth] claims sin email y hace falta para admin, se pregunta a GoTrue");
    }
    if (local.invalido) return { client: null, user: null };

    // 2) Respaldo: preguntarle a GoTrue, como se hacía antes. Solo se llega
    //    aquí si no hay claves con las que verificar (firma simétrica, JWKS
    //    ilegible) — no por un token que sencillamente no vale.
    const { data, error, timedOut } = await pedirUsuario(client, accessToken);
    if (timedOut) return { client: null, user: null, timedOut: true };
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch (err) {
    // `timedOut` separa DOS cosas que este helper venía devolviendo iguales:
    // «el token no vale» y «no hemos podido comprobar si vale». La primera es
    // un 401 —y es definitiva, no tiene sentido reintentar—; la segunda es un
    // 503 temporal. Contestar 401 a un atranco de GoTrue manda al usuario a
    // volver a iniciar sesión por un problema que no es suyo y que se arregla
    // solo en un minuto.
    if (err instanceof TimeoutError) {
      return { client: null, user: null, timedOut: true };
    }
    return { client: null, user: null };
  }
}

/**
 * Garantiza que la petición lleva un usuario autenticado válido.
 * Si no, devuelve {error: {status, message}}; el handler debe responder
 * `res.status(error.status).json({ error: error.message })` y retornar.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {Promise<{user: any, authClient: any, error?: undefined} | {error: {status: number, message: string}, user?: undefined, authClient?: undefined}>}
 */
export async function requireUser(req, opciones) {
  const token = extractAccessToken(req);
  const { client, user, timedOut } = await authClientAndUser(token, opciones);
  if (timedOut) {
    // 503, no 401: el token puede ser perfectamente válido, lo que ha fallado
    // es el servicio que lo comprueba. Retry-After para que el cliente sepa
    // que esto se reintenta, no se resuelve volviendo a entrar.
    return { error: { status: 503, message: "Auth temporarily unavailable", retryAfter: 5 } };
  }
  if (!user || !client) {
    return { error: { status: 401, message: "Unauthorized" } };
  }
  return { user, authClient: client };
}

/**
 * Como requireUser, pero además exige que el email del usuario esté
 * en ADMIN_EMAILS. Idéntico patrón de retorno.
 *
 * @param {import("@vercel/node").VercelRequest} req
 */
export async function requireAdmin(req) {
  // requiereEmail: aquí SÍ, porque la autorización se decide comparando el
  // email con ADMIN_EMAILS. Un token sin ese claim no puede autorizarse en
  // local, así que se paga el viaje a GoTrue — pero solo aquí, y solo para
  // admin. Ver la nota de identidadLocal sobre por qué esto no puede vivir
  // en el camino común.
  const base = await requireUser(req, { requiereEmail: true });
  if (base.error) return base;
  const email = (base.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    return { error: { status: 403, message: "Forbidden" } };
  }
  return base;
}
