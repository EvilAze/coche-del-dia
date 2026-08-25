// api/_lib/sello.test.js
// Lo que de verdad importa aquí no es que el HMAC funcione: es que el sello NO
// contenga el car_id. Viaja en el token anónimo, que el cliente puede leer y
// descodificar; si el id se pudiera sacar de ahí, bastaría cruzarlo con
// /api/list-cars para saber el coche del día (regla 5).

import { describe, it, expect, beforeAll } from "vitest";
import { selloDeCoche } from "./sello.js";

const CAR = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTRO = "9c858901-8a57-4791-81fe-4c455b099bc9";
const HOY = "2026-08-25";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

describe("selloDeCoche", () => {
  it("no contiene el car_id ni ninguno de sus trozos", async () => {
    const sello = await selloDeCoche(CAR, HOY);
    expect(sello).not.toContain(CAR);
    for (const trozo of CAR.split("-")) {
      expect(sello.toLowerCase()).not.toContain(trozo.toLowerCase());
    }
  });

  it("es estable: el mismo coche y día dan el mismo sello", async () => {
    expect(await selloDeCoche(CAR, HOY)).toBe(await selloDeCoche(CAR, HOY));
  });

  it("distingue coches", async () => {
    expect(await selloDeCoche(CAR, HOY)).not.toBe(await selloDeCoche(OTRO, HOY));
  });

  it("distingue días: el mismo coche en otra fecha sella distinto", async () => {
    expect(await selloDeCoche(CAR, HOY)).not.toBe(await selloDeCoche(CAR, "2026-08-26"));
  });

  it("sin secreto devuelve null en vez de un sello falso", async () => {
    const previo = process.env.REPESCA_TOKEN_SECRET;
    process.env.REPESCA_TOKEN_SECRET = "";
    expect(await selloDeCoche(CAR, HOY)).toBe(null);
    process.env.REPESCA_TOKEN_SECRET = previo;
  });

  it("sin carId devuelve null", async () => {
    expect(await selloDeCoche(null, HOY)).toBe(null);
  });
});
