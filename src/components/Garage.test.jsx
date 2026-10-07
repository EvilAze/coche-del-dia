// @vitest-environment jsdom
//
// src/components/Garage.test.jsx
// EL ARCHIVO ES UN DIÁLOGO Y SU VELO NO SE COME EL SIGUIENTE TOQUE.
//
// El Archivo es la única sección que no monta ModalShell, y la auditoría del
// 7-oct-2026 midió en producción las dos consecuencias: (1) sin role=dialog ni
// nombre, el foco se quedaba en <body> y Tab salía a la página de detrás; (2)
// tras cerrar, el velo a pantalla completa seguía con pointer-events vivos unos
// 2,2 s, y el primer toque en otra pestaña caía en él (3 de 3 veces).

// React explícito: mismo motivo que en GuessForm.app.test.jsx.
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

async function montar() {
  vi.resetModules();
  vi.doMock("../supabaseClient", () => ({
    supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  }));
  vi.doMock("../lib/analytics", () => ({ track: vi.fn(), plataforma: () => "web" }));
  vi.doMock("../lib/sentry", () => ({ captureClientError: vi.fn() }));
  vi.doMock("./Toast", () => ({ useToast: () => ({ push: vi.fn() }) }));
  vi.doMock("../i18n", () => ({
    useT: () => ({ t: (clave) => clave, locale: "es" }),
    getCarDescription: () => "",
    getLocalizedCountry: (p) => p,
  }));
  const { default: Garage } = await import("./Garage");
  return Garage;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("El Archivo sin cuenta", () => {
  it("es un diálogo modal con el nombre de la sección", async () => {
    const Garage = await montar();
    render(<Garage open onClose={vi.fn()} user={null} onOpenLogin={vi.fn()} />);
    const dialogo = screen.getByRole("dialog");
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    const titulo = document.getElementById(dialogo.getAttribute("aria-labelledby"));
    expect(titulo?.textContent).toBe("prensa.garaje");
  });

  it("al cerrarse, el velo deja de recibir toques aunque siga animando la salida", async () => {
    const Garage = await montar();
    const { rerender } = render(<Garage open onClose={vi.fn()} user={null} onOpenLogin={vi.fn()} />);
    const velo = document.querySelector(".scrim-flat");
    expect(velo.style.pointerEvents).toBe("");
    rerender(<Garage open={false} onClose={vi.fn()} user={null} onOpenLogin={vi.fn()} />);
    // AnimatePresence lo mantiene montado mientras dura la salida: justo el
    // intervalo en que antes se comía el primer toque.
    const sigue = document.querySelector(".scrim-flat");
    expect(sigue).toBeTruthy();
    expect(sigue.style.pointerEvents).toBe("none");
  });
});
