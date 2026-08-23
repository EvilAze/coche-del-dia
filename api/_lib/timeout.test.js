// api/_lib/timeout.test.js
// Tests del plazo compartido. Lo que hay que demostrar no es que un timer
// dispare —eso es trivial— sino las tres propiedades de las que depende el
// resto: que una dependencia ATRANCADA (no una que falla) acabe cortada, que
// el fallback cubra las dos formas de fallar, y que el rechazo tardío de la
// promesa perdedora no salga como unhandled.
import { describe, it, expect, vi } from "vitest";
import {
  conTimeout,
  conTimeoutOFallback,
  conTimeoutReintentando,
  TimeoutError,
  PLAZOS,
} from "./timeout.js";

// Promesa que NO se resuelve nunca: es el caso que el try/catch de antes no
// cubría y el que tumbó la web el 23 de agosto de 2026.
const nuncaResuelve = () => new Promise(() => {});

describe("conTimeout", () => {
  it("deja pasar el valor si llega dentro del plazo", async () => {
    await expect(conTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("una promesa que no resuelve NUNCA acaba rechazando con TimeoutError", async () => {
    const p = conTimeout(nuncaResuelve(), 20, { etiqueta: "upstash" });
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it("el TimeoutError lleva etiqueta y plazo, para poder leer el log", async () => {
    try {
      await conTimeout(nuncaResuelve(), 20, { etiqueta: "pick_daily_car" });
      throw new Error("debería haber vencido");
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.etiqueta).toBe("pick_daily_car");
      expect(err.ms).toBe(20);
      expect(err.message).toContain("pick_daily_car");
    }
  });

  it("propaga el error original si falla ANTES de vencer el plazo", async () => {
    const p = conTimeout(Promise.reject(new Error("boom")), 1000);
    await expect(p).rejects.toThrow("boom");
    // Y no lo disfraza de TimeoutError: 500 y 503 no son la misma respuesta.
    await expect(p).rejects.not.toBeInstanceOf(TimeoutError);
  });

  it("un rechazo TARDÍO de la perdedora no queda sin manejar", async () => {
    // Sin el .catch() de la perdedora, esto sería una unhandled rejection —
    // que en serverless puede llevarse por delante la invocación entera.
    const noHandled = vi.fn();
    process.on?.("unhandledRejection", noHandled);

    let fallar;
    const lenta = new Promise((_, reject) => { fallar = reject; });
    await expect(conTimeout(lenta, 10)).rejects.toBeInstanceOf(TimeoutError);
    fallar(new Error("llegó tarde y encima falló"));
    // Damos margen a que el ciclo de eventos lo habría reportado.
    await new Promise((r) => setTimeout(r, 50));

    expect(noHandled).not.toHaveBeenCalled();
    process.off?.("unhandledRejection", noHandled);
  });

  it("no deja el temporizador vivo cuando gana la promesa", async () => {
    // Si no se limpiara, el handler seguiría despierto hasta vencer el plazo:
    // exactamente la latencia que este helper viene a recortar.
    vi.useFakeTimers();
    try {
      const p = conTimeout(Promise.resolve("rápido"), 60000);
      await expect(p).resolves.toBe("rápido");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("conTimeoutOFallback", () => {
  it("devuelve el valor real si llega a tiempo", async () => {
    expect(await conTimeoutOFallback(Promise.resolve(1), 1000, 0)).toBe(1);
  });

  it("cae al fallback cuando la dependencia se atranca", async () => {
    const r = await conTimeoutOFallback(nuncaResuelve(), 20, { ok: true }, {
      etiqueta: "ratelimit",
    });
    expect(r).toEqual({ ok: true });
  });

  it("cae al fallback también cuando la dependencia FALLA", async () => {
    // Las dos formas de fallar de algo que va por red, cubiertas por el mismo
    // camino: contestar mal y no contestar.
    const r = await conTimeoutOFallback(Promise.reject(new Error("nope")), 1000, "porDefecto");
    expect(r).toBe("porDefecto");
  });
});

describe("PLAZOS", () => {
  it("todos son números positivos y caben en el presupuesto del Edge (25 s)", () => {
    for (const [nombre, ms] of Object.entries(PLAZOS)) {
      expect(ms, nombre).toBeGreaterThan(0);
      expect(ms, nombre).toBeLessThan(25000);
    }
  });

  it("el del limiter es el más corto: va antes que nada en get-daily-car", () => {
    expect(PLAZOS.RATELIMIT).toBeLessThan(PLAZOS.AUTH);
    expect(PLAZOS.RATELIMIT).toBeLessThan(PLAZOS.SUPABASE);
  });

  it("el peor caso encadenado de get-daily-car cabe en los 25 s del Edge", () => {
    // Este test es el que impide que un plazo suba «solo un poco» y la
    // función acabe muriendo por presupuesto — devolviendo justo el 504 con
    // cuerpo HTML que todo esto viene a eliminar.
    //
    // La cadena real, con los reintentos incluidos:
    //   limiter  →  (auth ∥ pick_daily_car)  →  user_guesses  →  reveal
    // auth y pick_daily_car van en paralelo (Promise.all), así que cuenta el
    // mayor de los dos. Los que llevan DOS intentos pagan el plazo dos veces.
    const DOS_INTENTOS = 2;
    const auth = PLAZOS.AUTH * DOS_INTENTOS;
    const rpc = PLAZOS.SUPABASE * DOS_INTENTOS;
    const guesses = PLAZOS.SUPABASE * DOS_INTENTOS;
    const reveal = PLAZOS.SUPABASE;

    const peorCaso = PLAZOS.RATELIMIT + Math.max(auth, rpc) + guesses + reveal;
    // Margen de sobra por debajo del límite duro de la Edge Function.
    expect(peorCaso).toBeLessThan(25000);
  });
});

describe("conTimeoutReintentando", () => {
  it("devuelve a la primera si la dependencia responde", async () => {
    const fabricar = vi.fn(async () => "ok");
    expect(await conTimeoutReintentando(fabricar, 1000, "porDefecto")).toBe("ok");
    expect(fabricar).toHaveBeenCalledTimes(1);
  });

  it("PIDE UNA PROMESA NUEVA en cada intento", async () => {
    // Por esto recibe una fábrica y no una promesa: una promesa ya rechazada
    // se queda rechazada, así que reintentar sobre ella no reintenta nada.
    const fabricar = vi
      .fn()
      .mockImplementationOnce(nuncaResuelve)
      .mockImplementationOnce(async () => "a la segunda");
    const r = await conTimeoutReintentando(fabricar, 20, "porDefecto", {
      etiqueta: "pick_daily_car",
    });
    expect(r).toBe("a la segunda");
    expect(fabricar).toHaveBeenCalledTimes(2);
  });

  it("agotados los intentos, cae al valor por defecto", async () => {
    const fabricar = vi.fn(nuncaResuelve);
    const r = await conTimeoutReintentando(fabricar, 20, { data: null, error: { message: "x" } });
    expect(r.error.message).toBe("x");
    expect(fabricar).toHaveBeenCalledTimes(2);
  });

  it("un error (no un plazo) también se reintenta", async () => {
    // Una conexión cortada es tan transitoria como una lenta.
    const fabricar = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce("recuperado");
    expect(await conTimeoutReintentando(fabricar, 1000, "porDefecto")).toBe("recuperado");
  });
});
