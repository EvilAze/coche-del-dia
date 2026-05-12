// src/components/CarImage.jsx
import { useEffect, useRef, useState } from "react";

export default function CarImage({
  src,
  zoom,
  hintIndex,
  totalHints,
  status,
}) {
  const [loaded, setLoaded] = useState(false);
  const [flashKey, setFlashKey] = useState(0);

  // Capturamos el zoom previo DURANTE el render para que la primera vez
  // que cambia el status a "won" la keyframe revealWin parta del zoom
  // real anterior, no del actual (que ya es 1.0).
  const prevZoomRef = useRef(zoom);
  const prevZoom = prevZoomRef.current;

  // Si cambia la foto (nuevo coche), volvemos a mostrar el skeleton
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
  const zoomFrom = isWinReveal && prevZoom !== zoom ? prevZoom : zoom;
  const showLabel = status === "playing" && hintIndex != null && totalHints;

  return (
    <div
      className="relative mb-3 mt-4 w-full overflow-hidden rounded-xl border border-border bg-bg-tertiary shadow-md shadow-black/40"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!loaded && (
        <div className="aspect-[4/3] w-full animate-pulse bg-bg-secondary/60" />
      )}

      <img
        src={src}
        alt="Coche del día"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={`w-full h-auto ${isWinReveal && loaded ? "animate-reveal-win" : ""}`}
        style={{
          display: loaded ? "block" : "none",
          transformOrigin: "center center",
          // En win: deja que la keyframe revealWin pilote el transform.
          // En el resto: transition suave para los cambios de zoom.
          transform: isWinReveal ? undefined : `scale(${zoom})`,
          transition: isWinReveal
            ? undefined
            : "transform 0.75s cubic-bezier(0.4,0,0.2,1)",
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
