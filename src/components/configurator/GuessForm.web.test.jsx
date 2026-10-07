// @vitest-environment jsdom
//
// src/components/configurator/GuessForm.web.test.jsx
// EL CUPÓN DE LA WEB: el aviso va donde está el problema y las sugerencias
// existen para un lector de pantalla.
//
// Gemelo de GuessForm.app.test.jsx para la otra rama. Cubre dos hallazgos de la
// auditoría del 7-oct-2026, jugando en producción:
//   · ADIVINAR con el cupón vacío avisaba con un toast al pie de la pantalla,
//     casi un segundo tarde y lejos del campo, que ni se marcaba ni recibía el
//     foco. Ahora el aviso va bajo las casillas (role="alert"), el campo lleva
//     aria-invalid y el foco va a él.
//   · El combo no era un combobox: sin aria-expanded, aria-controls ni
//     aria-activedescendant, y la opción resaltada seguía aria-selected=false.

// React explícito: mismo motivo que en GuessForm.app.test.jsx.
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const CATALOGO = {
  cars: [
    { id: 1, marca: "Seat", modelo: "Ibiza", pais: "es" },
    { id: 2, marca: "Seat", modelo: "León", pais: "es" },
    { id: 3, marca: "Citroën", modelo: "2CV", pais: "fr" },
  ],
  marcas: ["Citroën", "Seat"],
};

const push = vi.fn();

async function montar() {
  vi.resetModules();
  vi.doMock("../../lib/plataforma", () => ({ esApp: () => false }));
  vi.doMock("../../data/catalog", () => ({
    useCatalog: () => ({ data: CATALOGO, error: null, loading: false, reload: vi.fn() }),
  }));
  vi.doMock("../Toast", () => ({ useToast: () => ({ push }) }));
  vi.doMock("../../lib/haptics", () => ({
    haptic: { selection: vi.fn(), impactLight: vi.fn(), impactMedium: vi.fn(), warning: vi.fn() },
  }));
  vi.doMock("../../i18n", () => ({
    useT: () => ({
      t: (clave, vars) => (vars ? `${clave}:${Object.values(vars).join(",")}` : clave),
      locale: "es",
    }),
    getLocalizedCountry: (pais) => pais,
  }));

  const { default: GuessForm } = await import("./GuessForm");
  render(<GuessForm onSubmit={vi.fn()} guesses={[]} attempts={0} maxAttempts={5} />);
}

const campoMarca = () => screen.getAllByRole("combobox")[0];
const adivinar = () => screen.getByRole("button", { name: "cdd.submit" });

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom no implementa scrollIntoView (el combo lo usa para seguir la opción
  // resaltada) ni matchMedia (teclado y foco post-envío lo consultan).
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
});

describe("El aviso del cupón web va junto al campo", () => {
  it("con el cupón vacío: aviso bajo las casillas, marca inválida y sin toast", async () => {
    await montar();
    fireEvent.click(adivinar());

    const aviso = screen.getByRole("alert");
    expect(aviso.textContent).toBe("guess.missingMarca");
    expect(campoMarca().getAttribute("aria-invalid")).toBe("true");
    expect(campoMarca().getAttribute("aria-describedby")).toBe(aviso.id);
    expect(push).not.toHaveBeenCalled();
  });

  it("el foco va al campo que falta", async () => {
    await montar();
    fireEvent.click(adivinar());
    await waitFor(() => expect(document.activeElement).toBe(campoMarca()));
  });

  it("escribir en el campo retira el aviso", async () => {
    await montar();
    fireEvent.click(adivinar());
    expect(screen.queryByRole("alert")).toBeTruthy();
    fireEvent.change(campoMarca(), { target: { value: "Se" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(campoMarca().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Las sugerencias son un combobox de verdad", () => {
  it("anuncia la lista abierta y la opción resaltada", async () => {
    await montar();
    const campo = campoMarca();
    expect(campo.getAttribute("aria-expanded")).toBe("false");

    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "Se" } });
    expect(campo.getAttribute("aria-expanded")).toBe("true");

    const lista = screen.getByRole("listbox");
    expect(campo.getAttribute("aria-controls")).toBe(lista.id);
    expect(lista.getAttribute("aria-label")).toBe("cdd.labelMarca");

    const activa = document.getElementById(campo.getAttribute("aria-activedescendant"));
    expect(activa).toBeTruthy();
    expect(activa.getAttribute("role")).toBe("option");
    expect(activa.getAttribute("aria-selected")).toBe("true");
    expect(activa.textContent).toContain("Seat");
  });
});
