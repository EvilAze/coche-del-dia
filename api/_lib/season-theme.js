// api/_lib/season-theme.js
// Normalización y validación del FILTRO TEMÁTICO de una temporada
// (`seasons.theme_filter`). Hasta ahora «Temporadas Temáticas» era solo una
// etiqueta: el banner decía «Grupo B» pero pick_daily_car sorteaba entre todo
// el catálogo, así que la temática solo se cumplía si el admin cuadraba los
// coches a mano en el Calendario. Este filtro es lo que convierte la promesa
// en mecánica: el sorteo del día se restringe al pool que casa con él.
//
// FORMA del filtro (AND entre claves, OR dentro de cada lista):
//
//   {
//     tags:      ["grupo-b"],            // contra cars.tags (curado a mano)
//     pais:      ["Italia", "Francia"],  // contra cars.pais
//     make:      ["Ferrari"],            // contra cars.make
//     year_from: 1980,                   // cars.year >= 1980
//     year_to:   1989                    // cars.year <= 1989
//   }
//
// `null` (o un objeto que queda vacío tras limpiar) = temporada SIN temática:
// pick_daily_car se comporta exactamente como antes. Es el default y el modo
// seguro — una temporada mal montada nunca debe romper el juego diario.
//
// Por qué existen a la vez `tags` y los criterios declarativos: temas como
// «Coches alemanes» o «Los 80» salen gratis de datos que ya tenemos, sin tocar
// un solo coche. Pero «Grupo B» —el ejemplo que el propio panel usa como
// placeholder— no se deduce de marca/país/año: eso hay que curarlo, y para eso
// están las etiquetas.
//
// Este módulo es la ÚNICA autoridad de validación (lo llama el handler admin
// antes de escribir). El panel solo pinta; no replica estas reglas, para no
// crear otro par de ficheros que haya que mantener en sync.

// Claves de lista (varios valores en OR). El orden importa para los mensajes.
export const THEME_LIST_KEYS = ["tags", "pais", "make"];
// Claves de rango de año.
export const THEME_RANGE_KEYS = ["year_from", "year_to"];
export const THEME_KEYS = [...THEME_LIST_KEYS, ...THEME_RANGE_KEYS];

// Tope de valores por lista. No es una restricción de producto: es un límite
// de cordura para que un body malformado no acabe en un jsonb enorme que
// car_matches_theme tenga que recorrer en cada sorteo.
export const MAX_LIST_VALUES = 40;

// Rango de años aceptable. 1885 = Benz Patent-Motorwagen (no hay coche
// anterior que catalogar). El techo es una constante fija a propósito y no
// `añoActual + n`: un límite que cambia con el reloj haría que el mismo
// filtro validara hoy y fallara mañana, y que los tests dependieran de la
// fecha en que se ejecutan.
export const MIN_YEAR = 1885;
export const MAX_YEAR = 2100;

// Convierte una etiqueta a slug canónico: minúsculas y espacios internos a
// guiones. Es la pieza que evita el peor fallo silencioso de esta feature —
// etiquetar un coche como "Grupo B" y filtrar por "grupo-b" (o al revés) daría
// cero coincidencias sin ningún error visible. Pasando AMBOS lados por aquí,
// las dos formas convergen al mismo slug.
//
// Los acentos se conservan ("años-80" es una etiqueta válida). El regex es
// ASCII puro a propósito (regla 14 de CLAUDE.md: nada de rangos no-ASCII en
// clases de caracteres).
function slugifyTag(value) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

