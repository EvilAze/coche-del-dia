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
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const pedirCodigo = vi.fn();
const verificarCodigo = vi.fn();
const signInWithGoogle = vi.fn().mockResolvedValue({ error: null });
const track = vi.fn();
const push = vi.fn();

async function montar({ conEmail = true, ...props } = {}) {
  vi.resetModules();

  vi.doMock("../lib/auth", () => ({
    pedirCodigo,
    verificarCodigo,
    signInWithGoogle,
    emailLoginDisponible: () => conEmail,
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

  it("verifica sola al dejar de teclear, sin pulsar el botón", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "999888" },
    });
    await waitFor(() => expect(verificarCodigo).toHaveBeenCalledTimes(1));
  });

  it("el campo del código descarta lo que no sean cifras", async () => {
    await montar();
    await enviarCorreo();
    const campo = screen.getByPlaceholderText("app.codePlaceholder");
    fireEvent.change(campo, { target: { value: "12a3-45 67" } });
    expect(campo.value).toBe("1234567");
  });

  // Supabase responde a «mal escrito» y a «caducado» con la MISMA frase, a
  // propósito, para no chivar cuál es. Antes se buscaba /expired/ dentro y se
  // encontraba siempre, así que a quien se equivocaba de cifra se le decía que
  // su código había caducado. Un solo mensaje, que cubre los dos y dice qué
  // hacer.
  it("un código rechazado da UN mensaje, sin adivinar por qué", async () => {
    verificarCodigo.mockResolvedValue({
      data: null,
      error: { message: "Token has expired or is invalid" },
    });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeRejected");
  });

  // Y NO se vacía: si fue un dedazo, lo escrito es casi todo bueno y borrarlo
  // obliga a reteclearlo entero por una cifra.
  it("un código rechazado conserva lo tecleado", async () => {
    verificarCodigo.mockResolvedValue({
      data: null,
      error: { message: "Token has expired or is invalid" },
    });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeRejected");
    expect(screen.getByPlaceholderText("app.codePlaceholder").value).toBe("123456");
  });

  // EL FALLO QUE COSTÓ EL PRIMER INTENTO REAL: el proyecto tenía la longitud
  // del OTP en 8 y el campo truncaba a 6, así que se mandaban las seis
  // primeras de ocho y no validaba nunca. Ahora el campo no trunca al mínimo
  // y la verificación no exige una longitud exacta.
  it("acepta códigos más largos que el mínimo, sin truncarlos", async () => {
    await montar();
    await enviarCorreo();
    const campo = screen.getByPlaceholderText("app.codePlaceholder");
    fireEvent.change(campo, { target: { value: "47385777" } });
    expect(campo.value).toBe("47385777");
    await waitFor(() =>
      expect(verificarCodigo).toHaveBeenCalledWith("piloto@ejemplo.com", "47385777", "email")
    );
  });

  it("no intenta verificar por debajo del mínimo", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "12345" },
    });
    await new Promise((r) => setTimeout(r, 900));
    expect(verificarCodigo).not.toHaveBeenCalled();
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

  // El agujero que esto tapa: un anónimo con racha tecleaba un correo que ya
  // tenía cuenta, entraba, y su racha desaparecía SIN QUE NADIE SE LO DIJERA.
  // Con Google ese mismo caso lleva aviso desde siempre (loginLinkTakenBody).
  it("avisa cuando el correo ya tiene cuenta y el progreso se va a quedar aquí", async () => {
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email", correoOcupado: true });
    await montar();
    await enviarCorreo();
    expect(screen.getByText("app.codeEmailTakenBody")).toBeTruthy();
  });

  it("y no lo enseña cuando no hay nada que perder", async () => {
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email", correoOcupado: false });
    await montar();
    await enviarCorreo();
    expect(screen.queryByText("app.codeEmailTakenBody")).toBeNull();
  });

  // El aviso describe un correo CONCRETO: al cambiarlo, el diagnóstico caduca.
  it("cambiar de correo retira el aviso", async () => {
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email", correoOcupado: true });
    await montar();
    await enviarCorreo();
    fireEvent.click(screen.getByText("app.codeChangeEmail"));
    expect(screen.queryByText("app.codeEmailTakenBody")).toBeNull();
  });

  // ── La puerta de un solo toque ───────────────────────────────────────────
  // Esta es LA configuración de producción (`VITE_EMAIL_LOGIN=false`), así que
  // es la que más falta hace probar: sin este bloque, lo único cubierto sería
  // el camino apagado. Y lo que hay que vigilar no es que el formulario
  // desaparezca —eso es un `&&`— sino que no deje muñones: el filete con la
  // «o» en medio separa dos cosas, y con una sola cuelga de la nada.
  describe("con la entrada por correo apagada", () => {
    it("solo ofrece Google: ni campo, ni CTA, ni separador huérfano", async () => {
      await montar({ conEmail: false });
      expect(screen.getByText("common.continueWithGoogle")).toBeTruthy();
      expect(screen.queryByPlaceholderText("app.emailPlaceholder")).toBeNull();
      expect(screen.queryByText("app.emailCta")).toBeNull();
      expect(screen.queryByText("app.orSeparator")).toBeNull();
      expect(screen.queryByText("app.emailNoPassword")).toBeNull();
    });

    it("Google sigue entrando y midiéndose igual", async () => {
      await montar({ conEmail: false });
      fireEvent.click(screen.getByText("common.continueWithGoogle"));
      expect(track).toHaveBeenCalledWith("login_method", { method: "google" });
      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled());
    });
  });

  // Reenviar NO es volver a elegir método. Si se contara, habría más «métodos»
  // que aperturas de la puerta y el embudo dejaría de cuadrar solo.
  //
  // Relojes falsos porque el reenvío nace bloqueado 60 s: sin adelantarlos, el
  // botón no existe y el test no probaría nada. `shouldAdvanceTime` deja correr
  // además el tiempo real, que es lo que necesitan los `findBy*` de
  // testing-library para no colgarse esperando su propio temporizador.
  it("el reenvío cuenta como envío, no como elegir método otra vez", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await montar();
      await enviarCorreo();
      expect(track.mock.calls.filter((c) => c[0] === "login_method")).toHaveLength(1);

      // Segundo a segundo, y no un salto de 60 s: la cuenta atrás es una CADENA
      // de setTimeout de 1 s —cada uno se programa en el efecto que dispara el
      // anterior— así que un salto grande solo dispararía el primero, porque
      // los demás aún no existen cuando el reloj los pasa por encima.
      for (let i = 0; i < 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      fireEvent.click(await screen.findByText("app.codeResend"));

      await waitFor(() =>
        expect(track.mock.calls.filter((c) => c[0] === "login_code_sent")).toHaveLength(2)
      );
      // El envío se cuenta dos veces; la elección de método, una sola.
      expect(track.mock.calls.filter((c) => c[0] === "login_method")).toHaveLength(1);
      expect(pedirCodigo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
