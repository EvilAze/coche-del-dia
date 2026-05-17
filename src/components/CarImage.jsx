// src/components/CarImage.jsx
import { useEffect, useRef, useState } from "react";

// Aspect ratio por defecto mientras la imagen aún no ha cargado.
// Se reemplaza por el natural (img.naturalWidth/Height) al onLoad.
const DEFAULT_ASPECT = 4 / 3;

export default function CarImage({
  src,
  blurData = null,
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

  // Ref al <img> interior del <picture>. La usamos para detectar el caso de
  // "imagen ya completa en cache" — un comportamiento típico de WebKit/Blink
  // móvil al recargar la página: el navegador resuelve la imagen tan rápido
  // que React aún no ha instalado el listener onLoad, así que el evento NO
  // se dispara y `loaded` queda en false → opacity 0 → solo se ve el LQIP
  // para siempre. El useEffect de abajo lo sincroniza manualmente.
  const imgRef = useRef(null);

  // Capturamos el zoom previo DURANTE el render para que la primera vez
  // que cambia el status a "won" la keyframe revealWin parta del zoom
  // real anterior, no del actual (que ya es 1.0).
  const prevZoomRef = useRef(zoom);
  const prevZoom = prevZoomRef.current;

  // Si cambia la foto (nuevo coche), volvemos a mostrar el skeleton.
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  // Sincronización post-render: si el navegador tenía la imagen en cache
  // (recarga típica en móvil), `img.complete` ya es true y onLoad NUNCA se
  // disparará. Forzamos `loaded = true` para que opacity pase a 1 y el
  // usuario vea la foto, no el LQIP eterno.
  // Sin dependencia explícita: corre tras CADA render, pero solo actúa
  // cuando hace falta (loaded === false + img completa). setState con el
  // mismo valor no re-renderiza, así que no hay loop.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (!loaded && img.complete && img.naturalWidth > 0) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
      setLoaded(true);
    }
  });

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
        blurData ? (
          // LQIP: el placeholder borroso ya intuye silueta y paleta del coche
          // mientras descarga la foto real. El filter:blur es necesario porque
          // la imagen base64 es solo 24 px de ancho y se escala a 100% del
          // contenedor — sin blur se vería pixelado. scale(1.1) tapa el halo
          // transparente que deja el blur en los bordes.
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${blurData})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(20px) saturate(1.1)",
              transform: "scale(1.1)",
            }}
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-bg-secondary/60" />
        )
      )}

      {/*
        <picture> con AVIF / WebP / JPEG (fallback):
          - El navegador elige el primer <source> que entiende. Safari < 16
            y Firefox < 93 caen automáticamente al <img> JPEG.
          - `srcSet` ofrece 3 tamaños (320 / 640 / 1280). Con `sizes` el
            navegador calcula qué archivo bajar según viewport + DPR.
          - sizes="(max-width:480px) 100vw, 480px": en móvil el contenedor
            ocupa todo el ancho disponible; en pantallas grandes el max-w-md
            del padre lo capea a ~448 px → 480px cubre con margen.
          - El <img> mantiene TODA la lógica visual: animación de zoom,
            keyframe revealWin, filter:blur del estado "perdido anónimo",
            onLoad handler. <picture> solo decide qué bytes carga.
      */}
      {/*
        Sobre `sizes` y los srcSet:
          - El contenedor en "playing" mide ~288 px (max-w-[18rem]) en móvil
            y ~448 px (max-w-md del padre) en pantallas grandes.
          - PERO el juego aplica transform:scale(3.5x → 1.8x) sobre la foto,
            así que el "slot efectivo" es mucho mayor que el CSS literal.
            Le mentimos al browser sobre el tamaño del slot para forzarlo a
            descargar una imagen suficientemente grande para aguantar el zoom.
          - "200vw" en móvil = pide una imagen del doble del viewport → con
            DPR 2 termina pidiendo 1280w o 1920w, que aguantan el zoom inicial
            sin pixelar.
          - En desktop el slot está capeado al max-w-md (~448 px); usamos
            1280px como hint, que en DPR 2 lleva al navegador a pedir 1920w
            si está disponible, o 1280w en otro caso. Aceptable.
        Sobre el orden AVIF → WebP → JPEG:
          - El navegador toma el primer <source> que entiende. Safari 16+,
            Chrome y Firefox 93+ → AVIF. Safari 14-15 → WebP. Resto → JPEG.
      */}
      <picture>
        <source
          type="image/avif"
          srcSet={`${src}&f=avif&w=640 640w, ${src}&f=avif&w=1280 1280w, ${src}&f=avif&w=1920 1920w`}
          sizes="(max-width: 480px) 200vw, 1280px"
        />
        <source
          type="image/webp"
          srcSet={`${src}&f=webp&w=640 640w, ${src}&f=webp&w=1280 1280w, ${src}&f=webp&w=1920 1920w`}
          sizes="(max-width: 480px) 200vw, 1280px"
        />
        {/*
          <img> interior:
            - Mantiene TODA la lógica visual previa: animación de zoom,
              keyframe revealWin, filter:blur del estado "perdido anónimo",
              onLoad handler que dispara setLoaded(true).
            - opacity en lugar de display: garantiza que el navegador
              empiece a descargar la imagen al montar el componente (con
              display:none algunos navegadores difieren la descarga). El
              LQIP de fondo cubre el rectángulo vacío mientras carga, y al
              completar la descarga el <img> aparece con fade suave (250 ms).
            - ref={imgRef}: necesario para el useEffect que sincroniza el
              estado `loaded` cuando la imagen viene de cache (ver arriba).
        */}
        <img
          ref={imgRef}
          src={`${src}&f=jpeg&w=1280`}
          srcSet={`${src}&f=jpeg&w=640 640w, ${src}&f=jpeg&w=1280 1280w, ${src}&f=jpeg&w=1920 1920w`}
          sizes="(max-width: 480px) 200vw, 1280px"
          alt="Coche del día"
          draggable={false}
          onLoad={handleImageLoad}
          className={`absolute inset-0 h-full w-full object-cover ${isWinReveal && loaded ? "animate-reveal-win" : ""}`}
          style={{
            opacity: loaded ? 1 : 0,
            transformOrigin: "center center",
            // En win: deja que la keyframe revealWin pilote el transform.
            // En el resto: transition suave para los cambios de zoom +
            // fade-in al cargar.
            transform: isWinReveal ? undefined : `scale(${zoom})`,
            transition: isWinReveal
              ? "opacity 0.25s ease-out"
              : "transform 0.75s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease-out",
            filter: blurred ? "blur(18px) saturate(0.85)" : undefined,
            "--zoom-from": zoomFrom,
          }}
        />
      </picture>

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
