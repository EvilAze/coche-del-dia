import { describe, it, expect, vi } from "vitest";
import { crearRelevo } from "./historyTrap";
import { ventanaFalsa } from "./ventanaFalsa";

// Deja correr la microtarea en la que el relevo aplaza sus retiradas.
const microtarea = () => Promise.resolve();

// Overlay de mentira con `niveles` internos: cada "atrás" consume uno y
// devuelve si queda overlay abierto (el contrato del manejador).
function overlayCon(niveles) {
  let restantes = niveles;
  return () => {
    restantes -= 1;
    return restantes > 0;
  };
}

describe("relevo de historial", () => {
  it("abrir un overlay pone exactamente una entrada", () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    r.registrar(() => false);
    expect(v.profundidad).toBe(1);
    expect(r.armada).toBe(true);
  });

  it("dos overlays abiertos comparten UNA sola entrada", () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    r.registrar(() => false);
    r.registrar(() => false);
    expect(v.profundidad).toBe(1);
  });

  it("la atrás la recibe el overlay de ARRIBA, no los de debajo", () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const abajo = vi.fn(() => false);
    const arriba = vi.fn(() => false);
    r.registrar(abajo);
    r.registrar(arriba);

    v.atras();

    expect(arriba).toHaveBeenCalledTimes(1);
    expect(abajo).not.toHaveBeenCalled();
    // Y como abajo queda otro overlay, la trampa sigue puesta para él.
    expect(r.armada).toBe(true);
  });

  it("una atrás con nivel interno repone la trampa", () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    r.registrar(() => true);
    v.atras();
    expect(r.armada).toBe(true);
    expect(v.profundidad).toBe(1);
  });

  it("una atrás que cierra el último overlay NO repone", () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const baja = r.registrar(() => false);
    v.atras();
    expect(r.armada).toBe(false);
    expect(v.profundidad).toBe(0);
    // Y al desmontarse el overlay no se retira nada: ya lo consumió el
    // navegador. Retirar aquí le robaría al usuario una navegación suya.
    baja();
    v.correrCola();
    expect(v.profundidad).toBe(0);
  });

  it("cierre por UI: la entrada se retira cuando la pila se vacía", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const baja = r.registrar(() => false);
    baja();
    expect(v.profundidad).toBe(1); // aún no: la retirada va aplazada
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(0);
    expect(r.armada).toBe(false);
  });

  it("cerrar el de arriba deja la entrada al de abajo", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    r.registrar(() => false);
    const bajaArriba = r.registrar(() => false);
    bajaArriba();
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(1);
    expect(r.armada).toBe(true);
  });

  // EL BUG QUE ESTO EXISTE PARA IMPEDIR. Tocar «Archivo» en el sumario cierra
  // uno y abre el otro en el MISMO commit de React: primero la limpieza, luego
  // el efecto nuevo. Con una trampa por overlay, el back() encolado del sumario
  // se comía la entrada recién puesta por el Archivo y el panel se cerraba solo
  // en una fracción de segundo.
  it("relevo en el mismo commit: ni se retira ni rebota", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const sumario = vi.fn(() => false);
    const archivo = vi.fn(() => false);

    const bajaSumario = r.registrar(sumario);
    bajaSumario(); // limpieza del efecto del sumario
    r.registrar(archivo); // efecto del Archivo, mismo commit

    await microtarea();
    v.correrCola();

    expect(archivo).not.toHaveBeenCalled();
    expect(sumario).not.toHaveBeenCalled();
    expect(v.profundidad).toBe(1); // la MISMA entrada, sin tocar el historial
    expect(r.armada).toBe(true);

    // Y la trampa sigue viva para el Archivo.
    v.atras();
    expect(archivo).toHaveBeenCalledTimes(1);
    expect(v.profundidad).toBe(0);
  });

  // El Archivo es un chunk perezoso: la primera vez tarda en llegar, así que su
  // alta puede caer cuando la retirada del sumario YA va camino del navegador.
  // El rebote es el mismo si esa retirada se lleva por delante la entrada nueva.
  it("abrir un overlay con una retirada en vuelo no rebota", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const archivo = vi.fn(() => false);

    const bajaSumario = r.registrar(() => false);
    bajaSumario();
    await microtarea(); // la retirada se pide: hay un recorrido encolado
    expect(v.pendientes).toBe(1);

    r.registrar(archivo); // el chunk llega justo ahora
    v.correrCola(); // y el navegador digiere el recorrido de antes

    expect(archivo).not.toHaveBeenCalled();
    expect(r.armada).toBe(true);
    expect(v.profundidad).toBe(1);

    // Y la trampa del Archivo sigue siendo útil.
    v.atras();
    expect(archivo).toHaveBeenCalledTimes(1);
  });

  // Con todo cerrado, la «atrás» vuelve a ser navegación del usuario: si nos
  // metiéramos por medio, le robaríamos una entrada suya de verdad.
  it("una atrás sin trampa puesta no dispara a nadie", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const overlay = vi.fn(() => false);
    r.registrar(overlay);
    v.atras(); // cierra el overlay (la trampa se consume)
    expect(overlay).toHaveBeenCalledTimes(1);

    v.atras(); // el usuario insiste: esto ya es salir
    expect(overlay).toHaveBeenCalledTimes(1);
  });

  it("relevo al revés (alta antes que baja) también cuadra", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const bajaPrimero = r.registrar(() => false);
    r.registrar(() => false);
    bajaPrimero();
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(1);
    expect(r.armada).toBe(true);
  });

  it("darse de baja dos veces no descuadra la pila", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const baja = r.registrar(() => false);
    baja();
    baja();
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(0);
    expect(r.abiertos).toBe(0);
  });

  // Recorrido completo de El Archivo: detalle → filtro → cerrar. Tres
  // pulsaciones y el historial debe quedar limpio, sin entradas huérfanas.
  it("cadena de tres niveles: cada atrás baja uno y la última cierra", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const baja = r.registrar(overlayCon(3));

    v.atras(); // cierra el detalle
    expect(r.armada).toBe(true);
    v.atras(); // quita el filtro
    expect(r.armada).toBe(true);
    v.atras(); // cierra el archivo
    expect(r.armada).toBe(false);

    baja();
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(0);
  });

  it("cadena interrumpida por la X: retira solo la entrada viva", async () => {
    const v = ventanaFalsa();
    const r = crearRelevo(v);
    const baja = r.registrar(overlayCon(3));
    v.atras(); // baja un nivel y repone
    expect(v.profundidad).toBe(1);

    baja(); // el usuario cierra con la X
    await microtarea();
    v.correrCola();
    expect(v.profundidad).toBe(0);
    expect(r.armada).toBe(false);
  });
});
