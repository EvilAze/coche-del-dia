// src/lib/archive.js
// Lógica PURA de «El Archivo» (la colección de portadas, antes "Garaje").
// Vive fuera del componente para poder testearla sin montar React: el
// componente solo pinta lo que estas funciones deciden.
//
// Concepto: cada coche ganado es una PORTADA numerada de la revista. Lo que
// hace que una portada sea coleccionable —y no una fila más de un listado—
// son tres datos que ya viaja /api/garage: el nº de edición, cuándo la
// conseguiste y con cuántos intentos.

// ── Sellos de mérito ────────────────────────────────────────────────────
// Dos cromos del mismo coche NO son iguales entre dos jugadores: el sello es
// lo que graba tu hazaña en el papel.
//   pleno → acertado al primer intento (el mérito máximo en partida normal).
//   vet   → ganado en Modo Veterano, tras haberlo fallado antes (1 intento,
//           sin pistas: hay que recordar marca+modelo+año exactos).
// Orden estable y de mayor a menor "rareza percibida" para que el render no
// dependa del orden en que lleguen los flags.
//
// «Pleno» exige que la portada venga del COCHE DEL DÍA. En repesca no
// significa lo mismo: la veterana da un único intento, así que TODA victoria
// llegaba con `attempts: 1` y se sellaba como pleno — el archivo presumía de
// un acierto a la primera en una partida de cinco que nunca ocurrió. El
// origen se cuenta aparte, en `stampsOf`.
export function meritsOf(car) {
  if (!car || !car.unlocked) return [];
  const out = [];
  if (car.wonAsVeteran) out.push("vet");
  if (car.attempts === 1 && !car.viaRepesca) out.push("pleno");
  return out;
}

// Lo que se ESTAMPA en el cromo: el mérito más, si toca, el origen. Es una
// lista aparte porque el dorso separa las dos ideas — «Distintivo» habla de
// cómo de bien lo hiciste; el origen, de dónde salió la portada.
//   repesca → desbloqueada rescatando un número atrasado.
// No se estampa junto a «Vet»: el Modo Veterano solo existe en la repesca, así
// que ese sello ya dice de dónde viene y repetirlo sería ruido en un cromo de
// 150 px.
export function stampsOf(car) {
  const merits = meritsOf(car);
  if (car?.unlocked && car.viaRepesca && !car.wonAsVeteran) {
    return ["repesca", ...merits];
  }
  return merits;
}

// ── Rareza ──────────────────────────────────────────────────────────────
// «¿Cuánta gente tiene este cromo?» es LA pregunta de un coleccionista, y la
// única que hace que tu portada y la mía no valgan lo mismo. El servidor manda
// el porcentaje ya calculado (cars.rarity_pct, del cron nocturno); aquí solo
// lo traducimos a lenguaje de imprenta.
//
// Umbrales, pensados para que la etiqueta rara SEA rara: si «número agotado»
// lo lleva un tercio del archivo, deja de significar nada.
//   ≥ 50 %  tirada amplia   → la tiene media comunidad
//   ≥ 15 %  tirada corta    → minoría clara
//   <  15 % número agotado  → puñado de coleccionistas
const RARITY_STEPS = [
  { tier: "wide", min: 50 },
  { tier: "short", min: 15 },
  { tier: "soldout", min: 0 },
];

export function rarityTier(pct) {
  if (!Number.isFinite(pct) || pct < 0) return null;
  return RARITY_STEPS.find((s) => pct >= s.min)?.tier ?? null;
}

// Porcentaje listo para pintar. Por debajo del 1 % redondear daría «0 %», que
// leería como «no la tiene nadie» justo en la portada más exclusiva del
// archivo — el caso que más ilusión hace enseñar. Ahí escribimos «<1».
export function formatRarityPct(pct) {
  if (!Number.isFinite(pct) || pct < 0) return null;
  if (pct > 0 && pct < 1) return "<1";
  return String(Math.round(pct));
}

// ── Aplanado y orden ────────────────────────────────────────────────────
// Recorre el payload agrupado por país y devuelve TODAS las portadas
// conseguidas en una sola lista, anotando el país en cada una (en la vista
// "Todas" se pierde el contexto del grupo, y el país es parte de la ficha).
export function collectCovers(countries) {
  const out = [];
  for (const c of countries || []) {
    for (const car of c.cars || []) {
      if (car && car.unlocked) out.push({ ...car, pais: c.pais });
    }
  }
  return out;
}

// Orden de la vitrina: lo más reciente primero. Es la regla que hace que
// abrir el archivo premie —lo último que conseguiste está arriba— en vez de
// enterrarlo bajo un orden alfabético que nunca cambia.
// Desempates: nº de edición desc (más nuevo = número mayor) y luego modelo,
// para que el orden sea TOTAL y estable (sin saltos entre renders).
function compareByRecency(a, b) {
  const aw = a?.wonAt || "";
  const bw = b?.wonAt || "";
  if (aw !== bw) return aw < bw ? 1 : -1;
  const ai = a?.issue ?? 0;
  const bi = b?.issue ?? 0;
  if (ai !== bi) return bi - ai;
  return String(a?.modelo || "").localeCompare(String(b?.modelo || ""), "es");
}

