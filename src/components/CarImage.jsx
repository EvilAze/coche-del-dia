// src/components/CarImage.jsx
import { useEffect, useRef, useState } from "react";

// Aspect ratio por defecto mientras la imagen aún no ha cargado.
// Se reemplaza por el natural (img.naturalWidth/Height) al onLoad.
const DEFAULT_ASPECT = 4 / 3;

export default function CarImage({
  src,
  zoom,
  hintIndex,
  totalHints,
  status,
  blurred = false,
  overlay = null,
}) {
  const [loaded, setLoaded] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  // Ratio real de la foto (width/height). Se usa solo cuando el juego termina
  // para devolver al contenedor su forma natural. Mientras se juega siempre
  // forzamos 1:1.
  const [naturalRatio, setNaturalRatio] = useState(DEFAULT_ASPECT);

  // Capturamos el zoom previo DURANTE el render para que la primera vez
  // que cambia el status a "won" la keyframe revealWin parta del zoom
  // real anterior, no del actual (que ya es 1.0).
  const prevZoomRef = useRef(zoom);
  const prevZoom = prevZoomRef.current;

  // Si cambia la foto (nuevo coche), volvemos a mostrar el skeleton.
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  // Flash de "pista desbloqueada" sólo durante la partida.
  useEffect(() => {
    if (loaded && prevZoomRef.current !== zoom && status === "playing") {
      setFlashKey((k) => k + 1);
    }
    prevZoomRef.current = zoom;
  }, [zoom, status, loaded]);

  const isWinReveal = status === "won";
  // Estado "revelado": el juego ha terminado, por victoria o derrota.
  // El contenedor abandona el cuadrado 1:1 y vuelve a su aspecto natural.
  const isRevealed = status === "won" || status === "lost";
  const zoomFrom = isWinReveal && prevZoom !== zoom ? prevZoom : zoom;
  const showLabel = status === "playing" && hintIndex != null && totalHints;

  function handleImageLoad(e) {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
    }
    setLoaded(true);
  }

  // Aspect-ratio del contenedor:
  //   - Mientras juega: 1:1 estricto. La imagen ampliada llena con object-cover,
  //     recortando lo que sobre para no dejar huecos.
  //   - Revelado: aspecto natural de la foto. Como el contenedor coincide
  //     con la imagen, object-cover y object-contain dan el mismo resultado
  //     (foto entera, sin recortes).
  // Antes de que la imagen cargue mantenemos 1:1 para que el skeleton del
  // estado "playing" sea cuadrado y la transición a "revelado" anime hacia
  // el aspecto correcto.
  const containerAspect = isRevealed && loaded ? naturalRatio : 1;

  return (
    <div
      className={`
        relative mb-3 mt-4 mx-auto w-full overflow-hidden rounded-xl
        border border-border bg-bg-tertiary shadow-md shadow-black/40
        ${!isRevealed ? "max-w-[18rem]" : "max-w-full"}
        sm:max-w-full
      `}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        aspectRatio: containerAspect,
        // Animación coreografiada al revelar: el aspect-ratio sale del 1:1
        // hacia el natural, y el max-width pasa del cap móvil al 100% del
        // contenedor padre, ambos sobre la misma curva y duración para que
        // se sienta como un único movimiento.
        transition:
          "aspect-ratio 750ms cubic-bezier(0.4, 0, 0.2, 1), max-width 750ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-bg-secondary/60" />
      )}

      <img
        src={src}
        alt="Coche del día"
        draggable={false}
        onLoad={handleImageLoad}
        className={`absolute inset-0 h-full w-full object-cover ${isWinReveal && loaded ? "animate-reveal-win" : ""}`}
        style={{
          display: loaded ? "block" : "none",
          transformOrigin: "center center",
          // En win: deja que la keyframe revealWin pilote el transform.
          // En el resto: transition suave para los cambios de zoom.
          transform: isWinReveal ? undefined : `scale(${zoom})`,
          transition: isWinReveal
            ? undefined
            : "transform 0.75s cubic-bezier(0.4,0,0.2,1)",
          filter: blurred ? "blur(18px) saturate(0.85)" : undefined,
          "--zoom-from": zoomFrom,
        }}
      />

      {/* Hint-flash: overlay efímero al desbloquear nueva pista */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-accent/35 animate-hint-flash"
        />
      )}

      {/* Viñeta decorativa: sólo cuando la imagen ya está visible */}
      {loaded && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-700"
          style={{
            opacity: status === "playing" ? 1 : 0,
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(10,10,11,0.6) 100%)",
          }}
        />
      )}

      {/* Overlay opcional (p.ej. CTA de login cuando un anónimo pierde) */}
      {overlay && loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
          <div className="pointer-events-auto w-full max-w-[20rem]">
            {overlay}
          </div>
        </div>
      )}

      {/* Etiqueta narrativa de pista con mini progress bar */}
      {showLabel && loaded && (
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded-full border border-border bg-black/70 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-[10px] uppercase tracking-widest text-white">
            Pista <span className="tabular-nums">{hintIndex + 1}</span>
            <span className="text-muted"> / {totalHints}</span>
          </span>
          <div className="flex gap-0.5">
            {Array.from({ length: totalHints }).map((_, i) => (
              <span
                key={i}
                className={`h-1 w-1.5 rounded-sm transition-colors ${
                  i <= hintIndex ? "bg-accent" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
