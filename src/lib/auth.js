// src/lib/auth.js
// Helpers de autenticación unificados web/nativo. En web mantienen el flujo
// actual (signInWithOAuth redirect); en la app Android (Capacitor) usan el
// sign-in nativo de Google (selector de cuenta → signInWithIdToken). Centralizar
// aquí evita esparcir el branch por-plataforma en los componentes.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";
import { nativeGoogleSignIn, nativeSignOut } from "./nativeAuth";

/**
 * ¿Es este usuario una CUENTA REAL (no una sesión anónima)?
 *
 * Regla central del modelo de sesión, y por eso vive aquí y la usan por igual
 * useAuthSession y useGame. Desde que existen las sesiones anónimas de Supabase,
 * "tener sesión" y "tener cuenta" dejaron de ser lo mismo: un jugador anónimo
 * tiene JWT, rol `authenticated` y fila en auth.users, pero NO es un usuario
 * registrado a efectos de la interfaz.
 *
 * Mantener `user` significando SOLO cuenta real es lo que permitió meter las
 * sesiones anónimas sin tocar los ~59 sitios de la UI que preguntan `if (user)`
 * para decidir entre ENTRAR y PERFIL, entre «guarda tu progreso» y el ranking.
 * Todos siguen queriendo decir lo mismo y siguen acertando.
 */
export function esCuentaReal(user) {
  return Boolean(user) && user.is_anonymous !== true;
}

/**
 * Crea la sesión anónima si aún no hay ninguna. Devuelve la sesión vigente, o
 * null si no se pudo (que es un final perfectamente válido, ver abajo).
 *
 * CUÁNDO se llama: al enviar el PRIMER intento, no al cargar la página. El
 * visitante que entra, mira la foto y se va no deja fila en auth.users ni suma
 * al MAU; la sesión nace cuando el jugador demuestra que está jugando. Y no
 * más tarde (p.ej. al terminar la partida) porque entonces los intentos ya se
 * habrían jugado sin JWT: no estarían en `user_guesses` y la racha empezaría a
 * contar al día siguiente. En el primer intento, todo lo demás persiste solo
 * por el camino de siempre.
 *
 * SI FALLA, NO PASA NADA (regla 9). El caso normal de fallo es que «Anonymous
 * sign-ins» esté desactivado en el dashboard de Supabase. Devolvemos null y el
 * juego sigue por el flujo anónimo de toda la vida (token HMAC firmado +
 * snapshot en localStorage): exactamente el comportamiento de antes de esto.
 */
export async function asegurarSesionAnonima() {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return data.session;

    const { data: nueva, error } = await supabase.auth.signInAnonymously();
    if (error) {
      // No es un error de la aplicación: puede ser una decisión de config.
      console.warn("[auth] sesión anónima no disponible:", error.message);
      return null;
    }
    return nueva?.session ?? null;
  } catch (err) {
    console.warn("[auth] sesión anónima falló:", err?.message || err);
    return null;
  }
}

/**
 * Id de la sesión anónima vigente, o null si no hay o no es anónima.
 *
 * Devuelve el ID y no un booleano porque hay dos consumidores con necesidades
 * distintas: quien solo quiere saber «¿vinculo o entro?» lo usa como condición
 * (un id es truthy), y quien va a redirigir a Google necesita apuntar DE QUÉ
 * cuenta venía para poder decir después si la vinculación conservó el progreso.
 */
async function idAnonimoVigente() {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    return u && u.is_anonymous === true ? u.id : null;
  } catch {
    return null;
  }
}

// ── La nota que sobrevive al redirect ──────────────────────────────────────
// En web, entrar con Google se lleva la página entera a otro dominio y la trae
// de vuelta recargada. Eso hace INOBSERVABLE el éxito: al volver, la sesión ya
// está puesta y es indistinguible de haber llegado ya logueado. Sin esta nota,
// `login_success` mediría todos los caminos MENOS el que usa la mayoría.
//
// sessionStorage y no localStorage a propósito: la nota tiene que morir con la
// pestaña. Una que sobreviviera al cierre convertiría la siguiente visita en un
// login falso.
const CLAVE_LOGIN = "ccd_login_en_curso";

/** Apunta que ESTA pestaña se va a un redirect de login. @param {string|null} anonId */
export function marcarLoginEnCurso(method, anonId) {
  try {
    sessionStorage.setItem(CLAVE_LOGIN, JSON.stringify({ method, anonId: anonId ?? null }));
  } catch {
    // Sin sessionStorage (modo privado, sandbox) solo se pierde la métrica. La
    // entrada funciona igual: medir nunca puede impedir entrar (regla 9).
  }
}