// Normaliza una lista de strings: recorta, descarta vacíos y deduplica
// SIN distinguir mayúsculas (el match en SQL también es case-insensitive, así
// que "Italia" e "italia" son el mismo valor y guardarlos dos veces solo
// ensucia el jsonb). `lower` aplica además slugifyTag: lo usamos en `tags`,
// que son slugs internos; en `pais`/`make` preservamos el original porque son
// valores de display que el admin reconoce en la lista.
function normalizeList(raw, { lower }) {
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const value = lower ? slugifyTag(trimmed) : trimmed;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Normaliza las etiquetas de UN COCHE (`cars.tags`), con las mismas reglas de
 * slug que las etiquetas del filtro — misma función, para que un tema no falle
 * por una diferencia de forma entre los dos lados.
 *
 * Diferencia con el filtro: aquí una lista vacía SÍ es significativa (`[]` =
 * "quítale todas las etiquetas"), mientras que en el filtro una lista vacía
 * significa "sin restricción por esta clave" y por eso se omite.
 *
 * @param {*} raw Array de strings, o null/undefined para "no tocar".
 * @returns {{ value: string[]|null, error: string|null }} `value` null = el
 *   caller no debe incluir la columna en el patch.
 */
export function normalizeCarTags(raw) {
  if (raw === undefined || raw === null) return { value: null, error: null };
  if (!Array.isArray(raw)) {
    return { value: null, error: "Las etiquetas deben ser una lista de textos." };
  }
  if (raw.length > MAX_LIST_VALUES) {
    return {
      value: null,
      error: `Máximo ${MAX_LIST_VALUES} etiquetas por coche.`,
    };
  }
  const list = normalizeList(raw, { lower: true });
  if (list === null) {
    return { value: null, error: "Las etiquetas deben ser una lista de textos." };
  }
  return { value: list, error: null };
}

// Parsea un año del filtro. Devuelve undefined si el valor es inválido — el
// caller lo traduce a error. Acepta number o string numérica porque el panel
// manda lo que hay en un <input type="number">, que es string.
function parseYear(value) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return undefined;
  if (n < MIN_YEAR || n > MAX_YEAR) return undefined;
  return n;
}

/**
 * Valida y normaliza un filtro temático.
 *
 * @param {*} input Objeto del body, o null/undefined para "sin temática".
 * @returns {{ value: object|null, error: string|null }} `value` es el jsonb
 *   listo para guardar (null = sin temática). Si `error` no es null, NO se
 *   debe escribir nada: el mensaje va tal cual al admin (en español, como el
 *   resto de validaciones del handler de temporadas).
 */
export function normalizeThemeFilter(input) {
  // Ausente o null = quitar la temática. Es un estado legítimo y frecuente
  // (temporadas "abiertas", con tema narrativo pero sin restricción de pool).
  if (input === undefined || input === null || input === "") {
    return { value: null, error: null };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { value: null, error: "El filtro de temática debe ser un objeto." };
  }

  // Una clave desconocida NO se ignora en silencio: un `tag` en singular por
  // error dejaría el filtro vacío y la temporada sortearía entre TODO el
  // catálogo — justo el fallo silencioso que esta feature viene a arreglar.
  const unknown = Object.keys(input).filter((k) => !THEME_KEYS.includes(k));
  if (unknown.length > 0) {
    return {
      value: null,
      error: `Claves no reconocidas en el filtro: ${unknown.join(", ")}. Válidas: ${THEME_KEYS.join(", ")}.`,
    };
  }

  const out = {};

  for (const key of THEME_LIST_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      return { value: null, error: `"${key}" debe ser una lista de textos.` };
    }
    if (raw.length > MAX_LIST_VALUES) {
      return {
        value: null,
        error: `"${key}" admite como mucho ${MAX_LIST_VALUES} valores.`,
      };
    }
    const list = normalizeList(raw, { lower: key === "tags" });
    if (list === null) {
      return { value: null, error: `"${key}" debe ser una lista de textos.` };
    }
    // Lista que queda vacía tras limpiar = "sin restricción por esta clave".
    // La omitimos en vez de guardar [], que en SQL no casaría con nada y
    // dejaría el pool a cero.
    if (list.length > 0) out[key] = list;
  }

  for (const key of THEME_RANGE_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const year = parseYear(raw);
    if (year === undefined) {
      return {
        value: null,
        error: `"${key}" debe ser un año entre ${MIN_YEAR} y ${MAX_YEAR}.`,
      };
    }
    out[key] = year;
  }

  if (
    out.year_from !== undefined &&
    out.year_to !== undefined &&
    out.year_from > out.year_to
  ) {
    return {
      value: null,
      error: "El año inicial no puede ser posterior al final.",
    };
  }

  // Objeto vacío tras normalizar = sin temática. Guardamos NULL y no `{}`
  // para que la BD tenga UNA sola representación de "sin filtro" (el SQL
  // contempla ambas, pero un único valor canónico evita sorpresas al leer).
  return { value: Object.keys(out).length > 0 ? out : null, error: null };
}
