import { describe, it, expect } from "vitest";
import { sinHistorialLocal } from "./primeraPartida";

// Storage mínimo en memoria: lo justo que usa el módulo.
function almacen(datos = {}) {
  const m = new Map(Object.entries(datos));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null) };
}

const HOY = "2026-09-26";

describe("sinHistorialLocal", () => {
  it("un dispositivo vacío es una primera partida", () => {
    expect(sinHistorialLocal(HOY, almacen())).toBe(true);
  });

  it("con días terminados en este dispositivo, no", () => {
    expect(sinHistorialLocal(HOY, almacen({ cd_dias_jugados: JSON.stringify({ n: 3, ultima: "2026-09-25" }) }))).toBe(false);
  });

  it("un estado de partida de OTRO día delata al veterano de antes del contador", () => {
    expect(sinHistorialLocal(HOY, almacen({ cocheDia_state: JSON.stringify({ date: "2026-07-02", guesses: [] }) }))).toBe(false);
  });

  it("un estado de HOY no cuenta: es esta misma partida recargada a medias", () => {
    expect(sinHistorialLocal(HOY, almacen({ cocheDia_state: JSON.stringify({ date: HOY, guesses: [{}] }) }))).toBe(true);
  });

  it("si el almacenamiento falla, se decide «no es nuevo» (la ayuda no molesta al veterano)", () => {
    const roto = { getItem: () => { throw new Error("SecurityError"); } };
    expect(sinHistorialLocal(HOY, roto)).toBe(false);
  });

  it("un JSON corrupto también cae del lado seguro", () => {
    expect(sinHistorialLocal(HOY, almacen({ cd_dias_jugados: "{roto" }))).toBe(false);
  });
});
