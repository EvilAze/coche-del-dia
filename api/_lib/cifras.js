// api/_lib/cifras.js
// LAS CIFRAS DE LA FICHA TÉCNICA: potencia, par, 0-100 y velocidad máxima.
//
// Son cuatro columnas de `cars` (scripts/2026-10-ficha-tecnica-cifras.sql) y
// este módulo es su ÚNICA definición en el servidor: de aquí salen el trozo de
// SELECT de los endpoints del revelado, la forma en que viajan al jugador y la
// validación del panel interno. Así una quinta cifra es una línea en `CIFRAS`
// y su columna en el SQL, no seis ficheros que se desincronizan.
//
// REGLA 5: SON LA FICHA, Y LA FICHA ES DE QUIEN GANA. Las columnas no tienen
// GRANT para el cliente (el porqué, en la cabecera del SQL) y solo salen del
// servidor dentro del `reveal` de una partida GANADA, con la misma condición
// que `description`. `cifrasDelRevelado` lleva esa condición dentro para que
// ningún endpoint tenga que acordarse de ponerla.
//
// Pura y sin dependencias: la importan get-daily-car (Edge) y validate-guess
// (Node) por igual.

// Los rangos son los MISMOS que los CHECK de la migración. Están para cazar el
// error de tecleo (un cero de más, kW en el campo de los CV), no para juzgar al
// coche: caben un Ford T y un hiperdeportivo eléctrico. La BD es la última
// palabra; esto es para que el panel diga un error legible en vez de un
// «violates check constraint».
//
// `clave` es el nombre con el que viaja al cliente (camelCase, como el resto
// del `reveal`), y `decimales` cuántos admite: el 0-100 se publica con uno
// («3,9 s») y el resto son enteros.
export const CIFRAS = [
  { col: "potencia_cv", clave: "potenciaCv", etiqueta: "Potencia (CV)", min: 1, max: 3000, decimales: 0 },
  { col: "par_nm", clave: "parNm", etiqueta: "Par (Nm)", min: 1, max: 5000, decimales: 0 },
  { col: "aceleracion_0_100", clave: "aceleracion", etiqueta: "0-100 km/h (s)", min: 1, max: 99.9, decimales: 1 },
  { col: "vmax_kmh", clave: "vmaxKmh", etiqueta: "Velocidad máxima (km/h)", min: 10, max: 600, decimales: 0 },
];

// El trozo de SELECT que añaden los endpoints que construyen el `reveal`.
export const CIFRAS_SELECT = CIFRAS.map((c) => c.col).join(", ");

function redondear(n, decimales) {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// Lo que se lee de la BD, saneado. PostgREST manda `numeric` como número JSON;
// se acepta también texto numérico por defensa, porque cuesta una línea y un
// «3.9» que llegara entre comillas no debe convertirse en un hueco. Todo lo
// demás —null, NaN, fuera de rango— es «no hay cifra».
function leerCifra(def, valor) {
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < def.min || n > def.max) return null;
  return redondear(n, def.decimales);
}

/**
 * Las cifras de una fila de `cars`, con SOLO las que existen.
 *
 * @param {object|null} row  fila con las columnas de CIFRAS_SELECT
 * @returns {object|null}  p.ej. { potenciaCv: 510, aceleracion: 3.9 }, o null
 *   si no hay ninguna. Null y no `{}`: el cliente pregunta «¿hay ficha?» y un
 *   objeto vacío diría que sí.
 */
export function cifrasDeFila(row) {
  if (!row) return null;
  const out = {};
  for (const def of CIFRAS) {
    const v = leerCifra(def, row[def.col]);
    if (v !== null) out[def.clave] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Las cifras tal como viajan en el `reveal`: solo si la partida está GANADA.
 * Perdiendo se revela la identidad del coche (para que el jugador sepa qué
 * falló), pero la ficha —texto y cifras— es la recompensa de acertar.
 *
 * @param {object|null} row
 * @param {boolean} ganada
 */
export function cifrasDelRevelado(row, ganada) {
  return ganada === true ? cifrasDeFila(row) : null;
}

/**
 * Una cifra tal como la manda el panel interno.
 *
 * Acepta número o texto, porque el campo del panel es texto (con `inputMode`
 * numérico): quien rellena está copiando de una ficha de fabricante y escribe
 * «3,9». Pero en los ENTEROS no admite ni coma ni punto: «1.500» es 1500 CV
 * para quien lo escribe en español y 1,5 para Number(), y redondeado a 2 CV
 * pasaría el rango sin que nadie se enterara. Mejor un error que lo diga.
 *
 * @returns {{ value: number|null, error: string|null }}
 *   - `value: null` sin error → la columna se BORRA (cadena vacía = «quítala»).
 *   - `error` → no se toca nada y el handler responde 400.
 */
export function parseCifra(def, entrada) {
  if (entrada === null || entrada === undefined) return { value: null, error: null };

  let n;
  if (typeof entrada === "number") {
    n = entrada;
  } else if (typeof entrada === "string") {
    const limpio = entrada.trim();
    if (limpio === "") return { value: null, error: null };
    const forma = def.decimales > 0 ? /^\d+(?:[.,]\d+)?$/ : /^\d+$/;
    if (!forma.test(limpio)) {
      return {
        value: null,
        error:
          def.decimales > 0
            ? `${def.etiqueta}: escribe solo el número, p.ej. 3,9`
            : `${def.etiqueta}: escribe solo el número entero, sin puntos ni comas`,
      };
    }
    n = Number(limpio.replace(",", "."));
  } else {
    return { value: null, error: `${def.etiqueta}: debe ser un número` };
  }

  if (!Number.isFinite(n)) return { value: null, error: `${def.etiqueta}: debe ser un número` };
  const v = redondear(n, def.decimales);
  if (v < def.min || v > def.max) {
    return { value: null, error: `${def.etiqueta} fuera de rango [${def.min}, ${def.max}]` };
  }
  return { value: v, error: null };
}

/**
 * Las cifras que vengan en el body del panel, listas para el patch de `cars`.
 * Mismo criterio que `video_id`: solo se tocan las columnas PRESENTES (`in
 * body`), y la cadena vacía sí se escribe —como null— porque es la única forma
 * de quitarle a un coche una cifra que se metió mal.
 *
 * @returns {{ patch: object, error: string|null }}
 */
export function cifrasDelBody(body) {
  const patch = {};
  if (!body || typeof body !== "object") return { patch, error: null };
  for (const def of CIFRAS) {
    if (!(def.col in body)) continue;
    const { value, error } = parseCifra(def, body[def.col]);
    if (error) return { patch: {}, error };
    patch[def.col] = value;
  }
  return { patch, error: null };
}
