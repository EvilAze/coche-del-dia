// src/data/countries.js
// Centraliza la info de país (emoji bandera + código ISO) para que cualquier
// vista la consuma sin duplicar el mapa.
//
// Nota sobre emojis: en Windows desktop NO existen glifos para banderas,
// el sistema los renderiza como su código ISO en texto ("🇬🇧" → "GB").
// Por eso para mostrar banderas en UI usamos `flagImagePath()` (JPGs reales
// en /public/flags), que funciona en TODOS los dispositivos. `COUNTRY_FLAGS`
// y `codeFor()` quedan disponibles para usos no visuales (share text,
// metadata, casos donde se ha verificado que el emoji sí renderiza).

export const COUNTRY_FLAGS = {
  Japón: "🇯🇵",
  Alemania: "🇩🇪",
  Italia: "🇮🇹",
  "EE.UU.": "🇺🇸",
  Francia: "🇫🇷",
  "Reino Unido": "🇬🇧",
  "Corea del Sur": "🇰🇷",
  Suecia: "🇸🇪",
  España: "🇪🇸",
  Austria: "🇦🇹",
  Croacia: "🇭🇷",
  Rumanía: "🇷🇴",
  Rusia: "🇷🇺",
  "República Checa": "🇨🇿",
  "Países Bajos": "🇳🇱",
};

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

export function flagFor(pais) {
  return COUNTRY_FLAGS[pais] || "🏳️";
}

export function codeFor(pais) {
  return COUNTRY_CODES[pais] || "??";
}

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
export function slugifyCountry(pais) {
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
