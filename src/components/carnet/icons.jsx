// src/components/carnet/icons.jsx
// El set de iconos del CARNET (perfil propio y perfil ajeno).
//
// POR QUÉ EXISTE: estos ocho iconos vivían duplicados línea a línea en
// MyStats.jsx y PublicProfile.jsx. No es solo repetición: los comentarios de
// ambos archivos documentan que los dos carnets YA se despegaron una vez (el
// avatar del perfil público se quedó con el degradado menta del tema anterior
// mientras el propio migraba a papel). Dos copias del mismo dibujo son dos
// copias que envejecen a distinta velocidad; una sola no puede.
//
// Trazo 1.6 sobre caja 24, como el resto del sistema de línea
// (components/configurator/icons.jsx). Heredan el color del padre vía
// currentColor y el tamaño vía className: nunca traen color propio.

const ICO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// (Aquí vivían FlameIcon, CrownIcon y CarIcon —racha, mejor racha y aciertos—
// más ShieldIcon y TrophyIcon/ChevronRightIcon. Los tres primeros acompañaban a
// las filas de la ficha del carnet; los dos últimos, a las «puertas» con
// chevron. El rediseño de los perfiles se llevó las dos estructuras por delante:
// las cifras viven ahora en la banda del carnet, que compara cuatro números en
// una fila sin necesitar un dibujo por número, y las puertas son portadillas con
// los iconos del set del juego (configurator/icons.jsx), los mismos que estrena
// el sumario. Un icono por dato era, además, la señal de que el dato no se
// explicaba solo. ShieldIcon se fue antes, con la mecánica del escudo de racha
// —ver scripts/2026-08-retirar-escudo-racha.sql.)

export function MedalIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
    </svg>
  );
}

export function PencilIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

// Teléfono: la portadilla de la edición Android en el carnet. Silueta sola, sin
// flecha de descarga ni logo de tienda: en la rejilla lo que dice adónde lleva
// es el nombre de la sección, no un adorno dentro del icono.
export function PhoneIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M10.5 17.5h3" strokeWidth="1.2" />
    </svg>
  );
}