/** Lee la nota y LA CONSUME. Devuelve null si no había, o si estaba corrupta. */
export function leerLoginEnCurso() {
  try {
    const raw = sessionStorage.getItem(CLAVE_LOGIN);
    if (!raw) return null;
    sessionStorage.removeItem(CLAVE_LOGIN);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Entrar con Google.
 *
 * @param {object} [opciones]
 * @param {boolean} [opciones.vincular=true]  Si hay sesión anónima, intentar
 *   conservarla vinculando la identidad. Con `false` se entra directamente a la
 *   cuenta de Google, descartando el progreso anónimo de este dispositivo — es
 *   lo que necesita el botón de recuperación cuando la vinculación ya falló.
 *
 * OJO CON EL ERROR DE linkIdentity: redirige igual que signInWithOAuth, así que
 * un rechazo del SERVIDOR (el caso normal: esa cuenta de Google ya pertenece a
 * otro usuario) no puede volver en el valor de esta llamada — para cuando el
 * servidor decide, el navegador ya se fue a Google. Vuelve en la URL de retorno
 * y lo recoge lib/authCallback.js. El `res.error` de aquí abajo solo caza los
 * fallos PREVIOS al redirect, que son los menos.
 */
export async function signInWithGoogle({ vincular = true } = {}) {
  if (Capacitor.isNativePlatform()) {
    // Nativo no redirige: la sesión aparece en esta misma página y
    // useAuthSession la ve como transición. Dejar nota aquí sería dejar una que
    // nadie va a leer y que ensuciaría el siguiente login de la pestaña.
    return nativeGoogleSignIn();
  }

  const anonId = await idAnonimoVigente();
  marcarLoginEnCurso("google", anonId);

  // Con sesión anónima en curso, VINCULAMOS en vez de entrar: linkIdentity
  // conserva el mismo user id, y con él la racha, las estadísticas y el
  // Archivo que el jugador acumuló como anónimo. Es la diferencia entre
  // «regístrate» y «no pierdas lo que llevas».
  if (vincular && anonId) {
    const res = await supabase.auth.linkIdentity({ provider: "google" });
    if (!res?.error) return res;
    console.warn("[auth] linkIdentity rechazado antes de redirigir:", res.error.message);
  }

  return supabase.auth.signInWithOAuth({ provider: "google" });
}

/**
 * ¿Está disponible la entrada por correo (código de 6 cifras)?
 *
 * Detrás de un flag A PROPÓSITO: sin SMTP propio, el email integrado de
 * Supabase va limitado a 2 correos/hora en TODO el proyecto, y una puerta de
 * entrada que falla es peor que no tenerla. Se enciende solo tras configurar
 * SMTP (hoy, Resend — ver docs/correo-de-entrada.md).
 *
 * EN NATIVO SE EXCLUYE, y el motivo ya no es el de antes. Antes era técnico: el
 * enlace abría el navegador del sistema y la sesión nacía FUERA del WebView. Con
 * un código eso dejó de ser cierto — pero el correo lleva AMBAS cosas, enlace y
 * código, para que en escritorio se pulse y en móvil se teclee. Y ahí está la
 * trampa: los dos son EL MISMO token, así que usar uno invalida el otro. A un
 * jugador dentro del APK que pulse el enlace por costumbre —que es lo que hace
 * todo el mundo con un correo así— la sesión se le crea en el navegador y el
 * código que iba a escribir en la app ya no vale. Se queda a medias, logueado
 * donde no estaba jugando.
 *
 * Mientras el correo lleve enlace, la segunda puerta no puede vivir en la app.
 * Si algún día el enlace se retira, esta exclusión se va con él (y entonces el
 * APK gana su segunda puerta, que es lo que hoy no tiene).
 */
export function emailLoginDisponible() {
  if (Capacitor.isNativePlatform()) return false;
  return import.meta.env.VITE_EMAIL_LOGIN === "true";
}

/**
 * PASO 1 — pide un código de 6 cifras al correo.
 *
 * Devuelve `{ error, tipo }`. El `tipo` no es decoración: `verifyOtp` lo exige
 * y son DOS TOKENS DISTINTOS.
 *
 *   - Sin sesión anónima → `signInWithOtp` → token de tipo `email`.
 *   - Con sesión anónima → `updateUser({ email })`, que ADJUNTA el correo a la
 *     cuenta que ya existe (mismo user id → la racha, las estadísticas y el
 *     Archivo sobreviven) → token de tipo `email_change`.
 *
 * Por eso el tipo viaja hasta el paso 2 en vez de recalcularse allí: entre los
 * dos pasos pueden pasar minutos, y si la sesión cambiara de estado por el
 * camino recalcularlo rechazaría un código perfectamente válido.
 *
 * `shouldCreateUser: true` a propósito: para un juego diario, distinguir
 * «registro» de «acceso» es una diferencia que solo le importa a la base de
 * datos. Pones tu correo y entras.
 */
/**
 * A dónde vuelve el enlace del correo. A la PORTADA, no a la URL desde la que
 * se pidió: el correo puede abrirse horas después y en otro dispositivo.
 *
 * Sin `window` (SSR, tests en node) devuelve undefined a propósito: Supabase
 * cae entonces al Site URL del proyecto, que es el destino correcto. Leerlo a
 * pelo lanzaba aquí.
 *
 * Lo usan LOS DOS caminos. Antes solo lo ponía `signInWithOtp`, y `updateUser`
 * —por donde va la mayoría, porque la sesión anónima nace en el primer intento—
 * se quedaba sin él: su enlace acababa igualmente en la portada, pero por el
 * Site URL del dashboard. O sea que el destino del camino mayoritario dependía
 * de un ajuste que no está a la vista de nadie que lea este fichero.
 */
function destinoDelEnlace() {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export async function pedirCodigo(email) {
  if (await idAnonimoVigente()) {
    const res = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: destinoDelEnlace() }
    );
    if (!res?.error) return { error: null, tipo: "email_change", correoOcupado: false };

    // El correo ya pertenece a otra cuenta. No tiene arreglo por vinculación:
    // son dos cuentas distintas y hay que entrar a la que ya existe, a costa
    // del progreso anónimo de este dispositivo.
    console.warn("[auth] adjuntar el correo falló, pidiendo código normal:", res.error.message);
    const otp = await pedirOtp(email);
    // `correoOcupado` NO es telemetría: es lo que le debemos al jugador. Este
    // es el mismo caso que con Google enseña `app.loginLinkTakenBody` tras el
    // redirect, y por el camino del correo se estaba resolviendo EN SILENCIO —
    // un anónimo con nueve días de racha tecleaba su correo, entraba, y la
    // racha desaparecía sin que nadie le hubiera dicho que iba a pasar.
    // Avisando antes de que gaste el código todavía puede echarse atrás.
    return { error: otp.error, tipo: "email", correoOcupado: true };
  }

  const otp = await pedirOtp(email);
  return { error: otp.error, tipo: "email", correoOcupado: false };
}

/** El envío normal del código. Extraído porque lo piden los DOS caminos. */
async function pedirOtp(email) {
  const res = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // El correo lleva enlace ADEMÁS del código (escritorio pulsa, móvil
      // teclea), así que el enlace necesita un destino. Ver destinoDelEnlace().
      emailRedirectTo: destinoDelEnlace(),
    },
  });
  return { error: res?.error ?? null };
}

