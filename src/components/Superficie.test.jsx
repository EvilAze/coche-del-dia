// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ esApp: false }));
vi.mock("../lib/plataforma", () => ({
  esApp: () => mocks.esApp,
}));

import Superficie from "./Superficie";

afterEach(() => {
  cleanup();
  mocks.esApp = false;
});

describe("Superficie (Vaul en app/móvil, ModalShell en escritorio)", () => {
  it("monta hoja Vaul con título accesible y cuerpo scrollable en app", () => {
    mocks.esApp = true;
    render(
      <Superficie
        open={true}
        onClose={vi.fn()}
        label="Clasificación"
        veloWeb="modal-scrim fixed inset-0 z-hoja"
        veloApp="pm-velo-hoja fixed inset-0 z-hoja-sobre"
        panelWeb="modal-panel-flat"
      >
        <p>Contenido de ranking</p>
      </Superficie>
    );

    const dialog = screen.getByRole("dialog", { name: "Clasificación" });
    expect(dialog.className).toContain("pm-hoja-nav");
    expect(dialog.className).toContain("cdd-vaul-hoja");
    expect(dialog.className).toContain("z-hoja-sobre");
    expect(dialog.querySelector(".pm-hoja-tirador")).not.toBeNull();
    expect(dialog.querySelector(".pm-hoja-cuerpo--nav")).not.toBeNull();
    expect(screen.getByText("Contenido de ranking")).toBeTruthy();
  });

  it("conserva la tarjeta ModalShell en escritorio web", () => {
    mocks.esApp = false;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(
      <Superficie
        open={true}
        onClose={vi.fn()}
        label="Perfil"
        veloWeb="modal-scrim fixed inset-0 z-hoja"
        veloApp="pm-velo-hoja fixed inset-0 z-hoja"
        panelWeb="modal-panel-flat panel-seccion"
      >
        <p>Contenido de perfil</p>
      </Superficie>
    );

    const dialog = screen.getByRole("dialog", { name: "Perfil" });
    expect(dialog.className).toContain("modal-panel-flat");
    expect(dialog.className).not.toContain("cdd-vaul-hoja");
    expect(screen.getByText("Contenido de perfil")).toBeTruthy();
  });
});
