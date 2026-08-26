// @vitest-environment jsdom
//
// src/components/LoginModal.test.jsx
// LA PUERTA DE ENTRADA, MONTADA DE VERDAD.
//
// POR QUÉ EXISTE: el fallo caro de este componente es mudo. Si el `tipo` de
// token que devolvió el paso 1 no llega intacto al paso 2, Supabase rechaza un
// código perfectamente válido y el jugador ve «ese código no es correcto» sin
// haberse equivocado en nada — y como los dos caminos (alta y vinculación de
// anónimo) usan tokens distintos, el bug afectaría solo a una mitad de los
// usuarios. Eso no se ve en un Preview: se ve en los que no vuelven.

import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const pedirCodigo = vi.fn();
const verificarCodigo = vi.fn();
const signInWithGoogle = vi.fn().mockResolvedValue({ error: null });
const track = vi.fn();
const push = vi.fn();

async function montar(props = {}) {
  vi.resetModules();

  vi.doMock("../lib/auth", () => ({
    pedirCodigo,
    verificarCodigo,
    signInWithGoogle,
    emailLoginDisponible: () => true,
  }));
  vi.doMock("../lib/analytics", () => ({ track }));
  vi.doMock("../i18n", () => ({ useT: () => ({ t: (k) => k }) }));
  vi.doMock("./Toast", () => ({ useToast: () => ({ push }) }));
  // ModalShell arrastra framer-motion y el bloqueo de scroll; aquí solo estorba.
  // Su comportamiento (foco, role, backdrop) se prueba donde vive.
  vi.doMock("./ModalShell", () => ({
    default: ({ open, children }) => (open ? <div>{children}</div> : null),
  }));
  vi.doMock("./CloseButton", () => ({ default: () => <button type="button">cerrar</button> }));
  vi.doMock("./LanguageStrip", () => ({ default: () => null }));

  const { default: LoginModal } = await import("./LoginModal.jsx");
  return render(<LoginModal open onClose={() => {}} {...props} />);
}

/** Rellena el correo y envía el paso 1. */
async function enviarCorreo(valor = "piloto@ejemplo.com") {
  fireEvent.change(screen.getByPlaceholderText("app.emailPlaceholder"), {
    target: { value: valor },
  });
  fireEvent.click(screen.getByText("app.emailCta"));
  await screen.findByPlaceholderText("app.codePlaceholder");
}

describe("LoginModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email" });
    verificarCodigo.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("arranca pidiendo el correo, no el código", async () => {
    await montar();
    expect(screen.getByPlaceholderText("app.emailPlaceholder")).toBeTruthy();
    expect(screen.queryByPlaceholderText("app.codePlaceholder")).toBeNull();
  });

  it("un correo mal formado no llega a pedir nada", async () => {
    await montar();
    fireEvent.change(screen.getByPlaceholderText("app.emailPlaceholder"), {
      target: { value: "esto-no-es-un-correo" },
    });
    fireEvent.click(screen.getByText("app.emailCta"));
    expect(pedirCodigo).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalled();
  });

  it("tras enviar el correo, pasa al paso del código", async () => {
    await montar();
    await enviarCorreo();
    expect(pedirCodigo).toHaveBeenCalledWith("piloto@ejemplo.com");
    expect(screen.getByText("app.codeTitle")).toBeTruthy();
  });

  // EL TEST QUE JUSTIFICA EL FICHERO: el tipo del paso 1 llega intacto al 2.
  it("el tipo devuelto por pedirCodigo viaja hasta verificarCodigo", async () => {
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email_change" });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await waitFor(() =>
      expect(verificarCodigo).toHaveBeenCalledWith("piloto@ejemplo.com", "123456", "email_change")
    );
  });

  it("seis cifras verifican solas, sin pulsar el botón", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "999888" },
    });
    await waitFor(() => expect(verificarCodigo).toHaveBeenCalledTimes(1));
  });

  it("el campo del código descarta lo que no sean cifras y corta en seis", async () => {
    await montar();
    await enviarCorreo();
    const campo = screen.getByPlaceholderText("app.codePlaceholder");
    fireEvent.change(campo, { target: { value: "12a3-45 6789" } });
    expect(campo.value).toBe("123456");
  });

  it("un código caducado se distingue de uno incorrecto", async () => {
    verificarCodigo.mockResolvedValue({ data: null, error: { message: "Token has expired" } });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeExpired");
    expect(screen.queryByText("app.codeInvalid")).toBeNull();
  });

  it("un código incorrecto vacía el campo para volver a intentarlo", async () => {
    verificarCodigo.mockResolvedValue({ data: null, error: { message: "Token is invalid" } });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeInvalid");
    expect(screen.getByPlaceholderText("app.codePlaceholder").value).toBe("");
  });

  it("«usar otro correo» vuelve al paso 1 conservando lo tecleado", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.click(screen.getByText("app.codeChangeEmail"));
    const campo = await screen.findByPlaceholderText("app.emailPlaceholder");
    expect(campo.value).toBe("piloto@ejemplo.com");
  });

  // El reenvío nace bloqueado: sin cuenta atrás, «no me llega» se convierte en
  // pulsar el botón cinco veces y chocar con el rate limit del proveedor.
  it("el reenvío arranca en cuenta atrás, no disponible", async () => {
    await montar();
    await enviarCorreo();
    expect(screen.queryByText("app.codeResend")).toBeNull();
    expect(screen.getByText("app.codeResendWait")).toBeTruthy();
  });

  it("mide el embudo: método, código enviado y resultado", async () => {
    await montar();
    await enviarCorreo();
    expect(track).toHaveBeenCalledWith("login_method", { method: "email" });
    expect(track).toHaveBeenCalledWith("login_code_sent", { vinculando: false });

    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("login_verified", { result: "ok" })
    );
  });

  it("Google sigue siendo el primer camino y se mide", async () => {
    await montar();
    fireEvent.click(screen.getByText("common.continueWithGoogle"));
    expect(track).toHaveBeenCalledWith("login_method", { method: "google" });
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled());
  });
});
