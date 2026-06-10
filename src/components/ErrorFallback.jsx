// src/components/ErrorFallback.jsx
// Fallback de la ErrorBoundary: si el árbol React peta durante el render,
// mostramos algo decente en vez de la pantalla blanca de la muerte. Usa los
// tokens Tailwind del tema (bg-bg-primary, accent, muted) — antes iba con
// estilos inline y colores hex duplicados que se desincronizaban del tema.
//
// Los textos van hardcodeados A PROPÓSITO (sin useT): este componente se
// renderiza cuando algo ya ha reventado, y cuantas menos dependencias tenga
// (i18n incluida), menos probable es que el propio fallback también falle.
// El error ya ha llegado a Sentry en este punto; aquí solo damos una salida.

export default function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary p-6 text-center font-body text-[#f0f0f4]">
      <p className="m-0 font-display text-[1.7rem] font-extrabold tracking-tight text-accent">
        ALGO FALLÓ
      </p>
      <p className="mt-3 max-w-[380px] text-muted">
        Hemos tenido un problema cargando la página. Vuelve a intentarlo
        en un momento — si persiste, recarga.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 cursor-pointer rounded-lg border border-accent bg-transparent px-6 py-2.5 text-xs uppercase tracking-[0.14em] text-accent"
      >
        Recargar
      </button>
    </div>
  );
}