/**
 * PASO 2 — canjea el código por una sesión.
 *
 * No decide el `tipo`: se lo da quien llamó a `pedirCodigo`. Ver allí el
 * porqué. Devuelve `{ data, error }` estilo Supabase; la sesión, si sale bien,
 * la recoge `onAuthStateChange` (useAuthSession) como cualquier otra.
 */
export async function verificarCodigo(email, codigo, tipo) {
  return supabase.auth.verifyOtp({ email, token: codigo, type: tipo });
}

/**
 * ¿Hay sesión de Supabase en localStorage? Lectura SÍNCRONA, para decisiones de
 * layout que hay que tomar en el PRIMER render y no pueden esperar al
 * `onAuthStateChange` (que resuelve async y provocaría un salto de altura).
 *
 * Es una heurística deliberada, no una verificación: mira si existe la clave
 * `sb-<projectref>-auth-token` con valor. NO valida el token — un token caducado
 * cuenta como sesión. Para todo lo que dependa de la identidad real manda
 * `useAuthSession`; esto solo sirve para elegir dónde colocar una pieza y
 * acertar en el 99% de los casos sin parpadeo.
 */
// Aquí vivía una marca propia en localStorage (`ccd_cuenta_real`) con
// `marcarCuentaReal()` / `hayCuentaRealLocal()`: una lectura SÍNCRONA de «la
// última sesión conocida era una cuenta registrada», para que Configurator
// colocara la faja de clasificación en el primer render sin esperar a Supabase.
// Esa faja ya no decide nada por su cuenta —recibe `rank` y `rankCargando`
// desde App, que salen del servidor—, así que el lector desapareció y quedó
// solo el escritor: useAuthSession sellaba una clave que no leía nadie.
//
// Lo que sí sigue vivo es haySesionLocal(): ¿hay CUALQUIER sesión, también
// anónima? La usa useGame para saber si puede fiarse del snapshot de
// localStorage — con sesión anónima ya manda el servidor, porque los intentos
// se persisten.
export function haySesionLocal() {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) {
        const val = localStorage.getItem(key);
        if (val && val !== "null" && val !== '""') return true;
      }
    }
    return false;
  } catch {
    // Modo privado / sandbox sin localStorage: tratamos como anónimo, que es
    // el lado prudente (la pieza cae abajo, nunca ocupa cabecera de más).
    return false;
  }
}

export async function signOut() {
  const result = await supabase.auth.signOut();
  if (Capacitor.isNativePlatform()) {
    await nativeSignOut();
  }
  return result;
}
