// api/car-image.test.js
// El cromo desbloqueado del Archivo es la ruta que se comió la cuota de
// Supabase en septiembre de 2026: servía un 302 a la URL pública del Storage,
// así que cada navegador se bajaba el original entero (~1,3 MB) para pintar
// una miniatura de 170 px, y el CDN de Vercel no llegaba a ver la petición.
//
// Lo que se prueba aquí no es el aspecto de la imagen, es la FACTURA: que los
// bytes salgan de nuestra función (nunca un Location), que pasen por
// `leerImagenOrigen` —máster WebP + caché del proceso— y que la respuesta
// pueda cachearse en el CDN compartido. Un `res.redirect` que vuelva por
// cualquier motivo reintroduce el problema entero sin romper nada más.
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const leerImagenOrigen = vi.fn();
const verifyImageToken = vi.fn();
const maybeSingle = vi.fn();

vi.mock("./_lib/imagen-origen.js", () => ({
  leerImagenOrigen: (...a) => leerImagenOrigen(...a),
}));

vi.mock("./_lib/image-token.js", async (importOriginal) => {
  // Los modos se importan de verdad: si algún día cambian de valor, el test
  // tiene que seguir hablando del mismo modo que el handler.
  const real = await importOriginal();
  return { ...real, verifyImageToken: (...a) => verifyImageToken(...a) };
});

vi.mock("./_lib/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
  getMissingAdminEnvs: () => [],
}));

const { IMAGE_MODE_CLEAR, IMAGE_MODE_BLURRED } = await import("./_lib/image-token.js");
const handler = (await import("./car-image.js")).default;

// Un original de mentira pero REAL: sharp tiene que poder abrirlo, porque la
// mitad del valor de este test es comprobar que el redimensionado ocurre.
async function originalDePrueba(w = 2400, h = 1800) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 120, g: 30, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = String(v);
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

beforeEach(async () => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({
    data: { image_url: "https://ref.supabase.co/storage/v1/object/public/cars_images/x-audi-tt.jpg" },
    error: null,
  });
  const buffer = await originalDePrueba();
  leerImagenOrigen.mockResolvedValue({
    buffer,
    contentType: "image/jpeg",
    deMaster: true,
  });
});

describe("car-image, modo clear (el cromo desbloqueado)", () => {
  it("SIRVE LOS BYTES, no redirige al Storage de Supabase", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);

    expect(res.statusCode).toBe(200);
    // Las dos mitades del bug de septiembre de 2026.
    expect(res.headers.location).toBeUndefined();
    expect(Buffer.isBuffer(res.body)).toBe(true);
  });

  it("lee por leerImagenOrigen (máster WebP + caché del proceso)", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    await handler({ method: "GET", query: { t: "tok" } }, fakeRes());
    // Un `fetch(row.image_url)` a pelo aquí es egress que se paga entero y
    // dos veces: sin máster y sin reaprovechar la instancia caliente.
    expect(leerImagenOrigen).toHaveBeenCalledOnce();
  });

  it("redimensiona a tamaño de portada en vez de servir el original", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);

    const meta = await sharp(res.body).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.format).toBe("webp");
    // El original de prueba es un JPEG plano y comprime ridículamente bien,
    // así que el umbral mira lo único que importa de verdad: que la salida
    // NO sea el buffer de entrada.
    expect(res.body.length).toBeLessThan((await originalDePrueba()).length);
  });

  it("acepta las anchuras de la allowlist y cae al defecto con cualquier otra", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });

    const chica = fakeRes();
    await handler({ method: "GET", query: { t: "tok", w: "320" } }, chica);
    expect((await sharp(chica.body).metadata()).width).toBe(320);

    // Un `?w` libre sería un DoS por resize; fuera de la lista se ignora.
    const absurda = fakeRes();
    await handler({ method: "GET", query: { t: "tok", w: "9000" } }, absurda);
    expect((await sharp(absurda.body).metadata()).width).toBe(1080);
  });

  it("es cacheable en el CDN compartido, y NO inmutable", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);

    const cc = res.headers["cache-control"];
    // `public` + `s-maxage` es lo que pone al CDN de Vercel delante: sin eso,
    // Supabase vuelve a pagar una descarga por jugador.
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/s-maxage=\d+/);
    // Sin `immutable`: la URL no cambia cuando el admin sustituye la foto
    // (el token es determinista por carId+mode), así que una caché eterna
    // dejaría la foto vieja puesta para siempre.
    expect(cc).not.toMatch(/immutable/);
  });

  it("no filtra la URL real del CDN por Content-Disposition", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);
    expect(res.headers["content-disposition"]).toBe("inline");
  });
});

describe("car-image, modo blurred (el cromo bloqueado)", () => {
  it("sigue devolviendo el JPEG borroso de 160x200", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_BLURRED });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);

    const meta = await sharp(res.body).metadata();
    expect(res.statusCode).toBe(200);
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(200);
  });

  it("también pasa por leerImagenOrigen", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_BLURRED });
    await handler({ method: "GET", query: { t: "tok" } }, fakeRes());
    expect(leerImagenOrigen).toHaveBeenCalledOnce();
  });
});

describe("car-image, puerta de entrada", () => {
  it("un token inválido no llega ni a tocar la base", async () => {
    verifyImageToken.mockReturnValue(null);
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "basura" } }, res);
    expect(res.statusCode).toBe(403);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("un modo desconocido se rechaza ANTES de leer cars", async () => {
    // Defensa en profundidad: el mode sale de un token cifrado, pero la
    // comprobación va antes de la consulta para no gastar una lectura.
    verifyImageToken.mockReturnValue({ carId: 7, mode: "z" });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);
    expect(res.statusCode).toBe(400);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("si el Storage no responde, 502 y no una imagen a medias", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    leerImagenOrigen.mockResolvedValue(null);
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);
    expect(res.statusCode).toBe(502);
  });
});
