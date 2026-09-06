// api/_lib/blur-data.test.js
// El LQIP corre DENTRO del guardado de un coche (lib/admin-handlers/save-car.js
// lo llama en el alta y en cada cambio de foto), así que lo que hay que
// asegurar no es la calidad del borrón: es que este módulo no tumbe el
// guardado. Devolver null es un coche sin blur_data —el front cae al
// skeleton—; lanzar es un alta perdida.
//
// Y hay una segunda cosa que comprobar desde que los bytes entran por
// `leerImagenOrigen`: el máster es WebP, y el LQIP tiene que seguir saliendo
// como JPEG en base64 pase lo que pase, porque esa data URI viaja tal cual a
// una columna que el cliente pinta a ciegas.
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const leerImagenOrigen = vi.fn();
vi.mock("./imagen-origen.js", () => ({
  leerImagenOrigen: (...args) => leerImagenOrigen(...args),
}));

const { generateBlurData } = await import("./blur-data.js");

// Una foto de verdad, minúscula: sharp tiene que poder leerla y redimensionarla.
async function foto(formato) {
  const base = sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 180, g: 40, b: 30 } },
  });
  return formato === "webp"
    ? { buffer: await base.webp().toBuffer(), contentType: "image/webp", deMaster: true }
    : { buffer: await base.jpeg().toBuffer(), contentType: "image/jpeg", deMaster: false };
}

beforeEach(() => {
  leerImagenOrigen.mockReset();
});

describe("generateBlurData", () => {
  it("saca el LQIP en JPEG aunque los bytes vengan del máster WebP", async () => {
    leerImagenOrigen.mockResolvedValue(await foto("webp"));
    const uri = await generateBlurData("https://ref.supabase.co/x/audi.jpg");
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("también con el original, que es lo que llega en una foto recién subida", async () => {
    // El máster de una foto que se acaba de subir no existe todavía, así que
    // este es el camino NORMAL de este módulo, no el degradado.
    leerImagenOrigen.mockResolvedValue(await foto("jpeg"));
    expect(await generateBlurData("https://ref.supabase.co/x/audi.jpg")).toMatch(
      /^data:image\/jpeg;base64,/
    );
  });

  it("sin bytes devuelve null, NO lanza: el alta del coche sigue", async () => {
    leerImagenOrigen.mockResolvedValue(null);
    await expect(generateBlurData("https://ref.supabase.co/x/audi.jpg")).resolves.toBeNull();
  });

  it("una URL que no es http se rechaza ANTES de tocar la red", async () => {
    expect(await generateBlurData("javascript:alert(1)")).toBeNull();
    expect(await generateBlurData(null)).toBeNull();
    expect(leerImagenOrigen).not.toHaveBeenCalled();
  });

  it("bytes que no son una imagen devuelven null en vez de reventar sharp", async () => {
    leerImagenOrigen.mockResolvedValue({
      buffer: Buffer.from("esto no es un JPEG"),
      contentType: "image/jpeg",
      deMaster: false,
    });
    await expect(generateBlurData("https://ref.supabase.co/x/roto.jpg")).resolves.toBeNull();
  });
});
