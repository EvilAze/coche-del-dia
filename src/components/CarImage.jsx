// src/components/CarImage.jsx
export default function CarImage({ src, zoom, zoomLabel }) {
  return (
    <div
      className="relative mb-3 mt-4 w-full rounded-xl border border-border bg-bg-tertiary p-1 shadow-sm shadow-black/30"
      onContextMenu={(e) => e.preventDefault()}
      style={{ aspectRatio: "16 / 9" }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-black">
        
        {/* Imagen con zoom dinámico */}
        <div
          className="absolute inset-0 h-full w-full"
          style={{
            backgroundImage: `url('${src}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            transform: `scale(${zoom})`,
            transition: "transform 0.75s cubic-bezier(0.4,0,0.2,1)",
          }}
        />

        {/* Sombreado viñeta decorativo */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(10,10,11,0.6) 100%)" }}
        />

        {/* EL FIX: Solo renderizamos el div del zoomLabel si existe texto.
          Al terminar la partida, zoomLabel será null y este badge desaparecerá.
        */}
        {zoomLabel && (
          <div className="absolute bottom-2 right-2 rounded-full border border-border bg-black/70 px-3 py-1 text-[10px] uppercase tracking-widest text-muted backdrop-blur-sm">
            {zoomLabel}
          </div>
        )}
      </div>
    </div>
  );
}