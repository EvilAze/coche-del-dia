// src/components/AchievementIcons.jsx
// ---------------------------------------------------------------------
// Set de iconos para los logros que no son ni logo de marca ni bandera.
//
// Filosofía del rediseño (v3):
//   • Cada icono habla "automotive" desde el primer pixel — para
//     entusiastas del motor, simracers y mecánicos, no para usuario
//     genérico de app gamificada.
//   • Narrativa por nivel:
//       MILESTONES   llave → garaje con coche → showroom → vitrina →
//                    trofeo de competición  (propiedad → maestría → leyenda)
//       STREAKS      bujía → bujía encendida → pistón en combustión
//                    (chispa → ignición → motor pleno)
//   • Stroke 1.8 consistente, currentColor, fills selectivos solo
//     donde aportan jerarquía (pupila de faro, gemas de trofeo).
// ---------------------------------------------------------------------

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/* ============================================================
   MILESTONES — escala de propiedad → leyenda
   ============================================================ */

// 1 coche · "Primer coche" — Llave de coche moderna con mando.
// Reemplaza al CarIcon (meta-redundante). La llave es el símbolo
// íntimo de "tu primer coche en propiedad".
function KeyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Mando de la llave: forma redondeada estilo car key fob */}
      <path d="M5 9.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z" />
      {/* Botón central del mando (lock/unlock) */}
      <circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      {/* Vástago de la llave hacia la derecha */}
      <path d="M12 9.5h9" />
      {/* Dientes de la llave (los cortes) */}
      <path d="M17 9.5v2.5" />
      <path d="M20 9.5v2" />
    </svg>
  );
}

// 10 coches · "Garaje pequeño" — Garaje con silueta de coche dentro.
// Cambio clave vs ParkingIcon: añade un coche dentro del garaje para
// matar la confusión "es una casa con porche". Confirma automoción.
function GarageIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Tejado a dos aguas */}
      <path d="M3 10 12 4l9 6" />
      {/* Muros laterales */}
      <path d="M5 10v10" />
      <path d="M19 10v10" />
      {/* Suelo / umbral del garaje */}
      <path d="M3 20h18" />
      {/* Apertura del garaje (rectángulo central, abierto) */}
      <path d="M7 20v-7h10v7" />
      {/* Coche dentro del garaje (silueta perfil mini) */}
      <path d="M9 18h6l-0.6-1.6h-4.8z" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="18.4" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="18.4" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 25 coches · "Concesionario" — Showroom con coche en exposición.
// Cambio clave vs ShopIcon: pasa de "comercio genérico con toldo" a
// "espacio de exhibición de coche" — pilares laterales + spotlights
// desde el techo + coche en el centro.
function ShowroomIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Marco del showroom: techo + dos columnas */}
      <path d="M2 7h20" />
      <path d="M3 7v13" />
      <path d="M21 7v13" />
      {/* Spotlights apuntando hacia el coche (líneas diagonales) */}
      <path d="M8 7l-1 2.5" />
      <path d="M16 7l1 2.5" />
      {/* Pedestal de exposición */}
      <path d="M5 20h14" />
      {/* Coche en exposición (silueta más detallada que las miniaturas) */}
      <path d="M7 17l1.2-2.2h7.6l1.2 2.2" />
      <path d="M7 17h10v1.6H7z" />
      <circle cx="9" cy="18.6" r="0.9" />
      <circle cx="15" cy="18.6" r="0.9" />
    </svg>
  );
}

// 50 coches · "Museo" — Vitrina de cristal con coche clásico dentro.
// Cambio clave vs MuseumIcon (templo griego): pasa del estereotipo
// universal de museo a una vitrina específicamente automotive.
// Marco doble (cristal exterior + plinto interior) + coche clásico.
function VitrineIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Marco exterior de la vitrina (cristal) */}
      <rect x="3" y="3" width="18" height="18" rx="0.5" />
      {/* Marco interior (separación entre cristal y exposición) */}
      <path d="M5 5v14" />
      <path d="M19 5v14" />
      <path d="M5 17h14" />
      {/* Plinto inferior de exposición */}
      <path d="M5 19h14" />
      {/* Coche clásico (silueta más curvada para sugerir vintage) */}
      <path d="M7 16l1-3h2l1-1.5h2l1 1.5h2l1 3" />
      <circle cx="9.5" cy="16.2" r="0.9" />
      <circle cx="14.5" cy="16.2" r="0.9" />
      {/* Etiqueta/placa del museo (línea decorativa arriba) */}
      <path d="M10 7h4" />
    </svg>
  );
}

// 100 coches · "Garaje icónico" — Trofeo de competición con laureles.
// Cambio clave vs CrownIcon: pasa del cliché medieval ("rey de los
// coches") al lenguaje de motorsport real — copa con asas + base +
// detalle de laurel. Le Mans / F1 / Daytona vibe.
function TrophyIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Copa del trofeo */}
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      {/* Asas laterales */}
      <path d="M16 5h2a1.5 1.5 0 0 1 0 3h-2" />
      <path d="M8 5H6a1.5 1.5 0 0 0 0 3h2" />
      {/* Tallo / cuello entre copa y base */}
      <path d="M12 13v3" />
      {/* Base del trofeo (dos escalones) */}
      <path d="M8 16h8" />
      <path d="M7 19h10" />
      <path d="M9 16v3" />
      <path d="M15 16v3" />
      {/* Detalle de número 1 / estrella en la copa */}
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ============================================================
   STREAKS — escala de ignición mecánica
   ============================================================ */

