// src/lib/nativeAuth.js
// Sign-in nativo de Google para la app Android (Capacitor). En web NO se usa
// (web va por supabase.auth.signInWithOAuth redirect). El plugin muestra el
// selector de cuenta nativo y devuelve un idToken que cambiamos por una sesión
// Supabase con signInWithIdToken. El plugin se importa de forma PEREZOSA para
// no arrastrarlo en el bundle web.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
let initialized = false;

async function plugin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  return SocialLogin;
}

// Heurística de cancelación: el plugin lanza al cancelar el selector en algunas
// versiones; lo tratamos como no-op (sin error visible).
function isUserCancel(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("cancel"); // cubre "cancel", "canceled", "cancelled"
}

// Inicializa el plugin una sola vez (idempotente). Sin WEB_CLIENT_ID no hace
// nada: el login dará un error controlado y el juego sigue anónimo.
export async function initNativeAuth() {
  if (!Capacitor.isNativePlatform() || initialized || !WEB_CLIENT_ID) return;
  const SocialLogin = await plugin();
  await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID } });
  initialized = true;
}

// Login nativo → sesión Supabase. Devuelve { data, error } estilo supabase.
export async function nativeGoogleSignIn() {
  if (!WEB_CLIENT_ID) {
    return { data: null, error: new Error("Falta VITE_GOOGLE_WEB_CLIENT_ID") };
  }
  try {
    await initNativeAuth();
    const SocialLogin = await plugin();
    const login = await SocialLogin.login({ provider: "google" });
    const idToken = login?.result?.idToken;
    if (!idToken) {
      // Sin idToken: normalmente el usuario canceló el selector.
      return { data: null, error: null };
    }
    return await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
  } catch (err) {
    if (isUserCancel(err)) return { data: null, error: null };
    return { data: null, error: err };
  }
}

// Cierre de sesión del plugin (best-effort). La sesión Supabase la cierra
// signOut() en auth.js; aquí solo limpiamos el estado del plugin nativo.
export async function nativeSignOut() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const SocialLogin = await plugin();
    await SocialLogin.logout({ provider: "google" });
  } catch {
    /* best-effort: si el logout del plugin falla, no rompemos el sign-out */
  }
}
