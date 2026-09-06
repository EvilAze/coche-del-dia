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
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { versionDePortada } from "./_lib/version-imagen.js";

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

const IMAGE_URL =
  "https://ref.supabase.co/storage/v1/object/public/cars_images/1712345678-audi-tt.jpg";

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
  maybeSingle.mockResolvedValue({ data: { image_url: IMAGE_URL }, error: null });
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

  it("con el `v` correcto se cachea eterna: es el camino normal", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const v = await versionDePortada(IMAGE_URL);
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok", v } }, res);

    // `public` es lo que pone al CDN de Vercel delante; `immutable` es lo que
    // hace que Supabase pague UNA descarga por coche en vez de una por PoP y
    // semana. Es seguro porque cambiar la foto cambia image_url → cambia v.
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/immutable/);
  });

  it("el `v` lo calcula igual que garage.js, o la caché no acertaría nunca", async () => {
    // Las dos mitades usan versionDePortada; si alguien duplicase la fórmula
    // en un lado, el servidor no reconocería sus propias URLs y cada visita
    // sería un fallo de caché — el gasto de vuelta, en silencio.
    expect(await versionDePortada(IMAGE_URL)).toBe(await versionDePortada(IMAGE_URL));
    expect(await versionDePortada(IMAGE_URL)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("SIN `v` sigue funcionando, con la caché conservadora", async () => {
    // Una URL emitida antes de este cambio, viva en el navegador de alguien o
    // en un payload de /api/garage ya servido. Romperla dejaría el álbum sin
    // fotos hasta recargar.
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/s-maxage=\d+/);
    // Sin `immutable`: esa URL no cambia al sustituir la foto, así que una
    // caché eterna la dejaría clavada.
    expect(res.headers["cache-control"]).not.toMatch(/immutable/);
  });

  it("un `v` que no cuadra SIRVE la foto buena, pero en caché privada", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_CLEAR });
    const res = fakeRes();
    await handler({ method: "GET", query: { t: "tok", v: "deadbeef" } }, res);

    // Nadie se queda sin cromo: puede ser simplemente un cliente con el
    // payload viejo justo después de que el admin cambiara la foto.
    expect(res.statusCode).toBe(200);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // Pero `private` para que un `v` inventado no pueda crear entradas en el
    // CDN compartido: si pudiera, forzar fallos de caché en cadena sería
    // trivial, que es justo el gasto que este cambio viene a cerrar.
    expect(res.headers["cache-control"]).toMatch(/private/);
    expect(res.headers["cache-control"]).not.toMatch(/immutable/);
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

  it("nunca se cachea como inmutable, ni aunque le cuelen un `v`", async () => {
    verifyImageToken.mockReturnValue({ carId: 7, mode: IMAGE_MODE_BLURRED });
    const res = fakeRes();
    const v = await versionDePortada(IMAGE_URL);
    await handler({ method: "GET", query: { t: "tok", v } }, res);
    expect(res.headers["cache-control"]).not.toMatch(/immutable/);
  });

  it("garage.js NO le pone `v` a la URL de un cromo bloqueado", async () => {
    // El `v` sale de image_url, cuyo fichero lleva marca-modelo-año: en un
    // bloqueado sería un identificador estable del coche que el jugador aún no
    // ha ganado, justo la correlación que garage.js rompe con pseudoIdFor.
    // Se comprueba en la fuente porque es una decisión de QUIÉN EMITE la URL,
    // y aquí no hay nada que la impida si alguien la añade por simetría.
    const fuente = readFileSync(new URL("./garage.js", import.meta.url), "utf8");
    expect(fuente).toMatch(/carImageProxyUrl\(\s*c\.id,\s*IMAGE_MODE_BLURRED\s*\)/);
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