// Orden alternativo: por antigüedad del coche (año de fabricación asc). Es el
// orden "de álbum" clásico, el que pide quien colecciona por época.
function compareByYear(a, b) {
  const ay = a?.anio ?? 0;
  const by = b?.anio ?? 0;
  if (ay !== by) return ay - by;
  return String(a?.modelo || "").localeCompare(String(b?.modelo || ""), "es");
}

// Orden por escasez: lo más raro arriba. Es el orden que un coleccionista pide
// en cuanto sabe que la rareza existe («enséñame mis joyas»). Las portadas sin
// dato de rareza van al final: no son comunes, es que no lo sabemos.
function compareByRarity(a, b) {
  const ar = Number.isFinite(a?.rarity?.pct) ? a.rarity.pct : Infinity;
  const br = Number.isFinite(b?.rarity?.pct) ? b.rarity.pct : Infinity;
  if (ar !== br) return ar - br;
  return compareByRecency(a, b);
}

const ORDERS = {
  year: compareByYear,
  rarity: compareByRarity,
  recent: compareByRecency,
};

export function sortCovers(covers, order = "recent") {
  const list = [...(covers || [])];
  return list.sort(ORDERS[order] || compareByRecency);
}

// Agrupa los coches de un país por marca. Dentro del país, cada marca es una
// PÁGINA del álbum: es el nivel donde los huecos son contables y por tanto
// motivan (18 huecos sueltos deprimen; 2 huecos en la página de Ferrari no).
// Orden: marcas con más progreso primero, luego alfabético.
export function groupByBrand(cars) {
  const map = new Map();
  for (const car of cars || []) {
    const marca = car.marca || "?";
    if (!map.has(marca)) map.set(marca, { marca, cars: [] });
    map.get(marca).cars.push(car);
  }
  return Array.from(map.values())
    .map((b) => ({
      ...b,
      unlocked: b.cars.filter((c) => c.unlocked).length,
      total: b.cars.length,
    }))
    .sort((a, b) => {
      if (b.unlocked !== a.unlocked) return b.unlocked - a.unlocked;
      return a.marca.localeCompare(b.marca, "es");
    });
}

// ── Portadas nuevas desde la última visita ──────────────────────────────
// El micro-momento que hace volver: "¿qué hay nuevo desde la última vez?".
// Guardamos en localStorage los ids ya vistos; nuevo = ganado y no visto.
//
// Primera visita de todas (no hay nada guardado): NADA es nuevo. Un archivo
// con 47 cintas de "NUEVO" a la vez no celebra nada, solo hace ruido — la
// cinta significa "esto ha pasado desde que no mirabas".
export const SEEN_KEY = "cdd_archive_seen";

// Tope defensivo: los ids son uuids (~36 B). 2000 portadas ≈ 72 KB, muy por
// debajo del límite de localStorage, y evita crecer sin techo si algún día el
// catálogo se dispara. Al recortar conservamos los ÚLTIMOS vistos.
const SEEN_MAX = 2000;

function safeStorage(storage) {
  // El acceso a localStorage puede lanzar en modo privado / iframes sandbox.
  // Todo el módulo degrada a "no hay memoria" en vez de romper el archivo.
  try {
    return storage || (typeof localStorage !== "undefined" ? localStorage : null);
  } catch {
    return null;
  }
}

export function readSeen(storage) {
  const ls = safeStorage(storage);
  if (!ls) return null;
  try {
    const raw = ls.getItem(SEEN_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function writeSeen(ids, storage) {
  const ls = safeStorage(storage);
  if (!ls) return;
  try {
    const list = Array.from(new Set(ids || []));
    ls.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX)));
  } catch {
    // Sin memoria de "nuevos" el archivo sigue siendo perfectamente usable.
  }
}

// Devuelve el Set de ids que son NUEVOS para este usuario y, de paso, deja
// registrado que ya los ha visto (la cinta dura una visita, no para siempre).
export function pickNewCovers(unlockedIds, storage) {
  const ids = Array.from(new Set(unlockedIds || []));
  const seen = readSeen(storage);
  // Primera visita: sellamos todo como visto y no marcamos nada.
  if (seen === null) {
    writeSeen(ids, storage);
    return new Set();
  }
  const seenSet = new Set(seen);
  const fresh = ids.filter((id) => !seenSet.has(id));
  // Conservamos los vistos anteriores (aunque ya no estén en el catálogo) para
  // no "re-estrenar" portadas si el payload llega incompleto por un fallo.
  writeSeen([...seen, ...fresh], storage);
  return new Set(fresh);
}

// ── Formato ─────────────────────────────────────────────────────────────
// Nº de edición con relleno a 3 cifras: "Nº 007" pesa como número de serie;
// "Nº 7" parece un contador cualquiera. Sin edición → placeholder de hueco.
export function issueLabel(issue) {
  if (!Number.isFinite(issue) || issue <= 0) return "———";
  return String(issue).padStart(3, "0");
}

// Fecha de conquista en formato corto y legible ("12 jul 2026"). Devuelve
// null si no hay fecha, para que el caller omita la fila entera.
export function formatWonAt(wonAt, dateLocale = "es-ES") {
  if (!wonAt || typeof wonAt !== "string") return null;
  const ms = Date.parse(`${wonAt}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat(dateLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(ms));
  } catch {
    return wonAt;
  }
}
