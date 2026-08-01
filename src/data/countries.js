// src/data/countries.js
// Centraliza el código ISO de cada país para que cualquier vista lo consuma
// sin duplicar el mapa. De ahí salen dos cosas: el nombre traducido del país
// (i18n, vía Intl.DisplayNames) y la ruta de su bandera en /public/flags.
//
// Aquí hubo también un `COUNTRY_FLAGS` con los emoji de bandera, guardado
// "por si hacía falta para usos no visuales". Nunca hizo falta: la UI pinta
// JPGs reales con flagImagePath() precisamente porque Windows desktop no tiene
// glifo de bandera y degrada el emoji a su código ISO en texto plano. Un mapa
// que nadie lee y que además no se puede enseñar no es una reserva, es lastre
// (y lo único que obligaba a exceptuar este fichero en test:estetica).

export const COUNTRY_CODES = {
  Japón: "JP",
  Alemania: "DE",
  Italia: "IT",
  "EE.UU.": "US",
  Francia: "FR",
  "Reino Unido": "GB",
  "Corea del Sur": "KR",
  Suecia: "SE",
  España: "ES",
  Austria: "AT",
  Croacia: "HR",
  Rumanía: "RO",
  Rusia: "RU",
  "República Checa": "CZ",
  "Países Bajos": "NL",
};

// Helpers para usar las JPGs reales de /public/flags/ — única fuente fiable
// de banderas en CROSS-PLATFORM (Windows desktop NO renderiza los emojis de
// bandera; los muestra como código ISO en texto plano). Cualquier UI que
// necesite mostrar la bandera DEBE usar `flagImagePath(pais)` en lugar del
// emoji crudo.
//
// El slug normaliza el nombre del país a formato URL-safe: NFD para separar
// acentos, elimina diacríticos y puntos, lowercase, espacios → guiones.
//   "EE.UU."       → "eeuu"
//   "Reino Unido"  → "reino-unido"
//   "Países Bajos" → "paises-bajos"
function slugifyCountry(pais) {
  return String(pais || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

export function flagImagePath(pais) {
  return `/flags/${slugifyCountry(pais)}.jpg`;
}
