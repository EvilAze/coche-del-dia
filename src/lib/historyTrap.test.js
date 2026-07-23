import { describe, it, expect } from "vitest";
import { createHistoryTrap } from "./historyTrap";

// Historial de mentira: solo cuenta entradas empujadas y retiradas, que es
// exactamente lo que puede descuadrarse en producción.
function fakeHistory() {
  const h = {
    pushed: 0,
    backs: 0,
    pushState() {
      h.pushed += 1;
    },
    back() {
      h.backs += 1;
      h.pushed -= 1;
    },
  };
  return h;
}

// Overlay de mentira con `niveles` internos: cada "atrás" consume uno y
// devuelve si queda overlay abierto (el contrato de onBack).
function overlayCon(niveles) {
  let restantes = niveles;
  return () => {
    restantes -= 1;
    return restantes > 0;
  };
}

describe("createHistoryTrap", () => {
  it("armar pone exactamente una entrada", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    expect(h.pushed).toBe(1);
    expect(trap.armed).toBe(true);
  });

  it("armar dos veces no duplica la entrada", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    trap.arm();
    expect(h.pushed).toBe(1);
  });

  it("una atrás con nivel interno repone la trampa", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => true);
    trap.arm();
    expect(trap.handlePop()).toBe(true);
    // La consumida por el navegador no la contamos aquí (no la retiramos
    // nosotros); lo que importa es que hay UNA nueva puesta.
    expect(trap.armed).toBe(true);
    expect(h.pushed).toBe(2);
  });

  it("una atrás que cierra del todo NO repone", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    expect(trap.handlePop()).toBe(false);
    expect(trap.armed).toBe(false);
    expect(h.pushed).toBe(1); // la que el navegador ya consumió
  });

  it("cierre por UI retira la entrada", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    expect(trap.disarm()).toBe(true);
    expect(h.backs).toBe(1);
    expect(h.pushed).toBe(0);
  });

  // El fallo que más duele: si tras cerrar con "atrás" volviéramos a llamar a
  // history.back(), le robaríamos al usuario una navegación real suya.
  it("desarmar tras un cierre por atrás no toca el historial", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    trap.handlePop();
    expect(trap.disarm()).toBe(false);
    expect(h.backs).toBe(0);
  });

  it("desarmar dos veces solo retira una", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, () => false);
    trap.arm();
    trap.disarm();
    trap.disarm();
    expect(h.backs).toBe(1);
  });

  // Recorrido completo de El Archivo: detalle → filtro → cerrar. Tres pulsaciones
  // y la trampa debe quedar limpia, sin entradas huérfanas.
  it("cadena de tres niveles: cada atrás baja uno y la última cierra", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, overlayCon(3));
    trap.arm();

    expect(trap.handlePop()).toBe(true); // cierra el detalle
    expect(trap.handlePop()).toBe(true); // quita el filtro
    expect(trap.handlePop()).toBe(false); // cierra el archivo

    expect(trap.armed).toBe(false);
    // Y al desmontarse no intenta retirar nada: el navegador ya consumió todo.
    expect(trap.disarm()).toBe(false);
    expect(h.backs).toBe(0);
  });

  it("cadena interrumpida por cierre de UI: retira solo la trampa viva", () => {
    const h = fakeHistory();
    const trap = createHistoryTrap(h, overlayCon(3));
    trap.arm();
    trap.handlePop(); // baja un nivel y repone
    expect(trap.disarm()).toBe(true); // el usuario cierra con la X
    expect(h.backs).toBe(1);
    expect(trap.armed).toBe(false);
  });
});
