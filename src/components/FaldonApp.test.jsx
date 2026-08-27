// @vitest-environment jsdom
//
// src/components/FaldonApp.test.jsx
// EL FALDÓN DE LA EDICIÓN ANDROID, MONTADO DE VERDAD.
//
// POR QUÉ EXISTE: este componente es casi todo puerta de entrada, y una puerta
// mal puesta no se nota en el Preview de Vercel — allí se ve desde un
// escritorio, donde lo correcto es que NO salga nada. Los fallos que importan
// son invisibles a ojo: que se le enseñe a quien ya tiene la app (jugando
// dentro del APK, o instalada pero entrando por el navegador) o a quien no
// puede instalarla (iOS), y que reaparezca después de que alguien haya dicho
// que no. Aquí se ejecutan esos casos.
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

async function montar({ nativo = false, ua = UA_ANDROID, props = {} } = {}) {
  vi.resetModules();
  setUA(ua);
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => nativo },
  }));
  // i18n real no: el faldón solo necesita que las claves se resuelvan a algo
  // estable con lo que buscar en pantalla. `tn` devuelve la clave base igual
  // que `t`, que es todo lo que hace falta para localizar el bloque.
  vi.doMock("../i18n", () => ({
    useT: () => ({ t: (k) => k, tn: (k) => k }),
  }));

  const { default: FaldonApp } = await import("./FaldonApp.jsx");
  // CON CUENTA por defecto: los tests de la puerta (plataforma, días,
  // instalada) se escribieron para la cara de Play y siguen midiendo eso.
  return render(<FaldonApp user={{ id: "u1" }} streak={0} onOpenLogin={() => {}} {...props} />);
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

  it("no aparece si ya la tiene instalada, aunque hoy juegue en el navegador", async () => {
    sembrarDias(10);
    // La marca que deja comprobarAppInstalada() en el arranque; la detección en
    // sí se prueba en lib/edicionApp.test.js.
    localStorage.setItem("cd_app_instalada", "1");
    await montar();
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

  // ── Las dos caras ────────────────────────────────────────────────────────
  // Un anónimo que instala la app aparece en el día 0: su racha vive en el
  // localStorage del navegador y el WebView tiene su propio almacenamiento.
  // Ofrecerle Play sin avisar es mandarle a perder lo que lleva.
  it("sin cuenta pide cuenta, no Play", async () => {
    sembrarDias(3);
    await montar({ props: { user: null, streak: 9 } });
    expect(screen.getByText("app.promoAccountTitle")).toBeTruthy();
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });

  it("con cuenta ofrece Play, no la cuenta", async () => {
    sembrarDias(3);
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
    expect(screen.queryByText("app.promoAccountTitle")).toBeNull();
  });

  it("el CTA de registro abre la puerta de entrada y NO va a Play", async () => {
    sembrarDias(3);
    const onOpenLogin = vi.fn();
    await montar({ props: { user: null, streak: 4, onOpenLogin } });
    fireEvent.click(screen.getByText("app.promoAccountCta"));
    expect(onOpenLogin).toHaveBeenCalledWith("faldon");
    expect(window.open).not.toHaveBeenCalled();
  });

  // La cadena: al registrarse desde el faldón, el mismo bloque pasa a ofrecer
  // Play sin que haya que navegar a ningún sitio.
  it("al aparecer la cuenta, el mismo faldón pasa a ofrecer Play", async () => {
    sembrarDias(3);
    const { rerender } = await montar({ props: { user: null, streak: 4 } });
    expect(screen.getByText("app.promoAccountTitle")).toBeTruthy();

    const { default: FaldonApp } = await import("./FaldonApp.jsx");
    rerender(<FaldonApp user={{ id: "u1" }} streak={4} onOpenLogin={() => {}} />);
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  // Rechazar «regístrate» no puede enterrar una oferta que aún no se ha hecho.
  it("rechazar el registro NO apaga la oferta de Play de después", async () => {
    sembrarDias(3);
    await montar({ props: { user: null, streak: 4 } });
    fireEvent.click(screen.getByText("app.promoAccountDecline"));
    expect(screen.queryByText("app.promoAccountTitle")).toBeNull();

    cleanup();
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  it("y al revés: rechazar Play no vuelve a pedirle cuenta a quien ya la tiene", async () => {
    sembrarDias(3);
    await montar({ props: { user: { id: "u1" } } });
    fireEvent.click(screen.getByText("app.promoDecline"));

    cleanup();
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });
});
