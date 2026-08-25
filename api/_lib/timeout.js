// api/_lib/timeout.js
// Plazo máximo para un `await` contra una dependencia externa (Supabase,
// Upstash, la API de IA). Edge-safe: solo Promise y setTimeout, sin nada de
// Node, para poder usarse igual desde get-daily-car (Edge) que desde los
// handlers admin (serverless).
//
// POR QUÉ EXISTE. Hasta ahora el único sitio del repo con plazo era
// `checkDbHealth`; todo lo demás esperaba indefinidamente. Eso convierte un
// atranco de la dependencia —no una caída, un atranco— en el peor resultado
// posible: la función agota su presupuesto entero (25 s en Edge, 60 s en
// serverless), Vercel la mata y contesta un 504 con cuerpo HTML. El cliente
// hace `res.json()` sobre ese HTML y lo que queda registrado es un
// «SyntaxError: Unexpected token 'A'», que no se parece en nada a la causa.
// Con plazo, el mismo atranco se resuelve en segundos y con un JSON legible.
//
// El 23 de agosto de 2026 esto tumbó la web y el panel a la vez durante ocho
// minutos: 25 timeouts de 60 s en /api/admin/* y 4 de 25 s en get-daily-car,
// mientras Supabase seguía contestando a las lecturas ligeras. La firma no era
// nueva —«[health] timeout consultando Supabase» llevaba saltando 11 veces en
// una semana— pero nadie la relacionaba porque el síntoma visible era el
// SyntaxError.

/**
 * Error con el que rechaza `conTimeout` al vencer el plazo. Clase propia para
 * poder distinguir «la dependencia tardó» de «la dependencia falló»: lo
 * primero merece 503 (vuelve a intentarlo), lo segundo normalmente 500.
 */
export class TimeoutError extends Error {
  constructor(etiqueta, ms) {
    super(`${etiqueta} superó el plazo de ${ms} ms`);
    this.name = "TimeoutError";
    this.etiqueta = etiqueta;
    this.ms = ms;
  }
}

// Marca con la que un fallback dice «esto NO es la respuesta de la dependencia,
// es lo que devuelvo porque venció el plazo».
//
// POR QUÉ HACE FALTA. `conTimeoutOFallback` y `conTimeoutReintentando` aplanan
// las dos formas de fallar en un mismo valor por defecto, y el que llama pierde
// la única distinción que a veces importa: «me ha contestado que no» (rápido,
// definitivo) frente a «no me ha contestado» (lento, y probablemente tampoco
// conteste al siguiente). Quien tenga un plan B en serie necesita saberlo,
// porque un plan B detrás de una espera agotada SUMA su plazo al presupuesto de
// la función — que es exactamente el 504 que este módulo existe para evitar.
//
// Symbol y no-enumerable a propósito: el valor por defecto suele ser un objeto
// con forma de PostgREST ({data, error}) que acaba en logs y respuestas. La
// marca es para el código, no para el cable.
const POR_PLAZO = Symbol("porPlazo");

function marcarPorPlazo(valor) {
  if (valor && typeof valor === "object") {
    Object.defineProperty(valor, POR_PLAZO, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }
  return valor;
}

/**
 * ¿Este valor es el fallback que devolvió un helper porque venció el plazo?
 * `false` para todo lo demás — incluido el fallback devuelto tras un error
 * normal, que es justo la diferencia que hay que poder ver.
 *
 * @param {unknown} valor
 * @returns {boolean}
 */
export function fuePorPlazo(valor) {
  return Boolean(valor && typeof valor === "object" && valor[POR_PLAZO] === true);
}

/**
 * Corre `promesa` con un plazo. Si vence, RECHAZA con TimeoutError.
 *
 * Dos detalles que no son adorno:
 *   - `clearTimeout` en el finally: sin él, el temporizador sigue vivo y
 *     mantiene despierto al handler hasta que vence, que es justo la latencia
 *     que veníamos a recortar (el mismo motivo por el que lo hace
 *     `checkDbHealth`).
 *   - `.catch(() => {})` sobre la promesa perdedora: si la dependencia acaba
 *     fallando DESPUÉS de que hayamos contestado por plazo, ese rechazo ya no
 *     lo espera nadie y saldría como unhandled rejection, que en serverless
 *     puede tumbar la invocación entera.
 *
 * @template T
 * @param {Promise<T>} promesa
 * @param {number} ms
 * @param {{ etiqueta?: string }} [opts]
 * @returns {Promise<T>}
 */
export function conTimeout(promesa, ms, { etiqueta = "operación" } = {}) {
  let timer;
  const plazo = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(etiqueta, ms)), ms);
  });
  return Promise.race([promesa, plazo]).finally(() => {
    clearTimeout(timer);
    // La promesa original sigue viva aunque hayamos perdido interés.
    Promise.resolve(promesa).catch(() => {});
  });
}

