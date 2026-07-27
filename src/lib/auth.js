// src/lib/auth.js
// Helpers de autenticación unificados web/nativo. En web mantienen el flujo
// actual (signInWithOAuth redirect); en la app Android (Capacitor) usan el
// sign-in nativo de Google (selector de cuenta → signInWithIdToken). Centralizar
// aquí evita esparcir el branch por-plataforma en los componentes.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";
import { nativeGoogleSignIn, nativeSignOut } from "./nativeAuth";

export async function signInWithGoogle() {
  if (Capacitor.isNativePlatform()) {
    return nativeGoogleSignIn();
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
