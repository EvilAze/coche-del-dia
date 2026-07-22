// src/lib/nativeAuth.js
// Sign-in nativo de Google para la app Android (Capacitor). En web NO se usa
// (web va por supabase.auth.signInWithOAuth redirect). El plugin muestra el
// selector de cuenta nativo y devuelve un idToken que cambiamos por una sesión
// Supabase con signInWithIdToken. El plugin se importa de forma PEREZOSA para
// no arrastrarlo en el bundle web.

import { Capacitor } from "@capacitor/core";
import { supabase } from "../supabaseClient";
import { captureClientError } from "./sentry";

const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
let initialized = false;

// Intentos consecutivos que acaban sin sesión y SIN error visible.
//
// Por qué existe este contador: el plugin colapsa fallos reales de Google en
// "cancelado por el usuario". Google envuelve errores como "[16] Account reauth
// failed" (el que teníamos por una SHA-1 sin registrar) en un
// GetCredentialCancellationException, y GoogleProvider.java lo traduce a code
// USER_CANCELLED con el mensaje "Google Sign-In cancelled by user". Desde JS es
// indistinguible de que el usuario cierre el selector a propósito, así que el
// login "no hacía nada" sin dejar rastro: ni toast, ni Sentry, ni consola
// legible en release.
//
// No podemos recuperar la causa real (se pierde antes de cruzar el puente),
// pero sí dejar de fingir que todo va bien. Heurística: cancelar a propósito
// DOS veces seguidas es raro; fallar dos veces seguidas es lo que hace una app
// rota. Al segundo intento avisamos al usuario y mandamos UN evento a Sentry.
// Así el ruido en el free tier es mínimo (regla 8: Sentry solo errores) y una
// rotura deja de ser invisible.
let intentosSinSesion = 0;
const INTENTOS_ANTES_DE_AVISAR = 2;

// Carga perezosa del plugin. Devolvemos la PROMESA del import (el módulo), NUNCA
// el proxy del plugin: devolver o await-ear un proxy de Capacitor accede a su
// `.then`, y eso lo interpreta como una llamada nativa → peta con
// "SocialLogin.then() is not implemented on android".
function loadSocialLogin() {
  return import("@capgo/capacitor-social-login");
}

// Heurística de cancelación: el plugin lanza al cancelar el selector en algunas
// versiones. OJO: también cae aquí cualquier fallo que Google haya tipado como
// cancelación (ver el comentario de intentosSinSesion).
function isUserCancel(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("cancel"); // cubre "cancel", "canceled", "cancelled"
}

// Registra un intento que se queda sin sesión y sin error visible. Devuelve el
// `{ data, error }` que toca: silencioso la primera vez (respeta a quien
// cancela aposta) y con error a partir del segundo, para que App.jsx pinte su
// toast en vez de dejar al usuario mirando la misma pantalla.
function registrarIntentoSinSesion(motivo, detalle) {
  intentosSinSesion += 1;
  console.warn(`[nativeAuth] intento sin sesión (${intentosSinSesion}): ${motivo}`, detalle || "");
  if (intentosSinSesion < INTENTOS_ANTES_DE_AVISAR) return { data: null, error: null };

  const error = new Error(`Login nativo sin sesión tras ${intentosSinSesion} intentos: ${motivo}`);
  // Un solo evento por racha: si el usuario sigue insistiendo no queremos N
  // eventos idénticos comiéndose la cuota.
  if (intentosSinSesion === INTENTOS_ANTES_DE_AVISAR) {
    captureClientError(error, { flujo: "nativeGoogleSignIn", motivo });
  }
  return { data: null, error };
}

// Inicializa el plugin una sola vez (idempotente). Sin WEB_CLIENT_ID no hace
// nada: el login dará un error controlado y el juego sigue anónimo.
export async function initNativeAuth() {
  if (!Capacitor.isNativePlatform() || initialized || !WEB_CLIENT_ID) return;
  const { SocialLogin } = await loadSocialLogin();
  await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID } });
  initialized = true;
}

// Login nativo → sesión Supabase. Devuelve { data, error } estilo supabase.
export async function nativeGoogleSignIn() {
  if (!WEB_CLIENT_ID) {
    const error = new Error("Falta VITE_GOOGLE_WEB_CLIENT_ID");
    console.error("[nativeAuth]", error.message);
    return { data: null, error };
  }
  try {
    await initNativeAuth();
    const { SocialLogin } = await loadSocialLogin();
    const login = await SocialLogin.login({ provider: "google" });
    const idToken = login?.result?.idToken;
    if (!idToken) {
      // Sin idToken: normalmente el usuario canceló el selector, pero también
      // cae aquí un `mode: 'offline'` mal configurado (devuelve serverAuthCode).
      return registrarIntentoSinSesion("el plugin no devolvió idToken");
    }
    const res = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    // Logueamos solo el MENSAJE (nunca el token): si Supabase rechaza el
    // idToken (p.ej. aud no autorizado) el error queda visible para depurar.
    if (res?.error) {
      console.error("[nativeAuth] signInWithIdToken:", res.error.message || res.error);
      // Este sí llega a la UI como error, así que la racha se corta: el usuario
      // ya está informado y el contador solo vigila el camino mudo.
      intentosSinSesion = 0;
      captureClientError(res.error, { flujo: "signInWithIdToken" });
      return res;
    }
    intentosSinSesion = 0;
    return res;
  } catch (err) {
    if (isUserCancel(err)) {
      return registrarIntentoSinSesion("el plugin reportó cancelación", err?.code || "");
    }
    // Errores del plugin que sí vienen tipados: típicamente SHA-1 no registrada
    // en Google Cloud o falta el OAuth client Android del package com.cochedeldia.
    console.error("[nativeAuth] login:", err?.message || err);
    intentosSinSesion = 0;
    captureClientError(err, { flujo: "nativeGoogleSignIn" });
    return { data: null, error: err };
  }
}

// Cierre de sesión del plugin (best-effort). La sesión Supabase la cierra
// signOut() en auth.js; aquí solo limpiamos el estado del plugin nativo.
export async function nativeSignOut() {
  intentosSinSesion = 0;
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { SocialLogin } = await loadSocialLogin();
    await SocialLogin.logout({ provider: "google" });
  } catch {
    /* best-effort: si el logout del plugin falla, no rompemos el sign-out */
  }
}
