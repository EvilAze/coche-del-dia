// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

afterEach(cleanup);

function Disparo({ onReady }) {
  const toast = useToast();
  onReady(toast);
  return null;
}

describe("ToastProvider (Sonner)", () => {
  it("muestra avisos con rol alert para error y status para info/success/logro", async () => {
    let api;
    render(
      <ToastProvider>
        <Disparo onReady={(t) => (api = t)} />
      </ToastProvider>
    );

    const onAction = vi.fn();
    api.push("Ese año ya lo has probado", { type: "error" });
    api.push("Resultado copiado", {
      type: "success",
      action: { label: "Deshacer", onClick: onAction },
    });

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Ese año ya lo has probado");

    const estado = await screen.findByRole("status");
    expect(estado.textContent).toContain("Resultado copiado");

    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
