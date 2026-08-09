// @vitest-environment jsdom
//
// src/components/configurator/GuessForm.app.test.jsx
// EL CUPÓN DE LA APP, EJECUTADO DE VERDAD.
//
// POR QUÉ EXISTE, y es la lección cara de esta tanda de cambios: la rama de la
// app (`esApp()`) NO se puede ver ni en el Preview de Vercel —allí siempre es
// web— ni en el banco de maqueta, que mide CSS sobre una página estática. Se
// fue a un APK dos veces sin haberse ejecutado nunca. Esto la ejecuta: monta el
// formulario con la plataforma simulada, toca el renglón y comprueba que la
// hoja se abre con sus opciones dentro.
//
// Es la única suite del proyecto que necesita DOM (de ahí la línea
// `@vitest-environment jsdom` de arriba, que solo aplica a este fichero).

// React explícito: el resto del proyecto se compila con el runtime automático
// de JSX, pero en este fichero el transform de vitest usa el clásico y sin esta
// línea el render revienta con «React is not defined».
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// Catálogo mínimo pero con la forma real de /api/list-cars.
// Tres marcas de verdad y un relleno hasta pasar de 12, que es el umbral a
// partir del cual la hoja levanta el teclado sola. Sin el relleno no se podría
// probar el autofoco, que es media promesa del diseño.
const MARCAS_RELLENO = Array.from({ length: 12 }, (_, i) => `Marca${i}`);
const CATALOGO = {
  cars: [
    { id: 1, marca: "Seat", modelo: "Ibiza", pais: "es" },
    { id: 2, marca: "Seat", modelo: "León", pais: "es" },
    { id: 3, marca: "Citroën", modelo: "2CV", pais: "fr" },
    { id: 4, marca: "Volkswagen", modelo: "Golf", pais: "de" },
  ],
  marcas: ["Citroën", "Seat", "Volkswagen", ...MARCAS_RELLENO],
};

async function montar({ guesses = [] } = {}) {
  vi.resetModules();

  // La plataforma: esta es LA condición que separa las dos ramas del cupón.
  vi.doMock("../../lib/plataforma", () => ({ esApp: () => true }));
  vi.doMock("../../data/catalog", () => ({
    useCatalog: () => ({ data: CATALOGO, error: null, loading: false }),
  }));
  vi.doMock("../Toast", () => ({ useToast: () => ({ push: vi.fn() }) }));
  vi.doMock("../../lib/haptics", () => ({
    haptic: { selection: vi.fn(), impactMedium: vi.fn(), warning: vi.fn() },
  }));
  // i18n plano: al test le da igual el copy, y así las aserciones no se rompen
  // el día que alguien afine una cadena.
  vi.doMock("../../i18n", () => ({
    useT: () => ({
      t: (clave, vars) =>
        vars ? `${clave}:${Object.values(vars).join(",")}` : clave,
      locale: "es",
    }),
  }));

  const { default: GuessForm } = await import("./GuessForm");
  render(
    <GuessForm onSubmit={vi.fn()} guesses={guesses} attempts={guesses.length} maxAttempts={5} />
  );
}

