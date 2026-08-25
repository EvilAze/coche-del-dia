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
    const r = normal({ filasUsuario: [{ car_id: VIGENTE, status: "playing" }] });
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
    const r = cambiado({ filasUsuario: [{ car_id: VIEJO, status: "playing" }] });
    expect(r).toEqual({ carId: VIEJO, congelado: true, cocheCambiado: false });
  });

  it("con fila terminada en la revisión anterior, sigue congelado", () => {
    const r = cambiado({ filasUsuario: [{ car_id: VIEJO, status: "won" }] });
    expect(r.carId).toBe(VIEJO);
    expect(r.congelado).toBe(true);
  });

  it("sin fila, juega el coche nuevo", () => {
    expect(cambiado({ filasUsuario: [] }).carId).toBe(VIGENTE);
  });

  it("una fila de REPESCA no lo ancla: no es ni el vigente ni un saliente", () => {
    const r = cambiado({ filasUsuario: [{ car_id: REPESCA, status: "playing" }] });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("la fila manda sobre el sello: fila vieja + sello nuevo → congelado", () => {
    const r = cambiado({
      filasUsuario: [{ car_id: VIEJO, status: "playing" }],
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

describe("los seis huecos que encontró la revisión adversarial", () => {
  it("F6 · sin sello del vigente no se acusa a nadie: no poder comparar no es no coincidir", () => {
    // Sin REPESCA_TOKEN_SECRET el sello sale null. Tratar eso como «no casa»
    // dejaría el juego entero en 409.
    const r = resolverCocheDelUsuario({
      carIdVigente: VIGENTE,
      prevCarIds: [VIEJO],
      sellosPorCarId: { [VIGENTE]: null, [VIEJO]: null },
      selloCliente: "selloDeAyer00001",
    });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(false);
  });

  it("F5 · en un día SIN cambio, un sello desconocido no manda a recargar", () => {
    // El caso que dejaba en bucle infinito a quien jugó anónimo y luego se hizo
    // cuenta: su token viejo nunca se refresca mientras esté logueado.
    const r = normal({ selloCliente: "selloDeAyer00001", intentosAnon: 3 });
    expect(r.carId).toBe(VIGENTE);
    expect(r.cocheCambiado).toBe(false);
  });

  it("F2 · con sesión iniciada, el token anónimo NO ancla", () => {
    const r = cambiado({
      hayUsuario: true,
      filasUsuario: [],
      selloCliente: SELLOS[VIEJO],
      intentosAnon: 2,
    });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("F3 · con fila en el saliente Y en el vigente, gana la del saliente", () => {
    const r = cambiado({
      filasUsuario: [
        { car_id: VIGENTE, status: "playing" },
        { car_id: VIEJO, status: "playing" },
      ],
    });
    expect(r.carId).toBe(VIEJO);
    expect(r.congelado).toBe(true);
  });

  it("un swap A→B→A no marca como congelado a quien está al día", () => {
    const r = resolverCocheDelUsuario({
      carIdVigente: VIGENTE,
      prevCarIds: [VIEJO, VIGENTE],
      sellosPorCarId: SELLOS,
      filasUsuario: [{ car_id: VIGENTE, status: "playing" }],
    });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });

  it("una partida TERMINADA no se escapa del 403 reenviando un sello viejo", () => {
    // La fila manda sobre el sello, y el orden de las reglas es lo único que lo
    // sostiene: este test existe para que reordenarlas rompa aquí y no en
    // producción.
    const r = cambiado({
      filasUsuario: [{ car_id: VIGENTE, status: "won" }],
      selloCliente: SELLOS[VIEJO],
      intentosAnon: 2,
    });
    expect(r.carId).toBe(VIGENTE);
    expect(r.congelado).toBe(false);
  });
});
