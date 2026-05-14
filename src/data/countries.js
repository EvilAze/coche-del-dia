// src/data/countries.js
// Centraliza la info de país (emoji bandera + código ISO) para que cualquier
// vista la consuma sin duplicar el mapa.
//
// Nota sobre emojis: en Windows desktop NO existen glifos para banderas,
// el sistema los renderiza como su código ISO en texto ("🇬🇧" → "GB").
// Por eso en interfaces de desktop conviene usar `codeFor()` con un badge
// estilizado en vez del emoji crudo. En móvil (iOS/Android) sí funciona.

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
