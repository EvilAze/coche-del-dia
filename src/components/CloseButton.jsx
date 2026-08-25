// Botón de cerrar estandarizado: hit-area de 44x44 (HIG mínimo) + aria-label.
// Reemplaza los "×" inline con muy poca caja.
export default function CloseButton({ onClick, label = "Cerrar", className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`
        focus-ring
        flex h-11 w-11 shrink-0 items-center justify-center
        rounded-none text-tinta-2 transition-colors duration-roce ease-roce
        hover:text-rojo
        active:text-rojo
        ${className}
      `}
    >
      <svg
        className="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
