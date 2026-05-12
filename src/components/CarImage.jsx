// src/components/CarImage.jsx
import { useEffect, useState } from "react";

export default function CarImage({ src, zoom, zoomLabel }) {
  const [loaded, setLoaded] = useState(false);

  // Si cambia la foto (nuevo coche), volvemos a mostrar el skeleton
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <div
      className="relative mb-3 mt-4 w-full overflow-hidden rounded-xl border border-border bg-bg-tertiary shadow-md shadow-black/40"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Skeleton: mantiene una altura media (~4/3) mientras llega la foto
          de Supabase, para evitar el salto brusco del layout. */}
      {!loaded && (
        <div className="aspect-[4/3] w-full animate-pulse bg-bg-secondary/60" />
      )}

      {/* Imagen real. w-full + h-auto -> el marco adopta la proporción
          natural de cada coche, sin recortes ni franjas negras.
          El scale(zoom) preserva el efecto "blur"/cierre del juego:
          durante la partida la imagen está muy ampliada (sólo se ve un
          trozo); al acertar, zoom = 1 y se ve completa. */}
      <img
        src={src}
        alt="Coche del día"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className="w-full h-auto"
        style={{
          display: loaded ? "block" : "none",
          transform: `scale(${zoom})`,
          transformOrigin: "center center",
          transition: "transform 0.75s cubic-bezier(0.4,0,0.2,1)",
        }}
      />

      {/* Viñeta decorativa: sólo cuando la imagen ya está visible */}
      {loaded && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(10,10,11,0.6) 100%)",
          }}
        />
      )}

      {/* Etiqueta del nivel de zoom (oculta al ganar/perder) */}
      {zoomLabel && loaded && (
        <div className="absolute bottom-2 right-2 rounded-full border border-border bg-black/70 px-3 py-1 text-[10px] uppercase tracking-widest text-muted backdrop-blur-sm">
          {zoomLabel}
        </div>
      )}
    </div>
  );
}
