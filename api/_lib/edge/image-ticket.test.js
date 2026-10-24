// api/_lib/edge/image-ticket.test.js
// El ticket que abre el recorte de cada intento. Lo que se protege: que nadie
// pueda pedir el recorte del intento N sin haber gastado N-1 intentos, y que el
// ticket de una revisión del día no abra la otra.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  firmarTicketImagen,
  verificarTicketImagen,
  ticketDelIntento,
  zDelIntento,
  Z_MAX,
  Z_LIBRE,
} from "./image-ticket.js";
import { ZOOM_ATTEMPTS } from "../zoom.js";
import { ZOOM_ATTEMPTS as ZOOM_ATTEMPTS_CLIENTE } from "../../../src/lib/zoom.js";

const FECHA = "2026-10-25";
const SELLO = "SNsvTUqwYCDT4K7c";

let secretoAntes;
beforeEach(() => {
  secretoAntes = process.env.REPESCA_TOKEN_SECRET;
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});
afterEach(() => {
  if (secretoAntes === undefined) delete process.env.REPESCA_TOKEN_SECRET;
  else process.env.REPESCA_TOKEN_SECRET = secretoAntes;
});

describe("zDelIntento", () => {
  it("da el recorte siguiente a los intentos gastados, sin pasar del último", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(zDelIntento)).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });
  it("trata lo que no es un entero como cero intentos (el recorte libre)", () => {
    expect(zDelIntento(undefined)).toBe(1);
    expect(zDelIntento(-3)).toBe(1);
    expect(zDelIntento("4")).toBe(1);
  });
  it("Z_MAX es la réplica de ZOOM_ATTEMPTS en servidor y cliente (regla 7)", () => {
    expect(Z_MAX).toBe(ZOOM_ATTEMPTS);
    expect(Z_MAX).toBe(ZOOM_ATTEMPTS_CLIENTE);
  });
});

describe("firmar / verificar", () => {
  it("el recorte libre no lleva ticket", async () => {
    expect(await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: Z_LIBRE })).toBeNull();
  });

  it("un ticket abre SU recorte y ningún otro", async () => {
    const k3 = await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: 3 });
    expect(k3).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await verificarTicketImagen({ fecha: FECHA, sello: SELLO, z: 3, k: k3 })).toBe(true);
    // El ataque obvio: con el ticket del 3, pedir el 5.
    expect(await verificarTicketImagen({ fecha: FECHA, sello: SELLO, z: 5, k: k3 })).toBe(false);
  });

  it("no abre otra revisión del día ni otro día", async () => {
    const k = await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: 4 });
    expect(await verificarTicketImagen({ fecha: FECHA, sello: "otroSelloDistinto", z: 4, k })).toBe(false);
    expect(await verificarTicketImagen({ fecha: "2026-10-26", sello: SELLO, z: 4, k })).toBe(false);
  });

  it("es determinista: misma URL para todos, así el CDN la cachea", async () => {
    const a = await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: 2 });
    const b = await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: 2 });
    expect(a).toBe(b);
  });

  it("rechaza tickets mal formados o inventados", async () => {
    for (const k of [null, "", "abc", "A".repeat(22), "A".repeat(40)]) {
      expect(await verificarTicketImagen({ fecha: FECHA, sello: SELLO, z: 2, k })).toBe(false);
    }
  });

  it("sin secreto no se firma nada (y nada verifica)", async () => {
    delete process.env.REPESCA_TOKEN_SECRET;
    expect(await firmarTicketImagen({ fecha: FECHA, sello: SELLO, z: 2 })).toBeNull();
    expect(await verificarTicketImagen({ fecha: FECHA, sello: SELLO, z: 2, k: "A".repeat(22) })).toBe(false);
  });
});

describe("ticketDelIntento", () => {
  it("con la partida cerrada no hay recorte que pedir", async () => {
    expect(await ticketDelIntento({ fecha: FECHA, sello: SELLO, intentos: 2, jugando: false })).toEqual({
      imgZ: null,
      imgK: null,
    });
  });

  it("al empezar, el recorte libre y sin ticket", async () => {
    expect(await ticketDelIntento({ fecha: FECHA, sello: SELLO, intentos: 0 })).toEqual({
      imgZ: 1,
      imgK: null,
    });
  });

  it("tras dos fallos, el recorte 3 con un ticket que lo abre", async () => {
    const { imgZ, imgK } = await ticketDelIntento({ fecha: FECHA, sello: SELLO, intentos: 2 });
    expect(imgZ).toBe(3);
    expect(await verificarTicketImagen({ fecha: FECHA, sello: SELLO, z: 3, k: imgK })).toBe(true);
  });

  it("si no se puede firmar, no promete un recorte que el servidor no va a dar", async () => {
    expect(await ticketDelIntento({ fecha: FECHA, sello: null, intentos: 3 })).toEqual({
      imgZ: 1,
      imgK: null,
    });
  });
});
