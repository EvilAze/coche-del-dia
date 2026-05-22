// src/components/AchievementIcons.jsx
// Iconos SVG para los logros que no son ni logo de marca ni bandera. Stroke
// consistente (1.8) y currentColor para todos: el padre decide tamaño y
// color via className. Reemplaza a la primera iteración (sketchy, fill
// mezclado con stroke) por trazos más detallados estilo Lucide/Phosphor.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// Coche en perfil (sedán): capó curvado, cabina con dos ventanas
// definidas, dos ruedas con pasos. Mucho más leíble a 28 px que la
// silueta plana anterior.
function CarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Carrocería: bajos + capó + techo + maletero */}
      <path d="M3 14v-1l1.5-3.5A2 2 0 0 1 6.3 8.3h11.4a2 2 0 0 1 1.8 1.2L21 13v1" />
      {/* Línea de cintura (separación ventanas/carrocería) */}
      <path d="M5 11h14" />
      {/* Pilar central entre ventanas delantera y trasera */}
      <path d="M12 8.3v2.7" />
      {/* Chasis bajo (suelo del coche) */}
      <path d="M3 14h18v3a1 1 0 0 1-1 1h-1.5" />
      <path d="M5.5 18H4a1 1 0 0 1-1-1v-3" />
      {/* Ruedas */}
      <circle cx="7.5" cy="18" r="1.8" />
      <circle cx="16.5" cy="18" r="1.8" />
    </svg>
  );
}

// Garaje pequeño: caseta con tejado a dos aguas y puerta basculante
// con líneas que sugieren paneles. Reemplaza al "rectángulo con P"
// que parecía señal de aparcamiento, no un garaje.
function ParkingIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Tejado a dos aguas */}
      <path d="M3 10 12 4l9 6" />
      {/* Muros */}
      <path d="M5 10v10h14V10" />
      {/* Puerta del garaje con paneles horizontales */}
      <path d="M7 20v-7h10v7" />
      <path d="M7 15.5h10" />
      <path d="M7 18h10" />
    </svg>
  );
}

// Concesionario: edificio comercial con toldo, puerta central y dos
// ventanas/escaparates. El toldo es la pista visual de "comercio".
function ShopIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Toldo */}
      <path d="M3 9 5 5h14l2 4" />
      <path d="M3 9h18" />
      {/* Estructura */}
      <path d="M4 9v11h16V9" />
      {/* Puerta central */}
      <path d="M10 20v-6h4v6" />
      {/* Escaparates */}
      <rect x="6" y="12" width="3" height="3" rx="0.4" />
      <rect x="15" y="12" width="3" height="3" rx="0.4" />
      {/* Suelo */}
      <path d="M3 20h18" />
    </svg>
  );
}

// Museo / templo griego: frontón triangular, arquitrabe, tres columnas
// y basamento escalonado. Más reconocible que la versión anterior con
// 4 columnas tan apretadas que se fundían a 28 px.
function MuseumIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Frontón */}
      <path d="M3 9 12 4l9 5" />
      {/* Arquitrabe */}
      <path d="M3 9h18v1H3z" />
      {/* Columnas */}
      <path d="M6 10v8" />
      <path d="M12 10v8" />
      <path d="M18 10v8" />
      {/* Plataforma */}
      <path d="M4 18h16v1H4z" />
      {/* Base escalonada */}
      <path d="M3 20h18" />
    </svg>
  );
}

// Corona refinada: cinco picos (tres altos, dos valles), banda lisa
// y gemas en los picos principales. Sustituye al zigzag plano previo.
function CrownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Silueta de la corona: tres picos */}
      <path d="M3 17 4.5 8l4.5 4 3-7 3 7 4.5-4L21 17z" />
      {/* Banda inferior */}
      <path d="M3 17h18" />
      <path d="M5 20h14" />
      {/* Gemas en cada pico */}
      <circle cx="4.5" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Llama estilo Lucide. Stroke-based para emparejar el resto de iconos
// (la versión anterior era fill, rompía la coherencia del set) y
// matchea la FlameIcon del header.
function FlameIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

const ICONS = {
  car: CarIcon,
  parking: ParkingIcon,
  shop: ShopIcon,
  museum: MuseumIcon,
  crown: CrownIcon,
  flame: FlameIcon,
};

/**
 * Renderiza un icono SVG por nombre. `repeat` controla cuántas veces se
 * pinta (útil para rachas: 1 llama / 2 llamas / 3 llamas → 7/30/100 días).
 * `muted` añade un filtro gris para badges bloqueados.
 */
export default function AchievementIcon({
  name,
  repeat = 1,
  muted = false,
  size = "h-7 w-7",
  color = "text-accent",
}) {
  const Cmp = ICONS[name] || CarIcon;
  const filter = muted ? "grayscale(1)" : undefined;
  if (repeat <= 1) {
    return (
      <span className={`inline-flex ${color}`} style={{ filter }}>
        <Cmp className={size} />
      </span>
    );
  }
  // Repeticiones: pinta N iconos en línea, ligeramente solapados para
  // que parezca un "cluster" y no una secuencia descolgada.
  return (
    <span className={`inline-flex items-center ${color}`} style={{ filter }}>
      {Array.from({ length: repeat }).map((_, i) => (
        <Cmp
          key={i}
          className={`${size} ${i > 0 ? "-ml-2" : ""}`}
        />
      ))}
    </span>
  );
}
