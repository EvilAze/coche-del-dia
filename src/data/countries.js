// src/data/countries.js
// Mapa de país → emoji de bandera. Centralizado aquí para que GuessRow,
// Garage y cualquier otra vista que muestre país lo consuma sin duplicar.

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

export function flagFor(pais) {
  return COUNTRY_FLAGS[pais] || "🏳️";
}