// El renglón se anuncia como «etiqueta: valor» (lo compone CampoBoton), así que
// se busca por el principio del nombre accesible.
const renglon = (clave) => screen.getByRole("button", { name: new RegExp(`^${clave}:`) });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("El cupón de la app: tres renglones que abren una hoja", () => {
  it("pinta renglones y NO campos de texto (el teclado no debe poder subir)", async () => {
    await montar();
    expect(renglon("cdd.labelMarca")).toBeTruthy();
    expect(renglon("cdd.labelModelo")).toBeTruthy();
    expect(renglon("cdd.labelAnio")).toBeTruthy();
    // Cero <input> en el cupón: si aparece uno, el teclado ha vuelto.
    expect(document.querySelectorAll("input").length).toBe(0);
  });

  it("tocar MARCA abre la hoja con las marcas dentro", async () => {
    await montar();
    // Antes de tocar no hay ningún diálogo montado.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(renglon("cdd.labelMarca"));

    const hoja = screen.getByRole("dialog");
    expect(hoja).toBeTruthy();
    // Las marcas del catálogo, como opciones tocables.
    expect(screen.getByRole("option", { name: /Seat/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Volkswagen/ })).toBeTruthy();
  });

  it("elegir marca NO cierra la hoja: la lleva al modelo, con sus modelos", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));
    fireEvent.click(screen.getByRole("option", { name: /Seat/ }));

    // La marca queda escrita en su renglón...
    expect(renglon("cdd.labelMarca").textContent).toContain("Seat");
    // ...y la MISMA hoja sigue abierta, ya en el paso del modelo. Es lo que
    // evita que el teclado baje y vuelva a subir entre los dos campos.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Ibiza/ })).toBeTruthy();
    // Anti-cheat: los modelos de OTRA marca no pueden asomar aquí.
    expect(screen.queryByRole("option", { name: /Golf/ })).toBeNull();
  });

  it("la cadena sigue hasta el año y ahí se cierra", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));
    fireEvent.click(screen.getByRole("option", { name: /Seat/ }));
    fireEvent.click(screen.getByRole("option", { name: /Ibiza/ }));

    // Tercer paso sin haber tocado nada más: el año.
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(1);

    const anio = screen.getAllByRole("button").find((b) => /^\d{4}$/.test(b.textContent));
    fireEvent.click(anio);

    // Con los tres campos puestos ya no queda paso: la hoja se va.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(renglon("cdd.labelAnio").textContent).toContain(anio.textContent);
  });

  it("la cadena NO se mete en campos ya rellenos: corregir la marca cierra", async () => {
    await montar();
    // Rellena los tres de una pasada.
    fireEvent.click(renglon("cdd.labelMarca"));
    fireEvent.click(screen.getByRole("option", { name: /Seat/ }));
    fireEvent.click(screen.getByRole("option", { name: /Ibiza/ }));
    fireEvent.click(screen.getAllByRole("button").find((b) => /^\d{4}$/.test(b.textContent)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Ahora vuelve a MARCA solo para corregirla: al elegir, la hoja debe
    // cerrarse en vez de arrastrarte otra vez por modelo y año.
    fireEvent.click(renglon("cdd.labelMarca"));
    fireEvent.click(screen.getByRole("option", { name: /Volkswagen/ }));
    // Cambiar de marca sí vacía el modelo, así que el siguiente paso es modelo.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Golf/ })).toBeTruthy();
  });

  it("MODELO está bloqueado hasta que hay marca", async () => {
    await montar();
    expect(renglon("cdd.labelModelo").disabled).toBe(true);
  });

  it("con lista larga el buscador se autoenfoca; filtra sin tildes", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));

    const buscador = screen.getByPlaceholderText("cdd.selectorSearch");
    // 15 marcas: teclear es la vía rápida, así que el teclado sube solo.
    expect(document.activeElement).toBe(buscador);

    fireEvent.change(buscador, { target: { value: "citroen" } });
    expect(screen.getByRole("option", { name: /Citroën/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Seat/ })).toBeNull();
  });

  it("con lista corta NO se autoenfoca: el teclado taparía lo que se viene a ver", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));
    fireEvent.click(screen.getByRole("option", { name: /Seat/ }));

    // Dos modelos: la lista entera cabe, levantar el teclado sería un estorbo.
    const buscador = screen.getByPlaceholderText("cdd.selectorSearch");
    expect(document.activeElement).not.toBe(buscador);
  });

  it("el AÑO se elige por décadas, sin teclear", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelAnio"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    const decadas = screen.getAllByRole("tab");
    expect(decadas.length).toBeGreaterThan(1);

    fireEvent.click(decadas[decadas.length - 1]);
    const anio = screen.getAllByRole("button").find((b) => /^20\d\d$/.test(b.textContent));
    expect(anio).toBeTruthy();
    fireEvent.click(anio);
    expect(renglon("cdd.labelAnio").textContent).toContain(anio.textContent);
    // El año no abre teclado NUNCA: es el campo que lo justificaba menos.
    expect(document.querySelectorAll("input").length).toBe(0);
  });
});
