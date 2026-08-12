// @vitest-environment jsdom
//
// src/hooks/useHistoryClose.test.jsx
// EL RELEVO ENTRE DOS OVERLAYS, con React de verdad por medio.
//
// historyTrap.test.js prueba la contabilidad con llamadas a mano. Lo que falta
// probar aquí es la otra mitad del fallo: que el orden en que React ejecuta un
// commit —primero TODAS las limpiezas, después TODOS los efectos nuevos— cae
// dentro del margen que el relevo se da para no tocar el historial. Si ese
// orden cambiara, o si alguien volviera a retirar la entrada en el acto, esta
// suite se pone roja.
//
// La ventana es falsa a propósito: jsdom NO modela la cola de recorridos del
// navegador (se traga el back() encolado si alguien empuja después), así que
// con su historial este test pasaba en verde teniendo el bug delante.

import React from "react"; // eslint-disable-line no-unused-vars
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import { crearRelevo, instalarRelevoParaTest } from "../lib/historyTrap";
import { ventanaFalsa } from "../lib/ventanaFalsa";
import { useHistoryClose, useHistoryChain } from "./useHistoryClose";

let ventana;

beforeEach(() => {
  ventana = ventanaFalsa();
  instalarRelevoParaTest(crearRelevo(ventana));
});

afterEach(() => {
  cleanup();
  instalarRelevoParaTest(null);
});

// Deja que React termine el commit y que corra la microtarea del relevo.
async function asentar() {
  await act(async () => {});
  ventana.correrCola();
}

// El Archivo: overlay con niveles internos, o sea con su propia cadena.
function Archivo({ open, onBack }) {
  useHistoryChain(open, onBack);
  return null;
}

// La misma forma que App.jsx: un único slot de modal, la trampa simple para los
// modales normales y El Archivo fuera de ella, con su cadena.
function Juego({ modal, cerrar, atrasArchivo }) {
  useHistoryClose(modal !== null && modal !== "archivo", cerrar);
  return <Archivo open={modal === "archivo"} onBack={atrasArchivo} />;
}

describe("useHistoryClose / useHistoryChain", () => {
  it("abrir El Archivo desde el sumario no lo cierra de rebote", async () => {
    const cerrar = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    const { rerender } = render(
      <Juego modal="menu" cerrar={cerrar} atrasArchivo={atrasArchivo} />
    );
    await asentar();

    // El jugador toca «Archivo» en el sumario: un solo commit cierra el menú y
    // abre el archivo.
    await act(async () => {
      rerender(<Juego modal="archivo" cerrar={cerrar} atrasArchivo={atrasArchivo} />);
    });
    await asentar();

    // Nadie ha pulsado «atrás»: no debería haberse disparado ninguna cadena.
    expect(atrasArchivo).not.toHaveBeenCalled();
    expect(cerrar).not.toHaveBeenCalled();
    // Y queda UNA entrada viva, la que el Archivo ha heredado.
    expect(ventana.profundidad).toBe(1);
  });

  it("con El Archivo abierto, la atrás sigue cerrándolo", async () => {
    const cerrar = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    render(<Juego modal="archivo" cerrar={cerrar} atrasArchivo={atrasArchivo} />);
    await asentar();

    await act(async () => {
      ventana.atras();
    });

    expect(atrasArchivo).toHaveBeenCalledTimes(1);
    expect(ventana.profundidad).toBe(0);
  });

  it("cerrar el Archivo por la UI retira su entrada, sin dejar una atrás muerta", async () => {
    const cerrar = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    const { rerender } = render(
      <Juego modal="archivo" cerrar={cerrar} atrasArchivo={atrasArchivo} />
    );
    await asentar();
    expect(ventana.profundidad).toBe(1);

    await act(async () => {
      rerender(<Juego modal={null} cerrar={cerrar} atrasArchivo={atrasArchivo} />);
    });
    await asentar();

    expect(ventana.profundidad).toBe(0);
  });

  // El relevo al revés, y el que rompía la puerta de entrada: en la
  // clasificación, un jugador anónimo toca ENTRAR y el botón hace `onClose()` +
  // `onOpenLogin()` en el mismo gesto. La cadena de la tabla se desmonta y el
  // login entra en el slot global; con una trampa por overlay, el login se
  // cerraba solo antes de que se viera y el botón parecía roto.
  it("de la clasificación al login: el modal de entrada no se cierra solo", async () => {
    const cerrar = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    const { rerender } = render(
      <Juego modal="archivo" cerrar={cerrar} atrasArchivo={atrasArchivo} />
    );
    await asentar();

    await act(async () => {
      rerender(<Juego modal="login" cerrar={cerrar} atrasArchivo={atrasArchivo} />);
    });
    await asentar();

    expect(cerrar).not.toHaveBeenCalled();
    expect(atrasArchivo).not.toHaveBeenCalled();
    expect(ventana.profundidad).toBe(1);
  });

  it("de un modal normal a otro no se dispara ningún cierre", async () => {
    const cerrar = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    const { rerender } = render(
      <Juego modal="menu" cerrar={cerrar} atrasArchivo={atrasArchivo} />
    );
    await asentar();

    await act(async () => {
      rerender(<Juego modal="ranking" cerrar={cerrar} atrasArchivo={atrasArchivo} />);
    });
    await asentar();

    expect(cerrar).not.toHaveBeenCalled();
    expect(ventana.profundidad).toBe(1);
  });

  // El pliego del resultado (EndScreen) monta su trampa y NO se desmonta al
  // abrir El Archivo encima: antes eso ponía dos entradas fantasma y una sola
  // pulsación cerraba los dos paneles de golpe.
  it("con dos overlays abiertos, la atrás cierra solo el de arriba", async () => {
    const cerrarPliego = vi.fn();
    const atrasArchivo = vi.fn(() => false);

    function Pliego() {
      useHistoryClose(true, cerrarPliego);
      return null;
    }
    // Con estado real: cerrar el Archivo tiene que desmontar su cadena, que es
    // lo que le devuelve el turno al pliego de debajo.
    let abrirArchivo;
    function Pantalla() {
      const [archivo, setArchivo] = useState(false);
      abrirArchivo = setArchivo;
      return (
        <>
          <Pliego />
          <Archivo
            open={archivo}
            onBack={() => {
              atrasArchivo();
              setArchivo(false);
              return false;
            }}
          />
        </>
      );
    }

    render(<Pantalla />);
    await asentar();

    await act(async () => {
      abrirArchivo(true);
    });
    await asentar();
    expect(ventana.profundidad).toBe(1); // una sola entrada para los dos

    await act(async () => {
      ventana.atras();
    });
    expect(atrasArchivo).toHaveBeenCalledTimes(1);
    expect(cerrarPliego).not.toHaveBeenCalled();

    // Y el pliego conserva la suya: la siguiente atrás es la que lo cierra.
    await asentar();
    await act(async () => {
      ventana.atras();
    });
    expect(cerrarPliego).toHaveBeenCalledTimes(1);
  });
});