// 7 días · "Constancia" — Bujía.
// El componente más básico de la combustión: produce la chispa.
// Sustituye al flame genérico por un símbolo culturalmente automotive.
function SparkPlugIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Terminal superior (donde se conecta el cable) */}
      <path d="M10.5 3h3v2h-3z" />
      <path d="M12 5v1.5" />
      {/* Cuerpo cerámico (parte superior aislante) */}
      <path d="M9.5 6.5h5v3.5h-5z" />
      {/* Hexágono de la tuerca (parte central, para llave) */}
      <path d="M9 10h6l-0.7 2H9.7z" />
      {/* Rosca (parte que enrosca al motor) */}
      <path d="M10 12h4" />
      <path d="M10 13h4" />
      <path d="M10 14h4" />
      {/* Electrodo lateral y central (donde salta la chispa) */}
      <path d="M11 15.5v2" />
      <path d="M13 15.5v1.5l-1 0.5" />
    </svg>
  );
}

// 30 días · "Disciplina" — Bujía con arco eléctrico.
// La chispa ya está saltando: añadimos rayos eléctricos alrededor del
// electrodo para visualizar la ignición activa. Mismo símbolo, evolucionado.
function SparkPlugFiredIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Bujía simplificada (cuerpo principal) */}
      <path d="M10.5 3h3v2h-3z" />
      <path d="M9.5 5.5h5v4h-5z" />
      <path d="M9 9.5h6l-0.7 2.5H9.7z" />
      <path d="M10 12h4" />
      <path d="M10 13.5h4" />
      {/* Electrodos */}
      <path d="M11 14.5v1.5" />
      <path d="M13 14.5v1l-1 0.5" />
      {/* Arcos eléctricos (chispas saliendo del electrodo) */}
      <path d="M7 16l1.5-0.5" />
      <path d="M6.5 18l2-1" />
      <path d="M17 16l-1.5-0.5" />
      <path d="M17.5 18l-2-1" />
      <path d="M12 19v1.5" />
      <path d="M12 21l-0.8 0.5" />
      <path d="M12 21l0.8 0.5" />
    </svg>
  );
}

// 100 días · "Leyenda" — Pistón con combustión.
// Cambio de escala conceptual: pasamos de "el componente que enciende"
// (bujía) a "el motor en pleno funcionamiento" (pistón disparado por
// la combustión). Top tier mecánico: ya no es la chispa, es la máquina
// entera trabajando.
function PistonIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...STROKE}>
      {/* Cilindro (cámara que contiene el pistón) */}
      <path d="M7 4h10v10H7z" />
      {/* Pistón dentro del cilindro (en posición media) */}
      <path d="M8 9h8v2H8z" />
      {/* Anillos del pistón (las dos líneas características) */}
      <path d="M8 7h8" />
      <path d="M8 13h8" />
      {/* Biela (la varilla que conecta pistón al cigüeñal) */}
      <path d="M12 14v4" />
      {/* Cigüeñal (círculo inferior, sugerido) */}
      <circle cx="12" cy="19.5" r="1.5" />
      {/* Llamas de combustión saliendo por la parte superior */}
      <path d="M9 4l0.5-2" />
      <path d="M12 4l0.5-2.5" />
      <path d="M15 4l0.5-2" />
      <path d="M10.5 2l-0.5-1.5" />
      <path d="M13.5 2l0.5-1.5" />
    </svg>
  );
}

/* ============================================================
   Registro y render
   ============================================================ */

const ICONS = {
  // Nuevos (post-rediseño)
  key: KeyIcon,
  garage: GarageIcon,
  showroom: ShowroomIcon,
  vitrine: VitrineIcon,
  trophy: TrophyIcon,
  spark: SparkPlugIcon,
  spark_fired: SparkPlugFiredIcon,
  piston: PistonIcon,

  // Aliases retrocompatibles: si en algún sitio quedó "car"/"parking"/etc.
  // por error de migración, no rompemos — apuntamos al icono nuevo
  // equivalente. Eliminar estos alias tras verificar que achievements.js
  // y cualquier consumidor externo usa solo los nombres nuevos.
  car: KeyIcon,
  parking: GarageIcon,
  shop: ShowroomIcon,
  museum: VitrineIcon,
  crown: TrophyIcon,
  flame: SparkPlugIcon,
};

/**
 * Renderiza un icono de logro por nombre.
 *
 * @param {string} name      — clave del icono en ICONS
 * @param {number} repeat    — DEPRECATED. Antes se usaba para 1/2/3
 *                              flames apilados en streaks; ahora cada
 *                              tier tiene su propio icono distinto, así
 *                              que `repeat` debería ser 1 siempre.
 *                              Se mantiene por compatibilidad: si llega
 *                              con valor > 1, se ignora silenciosamente.
 * @param {boolean} muted    — añade grayscale para badges bloqueados
 * @param {string} size      — clases tailwind de tamaño (h-* w-*)
 * @param {string} color     — clase de color (default accent dorado)
 */
export default function AchievementIcon({
  name,
  // eslint-disable-next-line no-unused-vars
  repeat = 1,
  muted = false,
  size = "h-7 w-7",
  color = "text-accent",
}) {
  const Cmp = ICONS[name] || KeyIcon;
  const filter = muted ? "grayscale(1)" : undefined;
  return (
    <span className={`inline-flex ${color}`} style={{ filter }}>
      <Cmp className={size} />
    </span>
  );
}
