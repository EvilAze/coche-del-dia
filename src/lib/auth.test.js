// src/lib/auth.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Patrón del repo: vi.doMock + vi.resetModules + await import (entorno node).
// `sesion`: null (sin sesión) | "anon" | "real".
function setup({ isNative, emailLogin, sesion = null, linkFalla = false }) {
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOutSb = vi.fn().mockResolvedValue({ error: null });
  const nativeGoogleSignIn = vi.fn().mockResolvedValue({ data: {}, error: null });
  const nativeSignOut = vi.fn().mockResolvedValue();

  const sesionObj =
    sesion === null
      ? null
      : { access_token: "jwt", user: { id: "u1", is_anonymous: sesion === "anon" } };

  const getSession = vi.fn().mockResolvedValue({ data: { session: sesionObj } });
  const signInAnonymously = vi
    .fn()
    .mockResolvedValue({ data: { session: { access_token: "jwt-anon" } }, error: null });
  const linkIdentity = vi.fn().mockResolvedValue(
    linkFalla ? { error: { message: "manual linking disabled" } } : { data: {}, error: null }
  );
  const updateUser = vi.fn().mockResolvedValue(
    linkFalla ? { error: { message: "email taken" } } : { data: {}, error: null }
  );

  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => isNative },
  }));
  vi.doMock("../supabaseClient", () => ({
    supabase: {
      auth: {
        signInWithOAuth, signInWithOtp, signOut: signOutSb,
        getSession, signInAnonymously, linkIdentity, updateUser,
      },
    },
  }));
  vi.doMock("./nativeAuth", () => ({ nativeGoogleSignIn, nativeSignOut }));
  vi.stubEnv("VITE_EMAIL_LOGIN", emailLogin ?? "");
  return {
    signInWithOAuth, signInWithOtp, signOutSb, nativeGoogleSignIn, nativeSignOut,
    getSession, signInAnonymously, linkIdentity, updateUser,
  };
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

  // ── Sesión anónima ───────────────────────────────────────────────────────
  describe("esCuentaReal", () => {
    it("distingue cuenta registrada de sesión anónima y de nada", async () => {
      setup({ isNative: false });
      const { esCuentaReal } = await import("./auth");
      expect(esCuentaReal({ id: "u1" })).toBe(true);
      expect(esCuentaReal({ id: "u1", is_anonymous: false })).toBe(true);
      expect(esCuentaReal({ id: "u1", is_anonymous: true })).toBe(false);
      expect(esCuentaReal(null)).toBe(false);
      expect(esCuentaReal(undefined)).toBe(false);
    });
  });

  describe("asegurarSesionAnonima", () => {
    it("con sesión ya existente NO crea otra", async () => {
      const m = setup({ isNative: false, sesion: "real" });
      const { asegurarSesionAnonima } = await import("./auth");
      await asegurarSesionAnonima();
      expect(m.signInAnonymously).not.toHaveBeenCalled();
    });

    it("sin sesión, crea la anónima", async () => {
      const m = setup({ isNative: false, sesion: null });
      const { asegurarSesionAnonima } = await import("./auth");
      const s = await asegurarSesionAnonima();
      expect(m.signInAnonymously).toHaveBeenCalledTimes(1);
      expect(s).toEqual({ access_token: "jwt-anon" });
    });

    // Regla 9: si «Anonymous sign-ins» está desactivado en el dashboard, el
    // juego NO se degrada — sigue por el flujo anónimo de siempre.
    it("si Supabase la rechaza, devuelve null sin lanzar", async () => {
      const m = setup({ isNative: false, sesion: null });
      m.signInAnonymously.mockResolvedValueOnce({
        data: null,
        error: { message: "Anonymous sign-ins are disabled" },
      });
      const { asegurarSesionAnonima } = await import("./auth");
      await expect(asegurarSesionAnonima()).resolves.toBeNull();
    });

    it("si getSession lanza, devuelve null sin propagar", async () => {
      const m = setup({ isNative: false, sesion: null });
      m.getSession.mockRejectedValueOnce(new Error("storage roto"));
      const { asegurarSesionAnonima } = await import("./auth");
      await expect(asegurarSesionAnonima()).resolves.toBeNull();
    });
  });

  describe("vincular identidad sobre una sesión anónima", () => {
    it("Google: con sesión anónima VINCULA en vez de entrar (conserva el progreso)", async () => {
      const m = setup({ isNative: false, sesion: "anon" });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(m.linkIdentity).toHaveBeenCalledWith({ provider: "google" });
      expect(m.signInWithOAuth).not.toHaveBeenCalled();
    });

    it("Google: sin sesión anónima entra normal", async () => {
      const m = setup({ isNative: false, sesion: null });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(m.linkIdentity).not.toHaveBeenCalled();
      expect(m.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
    });

    // Si «Manual linking» no está habilitado, entrar importa más que conservar:
    // el progreso anónimo se pierde, que es lo que pasaba ANTES de que las
    // sesiones anónimas existieran. Quedarse sin login sería peor.
    it("Google: si vincular falla, cae al login normal", async () => {
      const m = setup({ isNative: false, sesion: "anon", linkFalla: true });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(m.linkIdentity).toHaveBeenCalledTimes(1);
      expect(m.signInWithOAuth).toHaveBeenCalledWith({ provider: "google" });
    });

    it("Correo: con sesión anónima adjunta el email a esa cuenta", async () => {
      const m = setup({ isNative: false, emailLogin: "true", sesion: "anon" });
      const { signInWithEmail } = await import("./auth");
      await signInWithEmail("piloto@ejemplo.com");
      expect(m.updateUser).toHaveBeenCalledWith({ email: "piloto@ejemplo.com" });
      expect(m.signInWithOtp).not.toHaveBeenCalled();
    });

    it("Correo: si el email ya es de otra cuenta, cae al enlace normal", async () => {
      const m = setup({ isNative: false, emailLogin: "true", sesion: "anon", linkFalla: true });
      const { signInWithEmail } = await import("./auth");
      await signInWithEmail("piloto@ejemplo.com");
      expect(m.updateUser).toHaveBeenCalledTimes(1);
      expect(m.signInWithOtp).toHaveBeenCalledTimes(1);
    });

    // En nativo el login va por plugin y no pasa por la rama de vinculación.
    it("nativo: Google sigue yendo por el plugin aunque haya sesión anónima", async () => {
      const m = setup({ isNative: true, sesion: "anon" });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(m.nativeGoogleSignIn).toHaveBeenCalledTimes(1);
      expect(m.linkIdentity).not.toHaveBeenCalled();
    });
  });
});
