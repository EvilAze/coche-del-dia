// src/components/Portadilla.jsx
// LA PORTADILLA: una entrada de la rejilla de secciones (icono de línea +
// nombre en versalitas + apunte que dice qué hay dentro).
//
// Vive suelta porque la comparten el SUMARIO (las secciones del ejemplar) y el
// CARNET (tus secciones): es el mismo gesto —«elegir adónde ir»— y merece la
// misma forma en las dos pantallas. Antes el perfil lo resolvía con renglones
// de icono + texto + chevron, o sea con el menú de ajustes de Android, que es
// justo el lenguaje que el resto del juego evita.
//
// SIN `aria-label` propio a propósito: el nombre accesible del botón sale de lo
// que se lee dentro («Archivo, 12 de 80 portadas»), así que coincide con lo que
// el jugador ve y con lo que diría en voz alta al pedirlo por voz.

import { haptic } from "../lib/haptics";

export default function Portadilla({ icono, nombre, apunte, aviso = false, onClick }) {
  return (
    <button
      type="button"
      className="prensa-portadilla focus-ring"
      onClick={() => {
        haptic.impactLight();
        onClick?.();
      }}
    >
      <span className="marca">{icono}</span>
      <span className="nombre">
        {nombre}
        {/* La corrección al margen: "(1)" en rojo, como en la barra. */}
        {aviso && <span className="aviso" aria-hidden="true">(1)</span>}
      </span>
      <span className="apunte">{apunte}</span>
    </button>
  );
}
