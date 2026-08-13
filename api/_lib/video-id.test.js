// api/_lib/video-id.test.js
// Las formas en que un ID de YouTube llega de verdad al panel: pegadas desde
// la barra del navegador, desde «Compartir», desde un Short. Si alguna de
// estas dejara de reconocerse, el admin se comería un 400 al guardar un coche
// y no sabría por qué.

import { describe, it, expect } from "vitest";
import { normalizeVideoId } from "./video-id.js";

describe("normalizeVideoId", () => {
  const ID = "dQw4w9WgXcQ";

  it("acepta el ID desnudo", () => {
    expect(normalizeVideoId(ID)).toEqual({ value: ID, error: null });
  });

  it("recorta espacios alrededor", () => {
    expect(normalizeVideoId(`  ${ID}  `).value).toBe(ID);
  });

  it.each([
    ["watch", `https://www.youtube.com/watch?v=${ID}`],
    ["watch sin www", `https://youtube.com/watch?v=${ID}`],
    ["watch con parámetros detrás", `https://www.youtube.com/watch?v=${ID}&t=42s&list=PLxx`],
    ["watch con parámetros delante", `https://www.youtube.com/watch?app=desktop&v=${ID}`],
    ["youtu.be", `https://youtu.be/${ID}`],
    ["youtu.be con marca de tiempo", `https://youtu.be/${ID}?t=90`],
    ["shorts", `https://www.youtube.com/shorts/${ID}`],
    ["embed", `https://www.youtube-nocookie.com/embed/${ID}`],
    ["live", `https://www.youtube.com/live/${ID}`],
  ])("extrae el ID de una URL de %s", (_caso, url) => {
    expect(normalizeVideoId(url)).toEqual({ value: ID, error: null });
  });

  it("cadena vacía = borrar el campo, sin error", () => {
    expect(normalizeVideoId("")).toEqual({ value: null, error: null });
    expect(normalizeVideoId("   ")).toEqual({ value: null, error: null });
  });

  it("null/undefined no son un error (el campo no viene)", () => {
    expect(normalizeVideoId(null).error).toBeNull();
    expect(normalizeVideoId(undefined).error).toBeNull();
  });

  it("rechaza lo que no es texto", () => {
    expect(normalizeVideoId(42).error).toBeTruthy();
    expect(normalizeVideoId({ id: ID }).error).toBeTruthy();
  });

  it("rechaza basura y URLs de otro sitio", () => {
    expect(normalizeVideoId("no-soy-un-id").error).toBeTruthy();
    expect(normalizeVideoId("https://vimeo.com/123456789").error).toBeTruthy();
    // Diez caracteres: un ID de YouTube tiene once, y el CHECK de la BD lo
    // rechazaría con un error mucho peor de leer.
    expect(normalizeVideoId("dQw4w9WgXc").error).toBeTruthy();
  });

  it("no se cuela un ID de doce caracteres recortándolo a once", () => {
    // Guard contra un regex sin anclas: `dQw4w9WgXcQZ` NO es un ID válido y no
    // debe aceptarse tirando la última letra.
    expect(normalizeVideoId("dQw4w9WgXcQZ").error).toBeTruthy();
  });
});
