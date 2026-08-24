// api/_lib/coche-de-hoy.test.js
// El caso que motivó este módulo no es el camino feliz, son dos trampas:
//
//   1. Las partidas de REPESCA viven en la misma tabla que las diarias, con la
//      misma fecha y otro car_id. Anclar al usuario a «su fila de hoy» a secas
//      lo clavaría al coche de su repesca. Por eso el ancla se acota a
//      {vigente} ∪ prev.
//   2. Quien tiene la pestaña abierta desde antes del cambio ve la foto vieja.
//      Si responde, se le puntuaría contra el coche nuevo. Por eso existe
//      cocheCambiado.

import { describe, it, expect } from "vitest";
import { resolverCocheDelUsuario } from "./coche-de-hoy.js";

const VIGENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const VIEJO   = "bbbbbbbb-0000-0000-0000-000000000002";
const REPESCA = "cccccccc-0000-0000-0000-000000000003";

const SELLOS = {
  [VIGENTE]: "selloVigente0001",
  [VIEJO]: "selloViejo000002",
};

// Día normal: nunca ha habido cambio de emergencia.
const normal = (extra = {}) =>
  resolverCocheDelUsuario({
    carIdVigente: VIGENTE,
    prevCarIds: [],
    sellosPorCarId: { [VIGENTE]: SELLOS[VIGENTE] },
    ...extra,
  });

// Día con un cambio de emergencia hecho.
const cambiado = (extra = {}) =>
  resolverCocheDelUsuario({
    carIdVigente: VIGENTE,
    prevCarIds: [VIEJO],
    sellosPorCarId: SELLOS,
    ...extra,
  });

describe("día normal — se comporta exactamente como antes", () => {
  it("sin nada, el coche vigente", () => {
    expect(normal()).toEqual({ carId: VIGENTE, congelado: false, cocheCambiado: false });
  });

  it("con fila del usuario, el coche vigente", () => {
    const r = normal({ filaUsuario: { car_id: VIGENTE, status: "playing" } });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("con el sello al día, el coche vigente y sin aviso", () => {
    const r = normal({ selloCliente: SELLOS[VIGENTE] });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(false);
  });
});

describe("logueado", () => {
  it("con fila en la revisión anterior, se queda congelado en su coche", () => {
    const r = cambiado({ filaUsuario: { car_id: VIEJO, status: "playing" } });
    expect(r).toEqual({ carId: VIEJO, congelado: true, cocheCambiado: false });
  });

  it("con fila terminada en la revisión anterior, sigue congelado", () => {
    const r = cambiado({ filaUsuario: { car_id: VIEJO, status: "won" } });
    expect(r.carId).toBe(VIEJO);
    expect(r.congelado).toBe(true);
  });

  it("sin fila, juega el coche nuevo", () => {
    expect(cambiado({ filaUsuario: null }).carId).toBe(VIGENTE);
  });

  it("una fila de REPESCA no lo ancla: no es ni el vigente ni un saliente", () => {
    const r = cambiado({ filaUsuario: { car_id: REPESCA, status: "playing" } });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("la fila manda sobre el sello: fila vieja + sello nuevo → congelado", () => {
    const r = cambiado({
      filaUsuario: { car_id: VIEJO, status: "playing" },
      selloCliente: SELLOS[VIGENTE],
    });
    expect(r.carId).toBe(VIEJO);
  });
});

describe("anónimo", () => {
  it("con partida empezada y sello viejo, se queda congelado", () => {
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 2 });
    expect(r).toEqual({ carId: VIEJO, congelado: true, cocheCambiado: false });
  });

  it("con CERO intentos y sello viejo, juega el coche nuevo", () => {
    // Tenía la web abierta desde antes del cambio pero no había jugado nada:
    // no hay partida que congelar.
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 0 });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
    expect(r.cocheCambiado).toBe(true);
  });

  it("sin sello (token viejo sin el campo), juega el coche vigente", () => {
    const r = cambiado({ selloCliente: null, intentosAnon: 3 });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });
});

describe("cocheCambiado — el aviso de «recarga, estás viendo otra foto»", () => {
  it("sello desconocido y sin ancla → avisa", () => {
    const r = cambiado({ selloCliente: "selloDeOtraCosa1" });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(true);
  });

  it("un congelado NO recibe el aviso: su partida es válida", () => {
    const r = cambiado({ selloCliente: SELLOS[VIEJO], intentosAnon: 1 });
    expect(r.cocheCambiado).toBe(false);
  });

  it("sin sello no se avisa de nada (cliente viejo, no sabemos)", () => {
    expect(cambiado({ selloCliente: null }).cocheCambiado).toBe(false);
  });
});
