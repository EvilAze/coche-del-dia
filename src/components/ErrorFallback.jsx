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
    <div className="flex min-h-screen flex-col items-center justify-center bg-papel p-6 text-center font-serif text-tinta">
      <p className="pm-kicker m-0">Fe de erratas</p>
      <p className="pm-title mt-2">Algo falló en la rotativa</p>
      <p className="pm-body mt-3 max-w-[380px]">
        Hemos tenido un problema cargando la página. Vuelve a intentarlo
        en un momento — si persiste, recarga.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="pm-btn pm-btn--ghost mt-6 !w-auto px-8"
      >
        Recargar
      </button>
    </div>
  );
}
