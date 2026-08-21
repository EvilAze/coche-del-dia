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

async function montar({ guesses = [], catalogo = CATALOGO, error = null, reload = vi.fn() } = {}) {
  vi.resetModules();

  // La plataforma: esta es LA condición que separa las dos ramas del cupón.
  vi.doMock("../../lib/plataforma", () => ({ esApp: () => true }));
  vi.doMock("../../data/catalog", () => ({
    useCatalog: () => ({ data: catalogo, error, loading: !catalogo && !error, reload }),
  }));
  vi.doMock("../Toast", () => ({ useToast: () => ({ push: vi.fn() }) }));
  vi.doMock("../../lib/haptics", () => ({
    haptic: { selection: vi.fn(), impactLight: vi.fn(), impactMedium: vi.fn(), warning: vi.fn() },
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

  // ── LA VÍA DE TECLADO DE LA HOJA ───────────────────────────────────────────
  // El buscador se autoenfoca por encima de 12 opciones, así que teclear tiene
  // que ser un camino COMPLETO. Antes solo atendía a Enter y elegía siempre la
  // primera coincidencia: quien veía que la suya era la tercera no tenía forma
  // de llegar a ella sin levantar la mano y tocarla.
  it("las flechas señalan y Enter elige la señalada, no siempre la primera", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));

    // 15 marcas (>12) → el buscador manda, y se enfoca solo.
    const buscador = screen.getByRole("combobox");
    expect(document.activeElement).toBe(buscador);

    // De la primera (Citroën) a la segunda (Seat).
    fireEvent.keyDown(buscador, { key: "ArrowDown" });
    const senalada = screen.getByRole("option", { name: /Seat/ });
    // Sin esto un lector de pantalla no anunciaría el movimiento.
    expect(buscador.getAttribute("aria-activedescendant")).toBe(senalada.id);

    fireEvent.keyDown(buscador, { key: "Enter" });
    expect(renglon("cdd.labelMarca").textContent).toContain("Seat");
  });

  it("teclear filtra y Enter elige la coincidencia, sin tocar la pantalla", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));

    const buscador = screen.getByRole("combobox");
    // Sin tilde: el filtro normaliza, «citroen» tiene que encontrar «Citroën».
    fireEvent.change(buscador, { target: { value: "citroen" } });
    expect(screen.queryByRole("option", { name: /Seat/ })).toBeNull();

    fireEvent.keyDown(buscador, { key: "Enter" });
    expect(renglon("cdd.labelMarca").textContent).toContain("Citroën");
  });

  // ── EL ÍNDICE A-Z, QUE SE RECORRE CON EL DEDO ──────────────────────────────
  // Tenía la forma del índice de la agenda pero no su gesto: solo toques
  // sueltos sobre letras de 10px. Esto comprueba el arrastre, que es lo que
  // convierte 80 marcas en un movimiento en vez de en una puntería.
  it("arrastrar por el índice va cambiando de letra, y soltar lo apaga", async () => {
    // El índice solo se pinta por encima de 25 opciones: una marca por letra.
    const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}auto`);
    await montar({ catalogo: { cars: CATALOGO.cars, marcas: ABC } });
    fireEvent.click(renglon("cdd.labelMarca"));

    const tira = screen.getByRole("navigation", { name: "cdd.selectorIndex" });
    // jsdom no maqueta, así que la tira mide 0 y la cuenta por proporción no
    // tendría de dónde salir. Le damos una altura: 26 letras en 260px = 10px
    // cada una.
    tira.getBoundingClientRect = () => ({
      top: 0, bottom: 260, height: 260, left: 0, right: 20, width: 20, x: 0, y: 0,
    });

    fireEvent.pointerDown(tira, { clientY: 5 });
    expect(screen.getByRole("button", { name: "A" }).className).toContain("activa");

    // El dedo baja SIN levantarse: la letra señalada acompaña.
    fireEvent.pointerMove(tira, { clientY: 125 });
    expect(screen.getByRole("button", { name: "M" }).className).toContain("activa");
    expect(screen.getByRole("button", { name: "A" }).className).not.toContain("activa");

    // Al soltar no queda ninguna encendida: dejarla puesta mentiría en cuanto la
    // lista se desplace por su cuenta.
    fireEvent.pointerUp(tira);
    expect(screen.getByRole("button", { name: "M" }).className).not.toContain("activa");
  });

  it("sin arrastre, mover el dedo por encima del índice no hace nada", async () => {
    const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `${l}auto`);
    await montar({ catalogo: { cars: CATALOGO.cars, marcas: ABC } });
    fireEvent.click(renglon("cdd.labelMarca"));

    const tira = screen.getByRole("navigation", { name: "cdd.selectorIndex" });
    tira.getBoundingClientRect = () => ({
      top: 0, bottom: 260, height: 260, left: 0, right: 20, width: 20, x: 0, y: 0,
    });

    // Con el ratón paseando sin botón pulsado, la lista no debe irse sola.
    fireEvent.pointerMove(tira, { clientY: 125 });
    expect(screen.getByRole("button", { name: "M" }).className).not.toContain("activa");
  });

  // ── EL CUPÓN SIN CATÁLOGO ──────────────────────────────────────────────────
  // El fallo reportado el 2026-08-10: en una repesca, la fotografía había
  // cargado y los renglones no se dejaban tocar. Eran correctos —sin catálogo no
  // hay marcas que ofrecer— pero no lo decían: seguían con su «Elegir…», así que
  // parecía la app rota y no un dato que falta. Y sin catálogo NUNCA se recupera
  // solo si nadie reintenta.
  it("catálogo caído: lo dice y ofrece reintentar, en vez de tres renglones muertos", async () => {
    const reload = vi.fn();
    await montar({ catalogo: null, error: new Error("boom"), reload });

    // Los renglones no se pintan: lo que hay es el cartel.
    expect(screen.queryByRole("button", { name: /^cdd\.labelMarca:/ })).toBeNull();
    expect(screen.getByText("cdd.catalogDownTitle")).toBeTruthy();

    // Y el único gesto que queda es útil: reintentar de verdad.
    fireEvent.click(screen.getByRole("button", { name: "offline.retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("catálogo caído: sin ADIVINAR, que ahí no adivina nada", async () => {
    await montar({ catalogo: null, error: new Error("boom") });
    expect(screen.queryByRole("button", { name: "cdd.submit" })).toBeNull();
  });

  it("catálogo cargando: los renglones lo DICEN («Cargando…», no «Elegir…»)", async () => {
    await montar({ catalogo: null });
    // Deshabilitados, como siempre: sin marcas no hay lista que abrir. La
    // diferencia es que ahora el renglón explica por qué.
    expect(renglon("cdd.labelMarca").disabled).toBe(true);
    expect(renglon("cdd.labelMarca").textContent).toContain("cdd.catalogLoading");
    // El modelo tampoco puede decir «elige marca primero»: es una instrucción
    // imposible mientras el renglón de marca tampoco se abre.
    expect(renglon("cdd.labelModelo").textContent).toContain("cdd.catalogLoading");
  });

  // Antes este test decía «MODELO está bloqueado hasta que hay marca» y
  // comprobaba `disabled === true`. Seguía sin poder listar modelos —eso no ha
  // cambiado, y no puede cambiar: los modelos acotan el coche— pero tocarlo no
  // devolvía NADA, que en táctil no se lee como «todavía no» sino como «roto».
  it("tocar MODELO sin marca no muere: abre la hoja de MARCA", async () => {
    await montar();
    expect(renglon("cdd.labelModelo").disabled).toBe(false);

    fireEvent.click(renglon("cdd.labelModelo"));

    // Lo que se abre es MARCA, no una lista de modelos vacía.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("option", { name: /Volkswagen/ })).toBeTruthy();

    // Y la cadena de siempre remata el gesto: elegir marca lleva a modelo, así
    // que el dedo acaba donde apuntaba.
    fireEvent.click(screen.getByRole("option", { name: /Seat/ }));
    expect(screen.getByRole("option", { name: /Ibiza/ })).toBeTruthy();
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

// ── LA FOTOGRAFÍA NO SE PIERDE MIENTRAS SE ELIGE ────────────────────────────
// La composición vive en CSS, pero quien la enciende es JS: useEscenarioApartado
// mide la pantalla y publica el resultado en `<html>`. Y esa medida se agarra a
// tres asideros del DOM —el panel de la hoja, `[data-escenario]` y el pliego
// `.app-pantalla`— que ningún compilador vigila: si mañana alguien renombra uno,
// la hoja seguirá abriéndose tan campante y la foto volverá a quedarse debajo,
// sin un solo error en consola. Esto lo caza.
//
// jsdom no maqueta (todo mide cero), así que las cuatro medidas que entran en la
// cuenta se sirven a mano. Los números son los de un móvil de 360x800 con la
// hoja de MARCA abierta; la aritmética en sí ya la prueba escenarioApartado.test.
describe("La hoja aparta el escenario en vez de taparlo", () => {
  const ALTO_VENTANA = 800;
  const ALTO_HOJA = 500;
  const FOTO_TOP = 137;
  const FOTO_ALTO = 252;

  let pliego;
  let rectOriginal;
  let innerHeightOriginal;

  beforeEach(() => {
    // El pliego de la partida, que este test monta a mano porque GuessForm es
    // solo el cupón: la foto y el shell viven en Configurator.
    pliego = document.createElement("main");
    pliego.className = "app-pantalla";
    pliego.style.paddingTop = "30px"; // el inset de la barra de estado + aire
    const escenario = document.createElement("div");
    escenario.setAttribute("data-escenario", "");
    pliego.appendChild(escenario);
    document.body.appendChild(pliego);

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if (this.classList.contains("pm-hoja")) return ALTO_HOJA;
        if (this.hasAttribute("data-escenario")) return FOTO_ALTO;
        return 0;
      },
    });
    rectOriginal = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const base = rectOriginal.call(this);
      if (this.hasAttribute?.("data-escenario")) return { ...base, top: FOTO_TOP };
      return base;
    };
    innerHeightOriginal = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: ALTO_VENTANA,
    });
  });

  afterEach(() => {
    pliego.remove();
    delete HTMLElement.prototype.offsetHeight;
    Element.prototype.getBoundingClientRect = rectOriginal;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: innerHeightOriginal,
    });
  });

  it("abrir la hoja sube la foto y apaga el cromo de encima", async () => {
    await montar();
    const raiz = document.documentElement;
    expect(raiz.dataset.eligiendo).toBeUndefined();

    fireEvent.click(renglon("cdd.labelMarca"));

    // 137 + 252 = 389 de fondo de foto contra un suelo de 290 (800 - 500 - 10):
    // sobran 99px y encima hay 107 de cabecera y ladillo, así que sube los 99 y
    // NO encoge. Esa es la promesa del diseño en un móvil normal.
    await waitFor(() => {
      expect(raiz.style.getPropertyValue("--cdd-escenario-subida")).toBe("99px");
    });
    expect(raiz.style.getPropertyValue("--cdd-escenario-escala")).toBe("1");
    // "apartada" es lo que apaga la cabecera y el ladillo: la foto les pisa el
    // sitio, así que se quitan de en medio.
    expect(raiz.dataset.eligiendo).toBe("apartada");
  });

  // ── EL ARRASTRE ──────────────────────────────────────────────────────────
  // El tirador promete que la hoja se cierra hacia abajo; esto comprueba que la
  // promesa se cumple y, sobre todo, que NO se cumple de más: un roce mientras
  // se recorre la lista no puede tirar la hoja. jsdom no tiene gestos, así que
  // el dedo se escribe a mano — que es lo único que hace falta, porque lo que se
  // prueba es el umbral, no la física.
  const dedo = (el, ys) => {
    fireEvent.touchStart(el, { touches: [{ clientX: 180, clientY: ys[0] }] });
    for (const y of ys.slice(1)) {
      fireEvent.touchMove(el, { touches: [{ clientX: 180, clientY: y }] });
    }
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 180, clientY: ys[ys.length - 1] }] });
  };

  it("arrastrar la hoja hacia abajo la cierra", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));
    const hoja = document.querySelector(".pm-hoja");

    // 240px sobre una hoja de 500: pasa de sobra el 28% que hace falta.
    dedo(hoja, [400, 460, 540, 640]);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("un roce corto NO la cierra: vuelve a su sitio", async () => {
    await montar();
    fireEvent.click(renglon("cdd.labelMarca"));
    const hoja = document.querySelector(".pm-hoja");

    // 40px de nada. Ni llega al 28% ni es un gesto rápido (los eventos de un
    // test caen todos en el mismo milisegundo, así que no hay ventana de
    // velocidad que medir — que es justo lo que la ventana de 30ms garantiza).
    dedo(hoja, [400, 420, 448]);

    expect(screen.getByRole("dialog")).toBeTruthy();
    // Y la hoja se anima de vuelta al cero, sin quedarse colgada donde el dedo.
    expect(hoja.style.transform).toBe("translateY(0px)");
  });

  it("al cerrar la hoja la foto vuelve a su sitio", async () => {
    await montar();
    const raiz = document.documentElement;
    fireEvent.click(renglon("cdd.labelMarca"));
    await waitFor(() => expect(raiz.dataset.eligiendo).toBe("apartada"));

    fireEvent.click(screen.getByRole("button", { name: "cdd.selectorClose" }));

    // Sin atributo no hay `transform`, y la transición del CSS devuelve la foto
    // mientras la hoja se va. Que se limpie importa: si se quedara puesto, la
    // foto se quedaría subida y encogida el resto de la partida.
    await waitFor(() => {
      expect(raiz.dataset.eligiendo).toBeUndefined();
    });
    expect(raiz.style.getPropertyValue("--cdd-escenario-subida")).toBe("");
  });
});
