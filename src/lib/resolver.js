// Prefijo inequívoco → valor canónico ("jag" → "Jaguar"): recorta la mayor
// fricción del cupón en móvil (teclear nombres completos). SOLO autocompleta
// si el prefijo casa con UNA única opción — nunca adivina entre varias; con
// ambigüedad o sin match, devuelve lo escrito (recortado) y que decida el
// validador de siempre.
//
// La normalización de tildes usa la forma ESCAPADA del rango combinante
// (regla 14 de CLAUDE.md): incrustar los caracteres reales es una bomba de
// relojería — un re-guardado con codificación errónea produce un char-class
// inválido que lanza SyntaxError y tumba el chunk entero.
const norm = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function resolver(valor, lista) {
  const v = norm(valor);
  if (!v) return String(valor).trim();
  const exacto = lista.find((x) => norm(x) === v);
  if (exacto) return exacto;
  const prefijo = lista.filter((x) => norm(x).startsWith(v));
  return prefijo.length === 1 ? prefijo[0] : String(valor).trim();
}
