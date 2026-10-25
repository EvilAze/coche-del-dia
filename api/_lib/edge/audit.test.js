// api/_lib/edge/audit.test.js
// logSessionStart registra la primera visita del día para poder medir el
// time-to-win del panel de auditoría. Perdía el insert casi siempre cuando la
// visita era la de una partida EMPEZANDO: la función Edge devolvía la Response
// y el insert, lanzado sin waitUntil, se quedaba sin runtime que lo sostuviera.
// Lo que se protege aquí es que el trabajo SE ENTREGA a context.waitUntil, que
// es lo único que un test puede ver de eso (que Vercel respete el contrato se
// comprueba en producción: ver la consulta de control en el PR).

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn(() => Promise.resolve({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("../supabase.js", () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { logSessionStart } from "./audit.js";

function peticion() {
  return new Request("https://ejemplo.test/api/get-daily-car", {
    headers: {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "ua-de-test",
      "accept-language": "es-ES",
    },
  });
}

// Cada caso usa su propia fecha: el dedupe vive en memoria del módulo y se
// arrastra entre tests, así que reutilizar (fecha, usuario) los acoplaría.
let dia = 0;
function args(extra = {}) {
  dia += 1;
  return {
    request: peticion(),
    userId: "usuario-1",
    isAnon: false,
    gameDate: `2026-10-${String(dia).padStart(2, "0")}`,
    carId: "coche-1",
    ...extra,
  };
}

beforeEach(() => {
  insertMock.mockClear();
  fromMock.mockClear();
});

describe("logSessionStart + waitUntil", () => {
  it("entrega a waitUntil el trabajo AÚN PENDIENTE, no uno ya terminado", async () => {
    const waitUntil = vi.fn();
    const trabajo = logSessionStart(args({ context: { waitUntil } }));

    // Síncrono: waitUntil ya tiene la promesa y el insert todavía no ha
    // ocurrido (va detrás del HMAC). Si el trabajo se entregara después de
    // esperarlo, waitUntil no estaría sosteniendo nada.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBe(trabajo);
    expect(insertMock).not.toHaveBeenCalled();

    await trabajo;
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("escribe una fila session_start con el usuario y el día", async () => {
    const a = args({ userId: "usuario-fila" });
    await logSessionStart({ ...a, context: { waitUntil: () => {} } });
    expect(fromMock).toHaveBeenCalledWith("guess_audit");
    const fila = insertMock.mock.calls[0][0];
    expect(fila).toMatchObject({
      mode: "session_start",
      game_date: a.gameDate,
      car_id: "coche-1",
      user_id: "usuario-fila",
      is_anon: false,
      attempt_number: 0,
      win: false,
    });
  });

  it("sin context (vercel dev, tests) sigue funcionando", async () => {
    await logSessionStart(args());
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("un context sin waitUntil no rompe nada", async () => {
    await logSessionStart(args({ context: {} }));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("el dedupe sigue valiendo: la misma visita del día no inserta dos veces", async () => {
    const a = args({ userId: "usuario-dedupe" });
    await logSessionStart(a);
    await logSessionStart({ ...a, request: peticion() });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("no rechaza nunca, aunque el insert falle: waitUntil no debe ver una promesa rota", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    insertMock.mockImplementationOnce(() => Promise.reject(new Error("supabase caído")));
    await expect(
      logSessionStart(args({ userId: "usuario-fallo", context: { waitUntil: () => {} } }))
    ).resolves.toBeUndefined();
    silencio.mockRestore();
  });
});
