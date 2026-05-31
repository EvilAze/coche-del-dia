// src/components/AchievementIcons.jsx
// ---------------------------------------------------------------------
// Set de iconos para los logros que no son ni logo de marca ni bandera.
//
// Filosofía del rediseño (v4 — "línea refinada"):
//   • UNA silueta confiada por icono. Cero detalle interior, cero
//     miniaturas dentro de miniaturas. A 28-36px el detalle es ruido;
//     lo premium es la forma limpia con aire alrededor.
//   • Stroke 1.5 consistente, currentColor, SIN rellenos. El color
//     (dorado si conseguido, gris tenue si bloqueado) lo aporta el
//     contenedor — el icono solo dibuja la silueta.
//   • Estética Apple / Linear / Vercel: geometría tranquila y legible
//     de un vistazo, no ilustración.
//
//   Narrativa (intacta respecto a v3, solo cambia la ejecución):
//     MILESTONES   llave → garaje → showroom → museo → trofeo
//     STREAKS      bujía → bujía encendida → pistón
// ---------------------------------------------------------------------

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/* ============================================================
   MILESTONES — escala de propiedad → leyenda
   ============================================================ */

// 1 coche · "Primer coche" — Llave: aro + paletón con dos dientes.
function KeyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <circle cx="7" cy="12" r="3.4" />
      <circle cx="7" cy="12" r="0.9" />
      <path d="M10.4 12H20" />
      <path d="M16.5 12v2.6" />
      <path d="M20 12v2.1" />
    </svg>
  );
}

// 10 coches · "Garaje pequeño" — Garaje: tejado a dos aguas + puerta de arco.
function GarageIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 10v10" />
      <path d="M19 10v10" />
      <path d="M4 20h16" />
      <path d="M9 20v-5a3 3 0 0 1 6 0v5" />
    </svg>
  );
}

// 25 coches · "Concesionario" — Showroom: marquesina trapezoidal + escaparate.
function ShowroomIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 9l2-3.5h14L21 9z" />
      <path d="M5 9v11h14V9" />
      <path d="M7 12.5h10" />
      <path d="M10 20v-4.5h4V20" />
    </svg>
  );
}

// 50 coches · "Museo" — Frontón clásico sobre columnas (lectura instantánea).
function MuseumIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M3 9 12 4l9 5" />
      <path d="M5.5 9.5v8.5" />
      <path d="M9.83 9.5v8.5" />
      <path d="M14.16 9.5v8.5" />
      <path d="M18.5 9.5v8.5" />
      <path d="M4 18h16" />
      <path d="M3 20.5h18" />
    </svg>
  );
}

// 100 coches · "Garaje icónico" — Trofeo: copa + asas + base.
function TrophyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M7.5 4h9v3a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 5H5.5a2 2 0 0 0 0 3.6h2" />
      <path d="M16.5 5h2a2 2 0 0 1 0 3.6h-2" />
      <path d="M12 11.5v4" />
      <path d="M10.5 15.5h3v4h-3z" />
      <path d="M9 19.5h6" />
    </svg>
  );
}

/* ============================================================
   STREAKS — escala de ignición mecánica
   ============================================================ */

// 7 días · "Constancia" — Bujía (silueta limpia: terminal, cerámica,
// tuerca, rosca y electrodo, sin las líneas internas de la rosca).
function SparkPlugIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M10 3.5h4v2.5h-4z" />
      <path d="M9.5 6h5v4h-5z" />
      <path d="M9 10h6l-1 2h-4z" />
      <path d="M10 12h4v3h-4z" />
      <path d="M12 15v2.5" />
      <path d="M12 17.5h-1.8" />
    </svg>
  );
}

// 30 días · "Disciplina" — Bujía con chispa: misma silueta + dos arcos.
function SparkPlugFiredIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <path d="M10 3.5h4v2.5h-4z" />
      <path d="M9.5 6h5v4h-5z" />
      <path d="M9 10h6l-1 2h-4z" />
      <path d="M10 12h4v2.5h-4z" />
      <path d="M12 14.5v1.8" />
      <path d="M7 16l1.6-.6" />
      <path d="M17 16l-1.6-.6" />
      <path d="M12 18.5l-1.4.8" />
    </svg>
  );
}

// 100 días · "Leyenda" — Pistón: cabeza + dos anillos + biela + cigüeñal.
function PistonIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      <rect x="8" y="3.5" width="8" height="7" rx="1" />
      <path d="M9 6.5h6" />
      <path d="M9 8.5h6" />
      <path d="M12 10.5v4.4" />
      <circle cx="12" cy="17.6" r="2.6" />
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
  spark: SparkPlugIcon,
  spark_fired: SparkPlugFiredIcon,
  piston: PistonIcon,

  // Aliases retrocompatibles por si quedó algún nombre antiguo en datos.
  car: KeyIcon,
  parking: GarageIcon,
  shop: ShowroomIcon,
  museum: MuseumIcon,
  crown: TrophyIcon,
  flame: SparkPlugIcon,
};

/**
 * Renderiza un icono de logro por nombre.
 *
 * @param {string} name   — clave del icono en ICONS
 * @param {boolean} muted — DEPRECATED. El estado bloqueado ahora se
 *                          comunica con el color (prop `color`), no con
 *                          grayscale: un trazo monocromo no mejora al
 *                          desaturarlo. Se ignora.
 * @param {string} size   — clases tailwind de tamaño (h-* w-*)
 * @param {string} color  — clase de color (default accent dorado)
 */
export default function AchievementIcon({
  name,
  // eslint-disable-next-line no-unused-vars
  muted = false,
  size = "h-8 w-8",
  color = "text-accent",
}) {
  const Cmp = ICONS[name] || KeyIcon;
  return (
    <span className={`inline-flex ${color}`}>
      <Cmp className={size} />
    </span>
  );
}