/**
 * Variante que NO rompe: al vencer el plazo (o al fallar la promesa) resuelve
 * con `valorPorDefecto`. Es la forma correcta de escribir un fail-open — el
 * que promete `checkRateLimit`— porque cubre las dos maneras de fallar que
 * tiene una dependencia por red: contestar mal y no contestar.
 *
 * @template T
 * @param {Promise<T>} promesa
 * @param {number} ms
 * @param {T} valorPorDefecto
 * @param {{ etiqueta?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function conTimeoutOFallback(
  promesa,
  ms,
  valorPorDefecto,
  { etiqueta = "operación" } = {}
) {
  try {
    return await conTimeout(promesa, ms, { etiqueta });
  } catch (err) {
    console.error(`[timeout] ${etiqueta}, se sigue sin ello:`, err?.message || err);
    // Solo se marca el fallback del PLAZO: un error normal ya llega dentro del
    // propio valor por defecto y no obliga a nadie a replantearse su plan B.
    return err instanceof TimeoutError
      ? marcarPorPlazo(valorPorDefecto)
      : valorPorDefecto;
  }
}

/**
 * Como `conTimeoutOFallback` pero REINTENTANDO. Recibe una FÁBRICA y no una
 * promesa, porque una promesa ya lanzada no se puede volver a esperar: hay que
 * pedirle una nueva a cada intento.
 *
 * Para qué: sin reintento, un plazo convierte en error toda petición que
 * tarde más de la cuenta —incluidas las que iban a llegar—. Y ahí la
 * comparación importante no es con el ideal, es con lo que pasaba ANTES de
 * haber plazos: antes una lectura de 7 s acababa sirviendo la partida, tarde
 * pero entera. Con un plazo pelado de 5 s pasaría a ser una pantalla de error,
 * y eso es empeorarle la experiencia a quien no la tenía rota. Con dos
 * intentos, el caso lento se resuelve solo y el caso atrancado sigue cortando.
 *
 * @template T
 * @param {() => Promise<T>} fabricar
 * @param {number} ms plazo de CADA intento
 * @param {T} valorPorDefecto si se agotan los intentos
 * @param {{ etiqueta?: string, intentos?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function conTimeoutReintentando(
  fabricar,
  ms,
  valorPorDefecto,
  { etiqueta = "operación", intentos = 2 } = {}
) {
  for (let i = 1; i <= intentos; i++) {
    try {
      return await conTimeout(fabricar(), ms, { etiqueta });
    } catch (err) {
      console.error(
        `[timeout] ${etiqueta} falló (intento ${i}/${intentos}):`,
        err?.message || err
      );
      // Manda cómo falló el ÚLTIMO intento: es el que describe en qué estado
      // se ha quedado la dependencia ahora mismo.
      if (i === intentos) {
        return err instanceof TimeoutError
          ? marcarPorPlazo(valorPorDefecto)
          : valorPorDefecto;
      }
    }
  }
}

// Plazos por dependencia. Centralizados aquí para que se lean juntos y se vea
// el criterio: cada uno es varias veces el p99 sano de esa dependencia, no un
// número apretado. El objetivo NO es cortar peticiones lentas, es no llegar
// nunca al presupuesto de la función.
export const PLAZOS = {
  // Upstash por REST desde el Edge: sano son 20-40 ms. Está en la PRIMERA
  // línea de get-daily-car, antes de tocar Supabase, así que es el corte que
  // más barato sale y el que más daño evita.
  RATELIMIT: 1500,
  // auth.getUser() contra GoTrue: sano son 60-150 ms.
  //
  // Empezó en 4000 y era DEMASIADO CORTO, y eso fue un error de esta misma
  // entrega: GoTrue no falla, tartamudea —a las 17:00:43 contestó y a las
  // 17:03:37 no—, así que un plazo apretado convierte en error una petición
  // que iba a llegar. 5 s por intento y dos intentos (ver pedirUsuario) dan
  // 10 s de margen real, que sigue estando muy por debajo de los 25 s del
  // Edge y no depende de acertar el número a la primera.
  AUTH: 5000,
  // Lecturas y RPC contra PostgREST: sano son 20-120 ms desde fra1. 4 s es ~33
  // veces ese p99, y las lecturas que sostienen la partida van con DOS
  // intentos (conTimeoutReintentando), o sea 8 s de margen real.
  //
  // Baja de 5000 a 4000 justo por eso: al añadir el reintento, el peor caso
  // encadenado de get-daily-car —limiter + (auth ∥ pick_daily_car) +
  // user_guesses + reveal— se salía de los 25 s de la Edge Function, y
  // pasarse de ahí devuelve el 504 con HTML que veníamos a eliminar. El test
  // de PLAZOS vigila esa suma.
  SUPABASE: 4000,
};
