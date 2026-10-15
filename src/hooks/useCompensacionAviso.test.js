// @vitest-environment jsdom
// Las garantías del aviso de compensación que dependen del CLIENTE: no
// preguntar sin sesión, no enseñar nada a quien el servidor contesta null,
// preguntar una sola vez por cuenta y fallar en silencio. La de «una vez por
// cuenta entre dispositivos» es del servidor (UPDATE … RETURNING en la RPC).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../supabaseClient", () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const { useCompensacionAviso } = await import("./useCompensacionAviso");

const AVISO = { intento: 3, puntos: 7, racha: 15 };

beforeEach(() => {
  rpc.mockReset();
});

describe("useCompensacionAviso", () => {
  it("sin sesión no pregunta ni enseña nada", () => {
    const { result } = renderHook(() => useCompensacionAviso(null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.datos).toBeNull();
  });

  it("a quien no está en la lista (null) no le enseña nada", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useCompensacionAviso("u1"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mi_compensacion_tvr"));
    expect(result.current.datos).toBeNull();
  });

  it("al afectado se lo enseña, y cerrar lo retira", async () => {
    rpc.mockResolvedValue({ data: AVISO, error: null });
    const { result } = renderHook(() => useCompensacionAviso("u1"));
    await waitFor(() => expect(result.current.datos).toEqual(AVISO));
    act(() => result.current.cerrar());
    expect(result.current.datos).toBeNull();
  });

  it("pregunta una sola vez por cuenta aunque se re-renderice", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { rerender } = renderHook(({ id }) => useCompensacionAviso(id), {
      initialProps: { id: "u1" },
    });
    rerender({ id: "u1" });
    rerender({ id: "u1" });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  });

  it("un error del servidor o de la red no enseña nada ni rompe", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const a = renderHook(() => useCompensacionAviso("u1"));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(a.result.current.datos).toBeNull();

    rpc.mockRejectedValueOnce(new Error("red"));
    const b = renderHook(() => useCompensacionAviso("u2"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(b.result.current.datos).toBeNull();
  });

  it("al cerrar sesión con el aviso delante, se retira", async () => {
    rpc.mockResolvedValue({ data: AVISO, error: null });
    const { result, rerender } = renderHook(({ id }) => useCompensacionAviso(id), {
      initialProps: { id: "u1" },
    });
    await waitFor(() => expect(result.current.datos).toEqual(AVISO));
    rerender({ id: null });
    expect(result.current.datos).toBeNull();
  });
});
