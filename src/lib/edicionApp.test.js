// @vitest-environment jsdom
// src/lib/edicionApp.test.js
// Necesita DOM (no para renderizar, sino por `navigator.userAgent` y
// `localStorage`, que son justo las dos cosas que decide este módulo). El
// entorno por defecto de la suite es `node` — ver vitest.config.js.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Igual que webpush.test.js: @capacitor/core no está instalado en el worktree,
// así que se mockea por test y el módulo se carga con import() dinámico.
function mockPlataforma(nativo) {
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => nativo },
  }));
}

// La UA es de solo lectura en jsdom; se redefine por test.
function setUA(ua) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/605.1";
const UA_ESCRITORIO = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36";

describe("edicionApp", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@capacitor/core");
  });

  it("urlPlay lleva el referrer de Play codificado dentro del parámetro", async () => {
    mockPlataforma(false);
    const { urlPlay } = await import("./edicionApp.js");
    const url = urlPlay("faldon_final");
    expect(url).toContain("id=com.cochedeldia");
    // Play espera el referrer como UNA cadena con sus propios pares, no como
    // parámetros sueltos: si esto se "arregla", Play Console deja de atribuir.
    expect(url).toContain("referrer=utm_source%3Dweb%26utm_medium%3Dfaldon_final");
  });

  it("esAndroidWeb: sí en Android navegador, no en iOS ni escritorio", async () => {
    mockPlataforma(false);
    const { esAndroidWeb } = await import("./edicionApp.js");

    setUA(UA_ANDROID);
    expect(esAndroidWeb()).toBe(true);

    setUA(UA_IPHONE);
    expect(esAndroidWeb()).toBe(false);

    setUA(UA_ESCRITORIO);
    expect(esAndroidWeb()).toBe(false);
  });

  it("esAndroidWeb es false DENTRO del APK (no se ofrece la app a quien ya la tiene)", async () => {
    mockPlataforma(true);
    const { esAndroidWeb } = await import("./edicionApp.js");
    setUA(UA_ANDROID);
    expect(esAndroidWeb()).toBe(false);
  });

  it("registrarDiaJugado cuenta días distintos, no partidas", async () => {
    mockPlataforma(false);
    const { registrarDiaJugado, diasJugados } = await import("./edicionApp.js");

    expect(diasJugados()).toBe(0);

    registrarDiaJugado("2026-08-09");
    registrarDiaJugado("2026-08-09"); // reabrir el resultado el mismo día
    expect(diasJugados()).toBe(1);

    registrarDiaJugado("2026-08-10");
    expect(diasJugados()).toBe(2);
  });

  it("el faldón necesita las tres condiciones a la vez", async () => {
    mockPlataforma(false);
    const {
      debeOfrecerFaldon,
      registrarDiaJugado,
      marcarFaldonDescartado,
      DIAS_MINIMOS,
    } = await import("./edicionApp.js");

    setUA(UA_ANDROID);
    expect(debeOfrecerFaldon()).toBe(false); // sin días jugados

    for (let i = 0; i < DIAS_MINIMOS - 1; i++) registrarDiaJugado(`2026-08-0${i + 1}`);
    expect(debeOfrecerFaldon()).toBe(false); // aún le falta uno

    registrarDiaJugado("2026-08-09");
    expect(debeOfrecerFaldon()).toBe(true);

    // En iOS/escritorio no se ofrece aunque el hábito esté demostrado.
    setUA(UA_IPHONE);
    expect(debeOfrecerFaldon()).toBe(false);

    // Y si lo rechaza, no vuelve nunca.
    setUA(UA_ANDROID);
    marcarFaldonDescartado();
    expect(debeOfrecerFaldon()).toBe(false);
  });

  it("sin localStorage no lanza y el fallo seguro es NO ofrecer", async () => {
    mockPlataforma(false);
    const { debeOfrecerFaldon, registrarDiaJugado } = await import("./edicionApp.js");
    setUA(UA_ANDROID);

    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage bloqueado");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage bloqueado");
    });

    expect(() => registrarDiaJugado("2026-08-09")).not.toThrow();
    expect(debeOfrecerFaldon()).toBe(false);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
