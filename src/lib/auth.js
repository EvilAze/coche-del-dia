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
    return nativeGoogleSignIn();
  }

  // Con sesión anónima en curso, VINCULAMOS en vez de entrar: linkIdentity
  // conserva el mismo user id, y con él la racha, las estadísticas y el
  // Archivo que el jugador acumuló como anónimo. Es la diferencia entre
  // «regístrate» y «no pierdas lo que llevas».
  if (vincular && (await sesionAnonimaVigente())) {
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
 * SMTP (hoy, Resend — ver docs/correo-magic-link.md).
 *
 * EN NATIVO YA NO SE EXCLUYE. Mientras el método era un enlace, en la app
 * estaba apagado porque el enlace abría el navegador del sistema y la sesión
 * nacía FUERA del WebView. Un código se teclea donde estás, así que ese motivo
 * caducó — y la app es justo donde más falta hace, porque allí Google era el
 * único camino que había.
 */
export function emailLoginDisponible() {
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
export async function pedirCodigo(email) {
  if (await sesionAnonimaVigente()) {
    const res = await supabase.auth.updateUser({ email });
    if (!res?.error) return { error: null, tipo: "email_change" };
    // El correo ya pertenece a otra cuenta. No tiene arreglo por vinculación:
    // son dos cuentas distintas y hay que entrar a la que ya existe, a costa
    // del progreso anónimo de este dispositivo.
    console.warn("[auth] adjuntar el correo falló, pidiendo código normal:", res.error.message);
  }

  const res = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return { error: res?.error ?? null, tipo: "email" };
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
