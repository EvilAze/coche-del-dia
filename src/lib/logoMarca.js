// src/lib/logoMarca.js
// La ruta del logotipo de una marca (public/brands). Slug tal cual lo nombra
// quien sube los PNG: minúsculas y espacios por guiones, SIN quitar acentos.
// Lo comparten el Archivo y la hoja de selección de la app; si falta el
// fichero, cada uno pinta la inicial (ver su onError).
export function logoMarca(marca) {
  return `/brands/${String(marca || "").toLowerCase().replace(/\s+/g, "-")}.png`;
}
