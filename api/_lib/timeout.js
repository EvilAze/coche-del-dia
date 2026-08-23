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
    return valorPorDefecto;
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
  // Lecturas y RPC contra PostgREST: sano son 20-120 ms desde fra1.
  SUPABASE: 5000,
};
