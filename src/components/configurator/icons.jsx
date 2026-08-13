// src/components/configurator/icons.jsx
// Set de iconos de línea del rediseño "configurador" (port de components.jsx).
// Trazo 1.6, caja 24, currentColor.

export function Icon({ d, size = 20, vb = 24, ...p }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {Array.isArray(d) ? d.map((p2, i) => <path key={i} d={p2} />) : <path d={d} />}
    </svg>
  );
}

export const I = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0",
  home: ["M4 11 12 4l8 7", "M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"],
  // Garaje = álbum (icono "album" de Lucide), no silueta de coche: el garaje ES
  // el álbum de cromos (colección por marca/país), así que el símbolo dice lo
  // que hay dentro. La silueta de coche anterior se leía recargada y redundante
  // (el garaje ya va de coches) — auditoría UX. Cuadrado con marcador, una sola
  // forma limpia que pega con el 🏆 del ranking y el 👤 del perfil sin repetir
  // "vehículo".
  garage: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M11 3v8l3-3 3 3V3",
  ],
  stats: ["M5 20V10", "M12 20V4", "M19 20v-7"],
  // Trofeo: el ranking deja de ser una barra-stats anónima y pasa a ser el
  // "puesto" del jugador dentro de la píldora de estado del header.
  trophy: [
    "M8 4h8v4.5a4 4 0 0 1-8 0V4Z",
    "M8 5.5H5.6a1.8 1.8 0 0 0 0 3.6H8",
    "M16 5.5h2.4a1.8 1.8 0 0 1 0 3.6H16",
    "M12 12.5V16",
    "M9 20h6",
    "M10 20a2 2 0 0 1 4 0",
  ],
  help: "M9.2 9a2.8 2.8 0 1 1 4 2.5c-1 .6-1.7 1-1.7 2.2M12 17.2h.01",
  arrowU: "M12 19V5M6 11l6-6 6 6",
  arrowD: "M12 5v14M6 13l6 6 6-6",
  arrowR: "M5 12h13M12 6l6 6-6 6",
  check: "M5 12.5 10 17l9-10",
  x: "M7 7l10 10M17 7 7 17",
  share: ["M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7", "M12 3v13", "M8 7l4-4 4 4"],
  flame: "M12 3c1.5 3 4 4 4 8a4 4 0 0 1-8 0c0-1.2.4-2 1-2.6C9 10 12 8 12 3Z",
  crosshair: ["M12 3v3M12 18v3M3 12h3M18 12h3", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"],
  chevD: "M6 9l6 6 6-6",
  chevR: "M9 6l6 6-6 6",
  // El espejo de chevR. Lo usa la salida de la Repesca, en el mismo sitio y con
  // la misma medida que la marca del sumario del juego: la esquina superior
  // izquierda es siempre el mismo objeto, y solo cambia lo que dice el trazo.
  chevL: "M15 6l-6 6 6 6",
  // Reproducir: el triángulo del vídeo de las temporadas presentadas. De línea
  // y CERRADO (vuelve al punto de partida) porque a este tamaño un triángulo
  // abierto se lee como un chevrón torcido; el `strokeLinejoin: round` del
  // componente le redondea las tres esquinas, que es lo que lo hace parecerse
  // al resto del set y no al play macizo de un reproductor.
  play: "M9 6.5v11l9-5.5-9-5.5Z",
};
