// src/components/CarImage.jsx
import { useEffect, useRef } from "react";

export default function CarImage({ src, zoom, zoomLabel }) {
  const imgRef = useRef(null);

  useEffect(() => {
    if (imgRef.current) {
      imgRef.current.style.transform = `scale(${zoom})`;
    }
  }, [zoom]);

  return (
    <div 
      className="relative w-full rounded-xl overflow-hidden bg-bg-tertiary border border-border mb-3"
      onContextMenu={(e) => e.preventDefault()}
      style={{ aspectRatio: "16/9" }}
    >
      <img
  ref={imgRef}
  src={src}
  alt="Coche a adivinar"
  draggable={false}
  onContextMenu={(event) => event.preventDefault()}
  onDragStart={(event) => event.preventDefault()}
  className="h-full w-full select-none object-cover pointer-events-none"
  style={{
    transform: `scale(${zoom})`,
    transition: "transform 0.75s cubic-bezier(0.4,0,0.2,1)",
    transformOrigin: "center center",
    WebkitUserSelect: "none",
    userSelect: "none",
    WebkitTouchCallout: "none",
  }}
/>

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(10,10,11,0.6) 100%)",
        }}
      />
      {/* Zoom label */}
      <div className="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur-sm text-muted text-[10px] tracking-widest uppercase px-3 py-1 rounded-full border border-border">
        {zoomLabel}
      </div>
    </div>
  );
}
