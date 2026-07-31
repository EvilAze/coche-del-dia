// lib/admin-handlers/describe-car.js
// Genera la descripción en español de un coche para el panel admin.
// (El handler se añade en la Task 2 de este plan.)

// Tope de la columna `cars.description` y del textarea del admin. Si el modelo
// se pasa, recortamos aquí en vez de dejar que Postgres o el maxLength del
// textarea corten a mitad de palabra.
export const MAX_DESCRIPTION_LEN = 600;

// Normaliza lo que devuelve el modelo: los saltos de línea de un párrafo
// generado se ven fatal en el textarea de una línea larga, y el recorte a pelo
// (`slice`) partiría la última palabra.
export function limpiarDescripcion(texto) {
  if (typeof texto !== "string") return "";

  const normalizado = texto.replace(/\s+/g, " ").trim();
  if (normalizado.length <= MAX_DESCRIPTION_LEN) return normalizado;

  const recortado = normalizado.slice(0, MAX_DESCRIPTION_LEN);
  const ultimoEspacio = recortado.lastIndexOf(" ");
  // Si no hay espacios (texto anómalo de una sola palabra kilométrica) nos
  // quedamos con el corte duro: mejor eso que devolver vacío.
  const porPalabra = ultimoEspacio > 0 ? recortado.slice(0, ultimoEspacio) : recortado;

  // Un texto que acaba en coma o dos puntos delata el corte; lo limpiamos.
  return porPalabra.replace(/[\s,;:.\-–—]+$/, "");
}
