// src/components/AchievementIcons.jsx
// Iconos SVG para logros. Línea fina dorada sobre fondo oscuro.
// ViewBox 48×48 — todo el contenido centrado en y=24.

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/* ============================================================
   MILESTONES
   ============================================================ */

// Volante — centrado (y7–y41, mid=24) ✓
function KeyIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <circle cx="24" cy="24" r="17" />
      <circle cx="24" cy="24" r="5" />
      <circle cx="24" cy="24" r="1.5" strokeWidth="1.2" />
      <path d="M24 19V7" />
      <path d="M19.7 26.5L9.5 32.5" />
      <path d="M28.3 26.5L38.5 32.5" />
    </svg>
  );
}

// Garaje — centrado (y6–y42, mid=24) ✓
function GarageIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M4 20L24 6l20 14" />
      <path d="M8 20v22" />
      <path d="M40 20v22" />
      <path d="M6 42h36" />
      <rect x="14" y="25" width="20" height="17" rx="1" />
      <path d="M14 31h20M14 37h20" strokeWidth="1.2" />
      <circle cx="24" cy="16" r="2.5" strokeWidth="1.2" />
    </svg>
  );
}

// Concesionario — centrado (y7–y41, mid=24) ✓
function ShowroomIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M4 12l3-5h34l3 5" />
      <path d="M4 12h40" strokeWidth="2.5" />
      <path d="M7 12v29" />
      <path d="M41 12v29" />
      <path d="M5 41h38" />
      <rect x="10" y="16" width="11" height="21" rx="0.5" strokeWidth="1.3" />
      <rect x="27" y="16" width="11" height="21" rx="0.5" strokeWidth="1.3" />
      <path d="M22 41v-8h4v8" strokeWidth="1.3" />
    </svg>
  );
}

// Museo — centrado (y5–y43, mid=24) ✓
function MuseumIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M6 17L24 5l18 12" />
      <path d="M8 17h32" strokeWidth="2.5" />
      <path d="M12 17v20" />
      <path d="M20 17v20" />
      <path d="M28 17v20" />
      <path d="M36 17v20" />
      <path d="M8 37h32" strokeWidth="2" />
      <path d="M6 40h36" strokeWidth="1.3" />
      <path d="M4 43h40" />
      <circle cx="24" cy="12.5" r="2" strokeWidth="1.2" />
    </svg>
  );
}

// Trofeo — centrado (y8–y41, mid=24.5) ✓
function TrophyIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M15 8h18v7c0 6-4 11-9 11s-9-5-9-11z" />
      <path d="M15 12H10a4.5 4.5 0 000 9h5" />
      <path d="M33 12h5a4.5 4.5 0 010 9h-5" />
      <path d="M18 11h12" strokeWidth="1" />
      <path d="M24 26v5" />
      <path d="M19 31h10" />
      <rect x="17" y="33" width="14" height="4" rx="1" strokeWidth="1.3" />
      <path d="M14 37h20v4H14z" />
    </svg>
  );
}

/* ============================================================
   STREAKS
   ============================================================ */

// Llama simple — centrado (y6–y42, mid=24) ✓
function SparkIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M24 6c-2 9-12 14-12 24a12 12 0 0024 0c0-10-10-15-12-24z" />
      <path d="M24 20c-1 5-6 8-6 14a6 6 0 0012 0c0-6-5-9-6-14z" strokeWidth="1.3" />
    </svg>
  );
}

// Llama triple — centrado (y5–y43, mid=24) ✓
function SparkFiredIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M24 5c-2 10-13 15-13 25a13 13 0 0026 0c0-10-11-15-13-25z" />
      <path d="M24 17c-1 5-7 8-7 15a7 7 0 0014 0c0-7-6-10-7-15z" strokeWidth="1.3" />
      <path d="M24 27c-.5 3-3.5 5-3.5 9a3.5 3.5 0 007 0c0-4-3-6-3.5-9z" strokeWidth="1" />
      <path d="M8 17l-3-2M40 17l3-2" strokeWidth="1.5" />
      <path d="M5 26h-3M43 26h3" strokeWidth="1.5" />
    </svg>
  );
}

// Corona — centrado (y3.5–y43, mid=23.25) ≈✓
function PistonIcon({ className }) {
  return (
    <svg viewBox="0 0 48 48" className={className} {...STROKE}>
      <path d="M8 30V16l8 7 8-13 8 13 8-7v14" />
      <rect x="8" y="30" width="32" height="6" rx="1.5" />
      <circle cx="8" cy="16" r="2" strokeWidth="1.3" />
      <circle cx="24" cy="10" r="2.5" strokeWidth="1.3" />
      <circle cx="40" cy="16" r="2" strokeWidth="1.3" />
      <circle cx="16" cy="33" r="1" strokeWidth="1" />
      <circle cx="24" cy="33" r="1" strokeWidth="1" />
      <circle cx="32" cy="33" r="1" strokeWidth="1" />
      <path d="M24 7.5V3.5" strokeWidth="1.3" />
      <path d="M22.5 5h3" strokeWidth="1.3" />
      <path d="M6 39h36" />
      <path d="M4 43h40" strokeWidth="1.5" />
    </svg>
  );
}

/* ============================================================
   Registro y render
   ============================================================ */

const ICONS = {
  key: KeyIcon,
  garage: GarageIcon,
  showroom: ShowroomIcon,
  vitrine: MuseumIcon,
  trophy: TrophyIcon,
  spark: SparkIcon,
  spark_fired: SparkFiredIcon,
  piston: PistonIcon,

  car: KeyIcon,
  parking: GarageIcon,
  shop: ShowroomIcon,
  museum: MuseumIcon,
  crown: TrophyIcon,
  flame: SparkIcon,
};

export default function AchievementIcon({
  name,
  size = "h-8 w-8",
  color = "text-accent",
}) {
  const Cmp = ICONS[name] || KeyIcon;
  return (
    <Cmp className={`${size} ${color} shrink-0 transition-colors duration-300`} />
  );
}
