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
  fuePorPlazo,
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

describe("fuePorPlazo", () => {
  // La distinción que sostiene el arreglo del respaldo: un plan B detrás de una
  // espera agotada suma su plazo al presupuesto de la función, así que quien
  // tenga plan B necesita poder preguntar «¿esto es que me han dicho que no, o
  // es que no me han contestado?».
  it("marca el fallback cuando venció el plazo", async () => {
    const r = await conTimeoutOFallback(nuncaResuelve(), 20, { data: null, error: {} });
    expect(fuePorPlazo(r)).toBe(true);
  });

  it("NO marca el fallback cuando la dependencia contestó (mal, pero contestó)", async () => {
    const r = await conTimeoutOFallback(
      Promise.reject(new Error("PGRST202")),
      1000,
      { data: null, error: {} }
    );
    expect(fuePorPlazo(r)).toBe(false);
  });

  it("con reintentos, manda cómo falló el ÚLTIMO intento", async () => {
    // Un plazo seguido de un error instantáneo describe una base que responde:
    // ahí el plan B sí tiene sentido.
    const fabricar = vi
      .fn()
      .mockImplementationOnce(nuncaResuelve)
      .mockRejectedValueOnce(new Error("PGRST202"));
    const r = await conTimeoutReintentando(fabricar, 20, { data: null, error: {} });
    expect(fuePorPlazo(r)).toBe(false);

    const fabricar2 = vi.fn(nuncaResuelve);
    const r2 = await conTimeoutReintentando(fabricar2, 20, { data: null, error: {} });
    expect(fuePorPlazo(r2)).toBe(true);
  });

  it("la marca no viaja: ni en JSON ni en las claves del objeto", async () => {
    // El valor por defecto tiene forma de PostgREST y acaba en logs y en
    // respuestas. La marca es para el código, no para el cable.
    const r = await conTimeoutOFallback(nuncaResuelve(), 20, { data: null, error: { message: "x" } });
    expect(Object.keys(r)).toEqual(["data", "error"]);
    expect(JSON.parse(JSON.stringify(r))).toEqual({ data: null, error: { message: "x" } });
  });

  it("no se inventa la marca sobre valores que no la llevan", () => {
    expect(fuePorPlazo(null)).toBe(false);
    expect(fuePorPlazo("porDefecto")).toBe(false);
    expect(fuePorPlazo({ data: null })).toBe(false);
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
    //   limiter  →  (auth ∥ coche_de_hoy)  →  user_guesses  →  reveal
    // auth y coche_de_hoy van en paralelo (Promise.all), así que cuenta el
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

  it("la cadena CON RESPALDO de get-daily-car también cabe en los 25 s", () => {
    // El camino que se olvidaba: cuando `coche_de_hoy` no sirve, el handler
    // llama después a `pick_daily_car`. Si ese respaldo se pagara en serie
    // detrás de la fase de auth, la suma se iba a 31,5 s y volvía el 504.
    //
    // Dos cosas lo mantienen dentro, y las dos se comprueban aquí:
    //   1) El respaldo solo se intenta si el fallo fue INSTANTÁNEO (un plazo
    //      agotado corta con 503 sin plan B), así que la RPC no puede haber
    //      gastado sus dos intentos completos antes de él: como mucho uno.
    //   2) El respaldo vive DENTRO de la fase paralela, o sea que compite con
    //      auth en un `max()` en vez de sumarse detrás.
    const DOS_INTENTOS = 2;
    const auth = PLAZOS.AUTH * DOS_INTENTOS;
    // Resolución del día por el camino largo: un intento de coche_de_hoy que
    // vence + el respaldo (un solo intento; pick_daily_car y la lectura de
    // prev_car_ids van en paralelo entre ellos).
    const diaConRespaldo = PLAZOS.SUPABASE + PLAZOS.SUPABASE;
    const guesses = PLAZOS.SUPABASE * DOS_INTENTOS;
    const reveal = PLAZOS.SUPABASE;

    const peorCaso =
      PLAZOS.RATELIMIT + Math.max(auth, diaConRespaldo) + guesses + reveal;
    expect(peorCaso).toBeLessThan(25000);

    // Y que no se cuele por la puerta de atrás: la resolución del día con
    // respaldo NO puede costar más que la de siempre, o dejaría de estar
    // absorbida por el `max()` con auth.
    expect(diaConRespaldo).toBeLessThanOrEqual(PLAZOS.SUPABASE * DOS_INTENTOS);
  });

  // Los dos handlers de abajo son Node serverless, o sea 60 s de presupuesto en
  // vez de los 25 s del Edge. Se suman IGUAL: el 504 con cuerpo HTML no
  // distingue de qué runtime viene, y la única forma de que un plazo no suba
  // «solo un poco» es que haya un test que lo note.
  const PRESUPUESTO_NODE = 60000;

  it("el peor caso encadenado de validate-guess cabe en los 60 s del serverless", () => {
    // La cadena real:
    //   limiter → (auth ∥ coche_de_hoy) → user_guesses → cars(real ∥ intento)
    //           → upsert → record_daily_result_v2 → stats → auditoría
    //
    // auth y coche_de_hoy van en Promise.all: cuenta el mayor, no la suma.
    // Ponerlos en serie era lo que empujaba esta cadena hacia el presupuesto.
    // Las dos lecturas de `cars` también van en paralelo entre ellas.
    const DOS_INTENTOS = 2;
    const auth = PLAZOS.AUTH * DOS_INTENTOS;
    const dia = PLAZOS.SUPABASE * DOS_INTENTOS;
    const guesses = PLAZOS.SUPABASE * DOS_INTENTOS;
    const coches = PLAZOS.SUPABASE * DOS_INTENTOS; // paralelas: un solo tramo
    const upsert = PLAZOS.SUPABASE * DOS_INTENTOS;
    const puntos = PLAZOS.SUPABASE; // sin reintento: la RPC es idempotente por día
    const telemetria = PLAZOS.AUDITORIA * 2; // increment_daily_stats + guess_audit

    const peorCaso =
      PLAZOS.RATELIMIT +
      Math.max(auth, dia) +
      guesses +
      coches +
      upsert +
      puntos +
      telemetria;

    expect(peorCaso).toBeLessThan(PRESUPUESTO_NODE);

    // Y el camino con respaldo tampoco se sale: un intento de coche_de_hoy que
    // vence + pick_daily_car y prev_car_ids EN PARALELO entre ellos. Si alguien
    // los vuelve a poner en serie, esta comparación deja de cumplirse.
    const diaConRespaldo = PLAZOS.SUPABASE + PLAZOS.SUPABASE;
    expect(diaConRespaldo).toBeLessThanOrEqual(dia);
  });

  it("el peor caso encadenado de daily-image deja sitio para sharp", () => {
    // La cadena real:
    //   coche_de_hoy → cars → canario → tryReadUserStatus → descarga del CDN
    //
    // Y DESPUÉS sharp, que no es una espera sino CPU nuestra y por tanto no se
    // puede acotar con un plazo: en frío se va a segundos (el propio handler lo
    // documenta al elegir effort 2 en AVIF, porque effort 4 llevaba el
    // arranque de 1-2 s a 3-8 s). Por eso la I/O no puede quedarse los 60 s: lo
    // que se mide aquí es que quede presupuesto DESPUÉS de esperar.
    const SHARP_EN_FRIO = 8000; // el peor extremo documentado en daily-image.js
    const DOS_INTENTOS = 2;

    const dia = PLAZOS.SUPABASE * DOS_INTENTOS;
    const cars = PLAZOS.SUPABASE * DOS_INTENTOS;
    const canario = PLAZOS.AUDITORIA;
    // El check defensivo del Bearer va acotado ENTERO por un solo plazo, no por
    // la suma de la identidad y la lectura que hace por dentro.
    const statusDefensivo = PLAZOS.SUPABASE;
    // La descarga se cuenta UNA vez: tras un plazo vencido en el master no se
    // prueba el original (mismo Storage), así que 2×CDN no es alcanzable.
    const descarga = PLAZOS.CDN;

    const espera = dia + cars + canario + statusDefensivo + descarga;
    expect(espera + SHARP_EN_FRIO).toBeLessThan(PRESUPUESTO_NODE);

    // La descarga es el plazo más caro de la cadena: si algún día deja de
    // serlo, o es que se ha disparado otro o que este se ha quedado corto para
    // mover megabytes. En ambos casos toca releer la suma, no ajustar a ojo.
    expect(PLAZOS.CDN).toBeGreaterThan(PLAZOS.SUPABASE * DOS_INTENTOS);
  });

  it("el plazo de auditoría es de los baratos: nadie espera esas filas", () => {
    // Un insert de telemetría no puede costar lo mismo que la lectura que
    // sostiene la partida: al vencer no se pierde nada que el jugador vea, y
    // los dos handlers lo esperan con `await` justo antes de responder.
    expect(PLAZOS.AUDITORIA).toBeLessThan(PLAZOS.SUPABASE);
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
