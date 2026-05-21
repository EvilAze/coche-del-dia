// src/components/AchievementIcons.jsx
// Iconos SVG para los logros que no son ni logo de marca ni bandera de
// país. Sustituyen a los emoji originales (🚗 🅿️ 🏬 🏛️ 👑 🔥) que
// renderizaban inconsistentes entre OS y, en Windows, parecían cebollas
// grises en vez de llamas. Mismo problema que ya arreglé en el splash.
//
// Todos los iconos comparten viewBox 24x24 y heredan color via
// `currentColor`. El componente padre decide tamaño con `className`.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function CarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 14 L4 10 Q4.5 8.5 6 8.5 L18 8.5 Q19.5 8.5 20 10 L21 14" />
      <path d="M3 14 L3 17 Q3 18 4 18 L20 18 Q21 18 21 17 L21 14 Z" />
      <circle cx="7.5" cy="18" r="1.6" fill="currentColor" />
      <circle cx="16.5" cy="18" r="1.6" fill="currentColor" />
    </svg>
  );
}

function ParkingIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M10 16 L10 8 L13.5 8 Q15.5 8 15.5 10.5 Q15.5 13 13.5 13 L10 13" />
    </svg>
  );
}

function ShopIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 8 L4 4 L20 4 L21 8" />
      <path d="M4 8 L4 20 L20 20 L20 8" />
      <path d="M3 8 L21 8" />
      <path d="M10 20 L10 14 L14 14 L14 20" />
    </svg>
  );
}

function MuseumIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 9 L12 4 L21 9" />
      <path d="M3 9 L21 9 L21 11 L3 11 Z" />
      <path d="M5 11 L5 18 M9 11 L9 18 M15 11 L15 18 M19 11 L19 18" />
      <path d="M3 20 L21 20" />
    </svg>
  );
}

function CrownIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 18 L5 8 L9 12 L12 6 L15 12 L19 8 L21 18 Z" />
      <path d="M3 20 L21 20" />
    </svg>
  );
}

function FlameIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" stroke="none">
      <path d="M12 2.5 c0 4 3 5.5 3 9 0 2-1 3-2 3.5 .3-1.3-.4-2.6-1.5-3 .5 2-1 3-2 3 -1.5 0 -2.5 -1.5 -2.5 -3.5 0 -3 2.5 -4 2.5 -7 1 1.5 2 2 2.5 2 0-1.5-.5-3 0-4z" />
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
