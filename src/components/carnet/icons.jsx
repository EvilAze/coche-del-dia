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

export function FlameIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M12 3c-1 4.5-6 7-6 12a6 6 0 0 0 12 0c0-5-5-7.5-6-12z" />
      <path d="M12 10.5c-.5 2.5-3 4-3 7a3 3 0 0 0 6 0c0-3-2.5-4.5-3-7z" strokeWidth="1.2" />
    </svg>
  );
}

export function CrownIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M4 8l4 3.5 4-6.5 4 6.5 4-3.5v9.5H4z" />
      <path d="M4 17.5h16" strokeWidth="1.2" />
    </svg>
  );
}

export function ShieldIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.5-3 7.6-7 9.2-4-1.6-7-4.7-7-9.2V5.6z" />
      <path d="M9 12l2 2 4-4.2" />
    </svg>
  );
}

export function CarIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M5 11l1.6-4A2 2 0 0 1 8.5 5.7h7a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M4 11h16v5H4z" />
      <circle cx="7.5" cy="16.5" r="1.6" />
      <circle cx="16.5" cy="16.5" r="1.6" />
    </svg>
  );
}

export function MedalIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
    </svg>
  );
}

export function TrophyIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M7 4h10v4.5a5 5 0 0 1-10 0z" />
      <path d="M7 6H5a2.4 2.4 0 0 0 0 4.8h2M17 6h2a2.4 2.4 0 0 1 0 4.8h-2" />
      <path d="M12 13.5v3.5M9.5 20h5M10 17h4v3h-4z" />
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

export function ChevronRightIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} strokeWidth="2" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
