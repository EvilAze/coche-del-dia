// src/lib/auth.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Patrón del repo: vi.doMock + vi.resetModules + await import (entorno node).
function setup({ isNative, emailLogin }) {
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOutSb = vi.fn().mockResolvedValue({ error: null });
  const nativeGoogleSignIn = vi.fn().mockResolvedValue({ data: {}, error: null });
  const nativeSignOut = vi.fn().mockResolvedValue();
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => isNative },
  }));
  vi.doMock("../supabaseClient", () => ({
    supabase: { auth: { signInWithOAuth, signInWithOtp, signOut: signOutSb } },
  }));
  vi.doMock("./nativeAuth", () => ({ nativeGoogleSignIn, nativeSignOut }));
  vi.stubEnv("VITE_EMAIL_LOGIN", emailLogin ?? "");
  return { signInWithOAuth, signInWithOtp, signOutSb, nativeGoogleSignIn, nativeSignOut };
}

describe("auth helpers", () => {
  beforeEach(() => vi.resetModules());

  it("web: signInWithGoogle usa signInWithOAuth de Supabase", async () => {
    const m = setup({ isNative: false });
    const { signInWithGoogle } = await import("./auth");
    await signInWithGoogle();
    expect(m.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
    expect(m.nativeGoogleSignIn).not.toHaveBeenCalled();
  });

  it("nativo: signInWithGoogle usa el flujo nativo", async () => {
    const m = setup({ isNative: true });
    const { signInWithGoogle } = await import("./auth");
    await signInWithGoogle();
    expect(m.nativeGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(m.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("web: signOut solo cierra la sesión Supabase", async () => {
    const m = setup({ isNative: false });
    const { signOut } = await import("./auth");
    await signOut();
    expect(m.signOutSb).toHaveBeenCalledTimes(1);
    expect(m.nativeSignOut).not.toHaveBeenCalled();
  });

  it("nativo: signOut cierra Supabase y además el plugin", async () => {
    const m = setup({ isNative: true });
    const { signOut } = await import("./auth");
    await signOut();
    expect(m.signOutSb).toHaveBeenCalledTimes(1);
    expect(m.nativeSignOut).toHaveBeenCalledTimes(1);
  });

  // ── Entrada por correo (magic link) ──────────────────────────────────────
  // El flag existe porque el email integrado de Supabase va limitado a 2
  // correos/hora en TODO el proyecto: sin SMTP propio, la opción no debe
  // pintarse. Por defecto (env sin poner) tiene que estar APAGADA.
  it("email: apagado por defecto, sin VITE_EMAIL_LOGIN", async () => {
    setup({ isNative: false });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(false);
  });

  it("email: solo se enciende con el flag EXACTAMENTE en 'true'", async () => {
    setup({ isNative: false, emailLogin: "true" });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(true);
  });

  it("email: un flag con otro valor no lo enciende", async () => {
    setup({ isNative: false, emailLogin: "1" });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(false);
  });

  // En nativo el enlace abriría el navegador del sistema y la sesión nacería
  // FUERA del WebView de la app. Apagado aunque el flag esté puesto.
  it("email: en nativo queda apagado aunque el flag esté encendido", async () => {
    setup({ isNative: true, emailLogin: "true" });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(false);
  });

  it("email: signInWithEmail pide OTP creando usuario y vuelve al origen", async () => {
    const m = setup({ isNative: false, emailLogin: "true" });
    vi.stubGlobal("window", { location: { origin: "https://cochedeldia.com" } });
    const { signInWithEmail } = await import("./auth");
    await signInWithEmail("piloto@ejemplo.com");
    expect(m.signInWithOtp).toHaveBeenCalledWith({
      email: "piloto@ejemplo.com",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "https://cochedeldia.com",
      },
    });
    vi.unstubAllGlobals();
  });

  // Entorno sin `window` (tests en node, cualquier render fuera del navegador):
  // no debe lanzar — Supabase cae al Site URL del proyecto.
  it("email: sin window, el redirect queda undefined en vez de reventar", async () => {
    const m = setup({ isNative: false, emailLogin: "true" });
    const { signInWithEmail } = await import("./auth");
    await expect(signInWithEmail("piloto@ejemplo.com")).resolves.toBeDefined();
    expect(m.signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBeUndefined();
  });
});
