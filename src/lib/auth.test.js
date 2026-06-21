// src/lib/auth.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// Patrón del repo: vi.doMock + vi.resetModules + await import (entorno node).
function setup({ isNative }) {
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
  const signOutSb = vi.fn().mockResolvedValue({ error: null });
  const nativeGoogleSignIn = vi.fn().mockResolvedValue({ data: {}, error: null });
  const nativeSignOut = vi.fn().mockResolvedValue();
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => isNative },
  }));
  vi.doMock("../supabaseClient", () => ({
    supabase: { auth: { signInWithOAuth, signOut: signOutSb } },
  }));
  vi.doMock("./nativeAuth", () => ({ nativeGoogleSignIn, nativeSignOut }));
  return { signInWithOAuth, signOutSb, nativeGoogleSignIn, nativeSignOut };
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
});
