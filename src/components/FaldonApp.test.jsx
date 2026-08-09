// @vitest-environment jsdom
//
// src/components/FaldonApp.test.jsx
// EL FALDÓN DE LA EDICIÓN ANDROID, MONTADO DE VERDAD.
//
// POR QUÉ EXISTE: este componente es casi todo puerta de entrada, y una puerta
// mal puesta no se nota en el Preview de Vercel — allí se ve desde un
// escritorio, donde lo correcto es que NO salga nada. Los dos fallos que
// importan son invisibles a ojo: que se le enseñe a quien ya tiene la app
// (dentro del APK) o a quien no puede instalarla (iOS), y que reaparezca
// después de que alguien haya dicho que no. Aquí se ejecutan esos casos.
//
// El gate en sí (las tres condiciones) se prueba a nivel de lógica en
// lib/edicionApp.test.js; esto comprueba que el componente lo OBEDECE y que el
// "ahora no" persiste.

// React explícito: en este fichero el transform de vitest usa el runtime
// clásico de JSX (mismo motivo que en GuessForm.app.test.jsx).
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/605.1";

function setUA(ua) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

// Tres días jugados: el mínimo que abre la puerta. Se escribe directamente en
// la clave real en vez de llamar a registrarDiaJugado() para que el test falle
// si alguien cambia el formato guardado sin darse cuenta.
function sembrarDias(n) {
  localStorage.setItem("cd_dias_jugados", JSON.stringify({ n, ultima: "2026-08-01" }));
}

async function montar({ nativo = false, ua = UA_ANDROID } = {}) {
  vi.resetModules();
  setUA(ua);
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => nativo },
  }));
  // i18n real no: el faldón solo necesita que las claves se resuelvan a algo
  // estable con lo que buscar en pantalla.
  vi.doMock("../i18n", () => ({ useT: () => ({ t: (k) => k }) }));

  const { default: FaldonApp } = await import("./FaldonApp.jsx");
  return render(<FaldonApp />);
}

describe("FaldonApp", () => {
  beforeEach(() => {
    localStorage.clear();
    // window.open no existe en jsdom como función espiable por defecto.
    window.open = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("@capacitor/core");
    vi.doUnmock("../i18n");
  });

  it("aparece en Android web con tres días jugados", async () => {
    sembrarDias(3);
    await montar();
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  it("no aparece con menos de tres días (aún no hay hábito que trasladar)", async () => {
    sembrarDias(2);
    await montar();
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });

  it("no aparece DENTRO de la app (ofrecerle el APK a quien ya lo tiene)", async () => {
    sembrarDias(10);
    await montar({ nativo: true });
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });

  it("no aparece en iOS, donde el enlace no instalaría nada", async () => {
    sembrarDias(10);
    await montar({ ua: UA_IPHONE });
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });

  it("el CTA abre Play con el referrer y NO cierra el faldón", async () => {
    sembrarDias(3);
    await montar();
    fireEvent.click(screen.getByText("app.promoCta"));

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, target] = window.open.mock.calls[0];
    expect(url).toContain("id=com.cochedeldia");
    expect(url).toContain("utm_medium%3Dfaldon_final");
    expect(target).toBe("_blank");
    // Sigue en pantalla: ir a Play no es haber instalado.
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  it("«ahora no» lo cierra y NO vuelve en el siguiente montaje", async () => {
    sembrarDias(3);
    await montar();
    fireEvent.click(screen.getByText("app.promoDecline"));
    expect(screen.queryByText("app.promoTitle")).toBeNull();

    cleanup();
    await montar();
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });
});
