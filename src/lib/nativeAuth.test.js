// src/lib/nativeAuth.test.js
// Cubre la heurística de "fallo silencioso": el plugin de Google reporta
// USER_CANCELLED tanto cuando el usuario cierra el selector como cuando Google
// falla de verdad (p.ej. "[16] Account reauth failed" por una SHA-1 sin
// registrar). Como no se puede distinguir, la app calla la primera vez y avisa
// a partir de la segunda seguida.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Patrón del repo: vi.doMock + vi.resetModules + await import (entorno node).
function setup({ loginImpl } = {}) {
  const signInWithIdToken = vi.fn().mockResolvedValue({ data: { session: {} }, error: null });
  const captureClientError = vi.fn();
  const login = vi.fn(loginImpl);
  const initialize = vi.fn().mockResolvedValue();

  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => true },
  }));
  vi.doMock("../supabaseClient", () => ({ supabase: { auth: { signInWithIdToken } } }));
  vi.doMock("./sentry", () => ({ captureClientError }));
  vi.doMock("@capgo/capacitor-social-login", () => ({
    SocialLogin: { initialize, login, logout: vi.fn().mockResolvedValue() },
  }));
  return { signInWithIdToken, captureClientError, login };
}

// El plugin traduce CUALQUIER GetCredentialCancellationException a esto, venga
// de una cancelación real o de un fallo de Google.
const cancelacion = () => {
  const e = new Error("Google Sign-In cancelled by user");
  e.code = "USER_CANCELLED";
  return e;
};

describe("nativeGoogleSignIn: fallos que el plugin disfraza de cancelación", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_GOOGLE_WEB_CLIENT_ID", "id-de-prueba.apps.googleusercontent.com");
  });

  it("el primer intento sin sesión no molesta al usuario ni gasta cuota de Sentry", async () => {
    const m = setup({ loginImpl: () => Promise.reject(cancelacion()) });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    const res = await nativeGoogleSignIn();

    expect(res.error).toBeNull();
    expect(m.captureClientError).not.toHaveBeenCalled();
  });

  it("el segundo intento seguido sí devuelve error, para que la UI avise", async () => {
    const m = setup({ loginImpl: () => Promise.reject(cancelacion()) });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    await nativeGoogleSignIn();
    const res = await nativeGoogleSignIn();

    expect(res.error).toBeInstanceOf(Error);
    expect(m.captureClientError).toHaveBeenCalledTimes(1);
  });

  it("insistir más no multiplica los eventos de Sentry", async () => {
    const m = setup({ loginImpl: () => Promise.reject(cancelacion()) });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    await nativeGoogleSignIn();
    await nativeGoogleSignIn();
    await nativeGoogleSignIn();
    await nativeGoogleSignIn();

    expect(m.captureClientError).toHaveBeenCalledTimes(1);
  });

  it("un login correcto corta la racha: el siguiente cancelado vuelve a ser silencioso", async () => {
    let fallar = true;
    const m = setup({
      loginImpl: () =>
        fallar
          ? Promise.reject(cancelacion())
          : Promise.resolve({ provider: "google", result: { idToken: "tok" } }),
    });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    await nativeGoogleSignIn(); // 1º sin sesión
    fallar = false;
    const ok = await nativeGoogleSignIn(); // login bueno → resetea
    expect(ok.error).toBeNull();
    expect(m.signInWithIdToken).toHaveBeenCalledWith({ provider: "google", token: "tok" });

    fallar = true;
    const res = await nativeGoogleSignIn(); // vuelve a ser el "primero"
    expect(res.error).toBeNull();
    expect(m.captureClientError).not.toHaveBeenCalled();
  });

  it("si el plugin devuelve sin idToken cuenta igual como intento sin sesión", async () => {
    const m = setup({ loginImpl: () => Promise.resolve({ provider: "google", result: {} }) });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    expect((await nativeGoogleSignIn()).error).toBeNull();
    expect((await nativeGoogleSignIn()).error).toBeInstanceOf(Error);
    expect(m.signInWithIdToken).not.toHaveBeenCalled();
  });

  it("un error de Supabase se reporta y NO se cuenta como intento mudo", async () => {
    const m = setup({
      loginImpl: () => Promise.resolve({ provider: "google", result: { idToken: "tok" } }),
    });
    m.signInWithIdToken.mockResolvedValue({ data: null, error: new Error("aud no autorizado") });
    const { nativeGoogleSignIn } = await import("./nativeAuth");

    const res = await nativeGoogleSignIn();

    expect(res.error).toBeInstanceOf(Error);
    expect(m.captureClientError).toHaveBeenCalledTimes(1);
  });
});
