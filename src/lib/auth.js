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

/** ¿La sesión vigente es anónima? (Para decidir entre vincular y entrar.) */
async function sesionAnonimaVigente() {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    return Boolean(u && u.is_anonymous === true);
  } catch {
    return false;
  }
}

export async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    return nativeGoogleSignIn();
  }

  // Con sesión anónima en curso, VINCULAMOS en vez de entrar: linkIdentity
  // conserva el mismo user id, y con él la racha, las estadísticas y el
  // Archivo que el jugador acumuló como anónimo. Es la diferencia entre
  // «regístrate» y «no pierdas lo que llevas».
  if (await sesionAnonimaVigente()) {
    const res = await supabase.auth.linkIdentity({ provider: "google" });
    // linkIdentity exige «Manual linking» habilitado en el dashboard. Si no lo
    // está, caemos al login normal: el jugador pierde el progreso anónimo, sí,
    // pero ENTRA — y perderlo es exactamente lo que pasaba antes de que las
    // sesiones anónimas existieran, así que el fallback nunca deja al usuario
    // peor que el statu quo. Quedarnos sin login sí lo dejaría.
    if (!res?.error) return res;
    console.warn("[auth] linkIdentity no disponible, entrando normal:", res.error.message);
  }

  return supabase.auth.signInWithOAuth({ provider: "google" });
}

/**
 * ¿Está disponible la entrada por email (magic link)?
 *
 * Detrás de un flag A PROPÓSITO. El servicio de email integrado de Supabase
 * está limitado a **2 correos por hora en todo el proyecto** (rate limit de
 * plataforma, no por usuario): sin un SMTP propio configurado, el tercer
 * jugador que pida su enlace en una misma hora recibe un error. Una puerta de
 * entrada que falla es peor que no tenerla, así que la opción no se pinta hasta
 * que `VITE_EMAIL_LOGIN` valga "true" — lo que debe hacerse SOLO después de
 * configurar SMTP propio (Resend, SendGrid, SES…) en el dashboard.
 *
 * En nativo queda fuera: el enlace del correo abriría el navegador del sistema
 * y la sesión se crearía FUERA del WebView de la app, que es donde tendría que
 * estar. Eso necesita App Links resueltos (ver docs/android-build-release.md) y
 * es harina de otro costal.
 */
export function emailLoginDisponible() {
  if (Capacitor.isNativePlatform()) return false;
  return import.meta.env.VITE_EMAIL_LOGIN === "true";
}

/**
 * Envía un enlace de acceso al correo. No crea sesión aquí: el jugador vuelve
 * desde su correo y `detectSessionInUrl` (activado por defecto en el cliente de
 * supabase-js) la establece al cargar la página.
 *
 * `shouldCreateUser: true` a propósito: para un juego diario, distinguir
 * «registro» de «acceso» es una diferencia que solo le importa a la base de
 * datos. Pones tu correo y entras.
 */
export async function signInWithEmail(email) {
  // Igual que con Google: con sesión anónima en curso, ADJUNTAMOS el correo a
  // esa cuenta en vez de crear otra. Mismo user id → la racha sobrevive.
  // updateUser manda su propio correo de confirmación, así que para el jugador
  // el flujo se ve idéntico: le llega un enlace y al abrirlo está dentro.
  if (await sesionAnonimaVigente()) {
    const res = await supabase.auth.updateUser({ email });
    if (!res?.error) return res;
    // Si el correo ya pertenece a otra cuenta, updateUser falla y NO tiene
    // arreglo por vinculación: hay que entrar a la cuenta que ya existe. El
    // magic link normal hace justo eso (a costa del progreso anónimo, que es
    // inevitable — son dos cuentas distintas).
    console.warn("[auth] vincular correo falló, enviando enlace normal:", res.error.message);
  }

  return supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // Volver a la portada, no a la URL exacta desde la que se pidió: el
      // enlace puede abrirse horas después y en otro dispositivo.
      //
      // Sin `window` (SSR, tests en entorno node) lo dejamos en undefined a
      // propósito: Supabase cae entonces al Site URL del proyecto, que es
      // exactamente el destino correcto. Leerlo a pelo lanzaba aquí.
      emailRedirectTo:
        typeof window === "undefined" ? undefined : window.location.origin,
    },
  });
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
// Marca propia de «la última sesión conocida era una CUENTA REAL». La escribe
// useAuthSession en cada sync.
//
// Existe porque hay dos preguntas distintas que antes eran la misma:
//   · haySesionLocal()      → ¿hay CUALQUIER sesión? (también anónima). La usa
//                             useGame para saber si puede fiarse del snapshot
//                             de localStorage: con sesión anónima ya manda el
//                             servidor, porque los intentos se persisten.
//   · hayCuentaRealLocal()  → ¿hay sesión REGISTRADA? La usa Configurator para
//                             colocar la faja de clasificación, que solo tiene
//                             sentido en cabecera para quien puede tener puesto.
//
// Es una marca nuestra y no una lectura del blob de Supabase a propósito: el
// formato de ese valor es interno (supabase-js lo guarda con prefijo `base64-`
// en versiones recientes) y parsearlo para sacar `is_anonymous` sería atarnos a
// un detalle que puede cambiar en cualquier minor.
const CLAVE_CUENTA_REAL = "ccd_cuenta_real";

export function marcarCuentaReal(esReal) {
  try {
    if (esReal) localStorage.setItem(CLAVE_CUENTA_REAL, "1");
    else localStorage.removeItem(CLAVE_CUENTA_REAL);
  } catch {
    // Modo privado / sandbox: sin marca. La faja caerá al sitio del anónimo,
    // que es el lado prudente.
  }
}

/** ¿La última sesión conocida era de una cuenta registrada? Lectura síncrona. */
export function hayCuentaRealLocal() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CLAVE_CUENTA_REAL) === "1";
  } catch {
    return false;
  }
}

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
