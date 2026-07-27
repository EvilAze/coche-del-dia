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
