// src/components/CarImage.jsx
import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptics";
import { useT } from "../i18n";
import { apiUrl } from "../lib/apiUrl";

// TAP-PARA-AMPLIAR RETIRADO. La foto fue tocable durante toda la vida del
// diseño anterior, y con razón: el escenario era un recuadro modesto dentro de
// una página con cabecera, formulario e historial, así que abrirlo a pantalla
// completa (mismo `src` + mismo `scale(zoom)`, ni un píxel más de coche) era la
// única forma de mirar de verdad la pista. Desde que la foto manda en el pliego
// —marco a todo el ancho, con el escenario rompiendo el margen para tocar los
// dos bordes— el lightbox enseñaba prácticamente lo mismo que ya había en
// pantalla: un gesto que cobra un toque, un scrim y una animación para devolver
// el sitio donde ya estabas. Con él se van su botón invisible a inset-0 (que se
// comía cualquier intento de gesto sobre la foto), el icono de esquina, la copia
// del <picture> a 1920 y la clase .cdd-lightbox-frame.
// Si el escenario volviera a encoger, esto es lo que habría que resucitar.

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
  overlay = null,
  showHintLabel = true,
  // Nodo opcional anidado en el borde inferior-centro de la imagen. Decorativo.
  bottomCenter = null,
  // Nodo opcional anclado en la esquina inferior-DERECHA de la imagen (lo usa
  // el indicador de intentos del juego principal). Overlay discreto y
  // pointer-events off: es un rótulo sobre la foto, no un control.
  bottomRight = null,
  // Callback que se dispara cuando la imagen de REVELADO (la completa sin
  // crop que se sirve al ganar/perder) termina de cargar. Lo consume App
  // para coordinar el scroll automático al panel de resultado: no tiene
  // sentido scrollear hasta que el jugador ve el coche entero, y ese
  // momento depende de la red (la imagen full puede tardar). Sin esto,
  // un timeout fijo dispararía el scroll mientras la foto aún carga.
  onRevealLoad = null,
  // Variante "configurador" (rediseño premium): la foto vive en un marco 4:3
  // (.cdd-stage-frame) y se le superpone un HUD de cámara (`hud`). Cambia SOLO
  // el chrome visual; el pipeline de imagen y el zoom/crop (coherencia de
  // seguridad con el servidor) quedan intactos. Desactiva la viñeta y la
  // etiqueta de pista propias del diseño anterior.
  configurator = false,
  hud = null,
  // Barra de progreso de intentos anclada al BORDE INFERIOR de la imagen (dentro
  // del marco), por encima de la viñeta ::after que ya oscurece esa franja para
  // contener carrocerías claras → legible sobre cualquier coche. pointer-events
  // off, como el resto del cromo que va sobre la foto. Solo en modo configurador.
  bottomBar = null,
}) {
  const [loaded, setLoaded] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  // Cuando el <source> AVIF/WebP falla o tarda demasiado, marcamos fallback:
  // re-renderizamos sin los <source> y dejamos solo el elemento img JPEG (más
  // compatible). El navegador NO hace fallback automático entre <source>s
  // del <picture> cuando la red falla mid-stream — hay que forzarlo a mano.
  const [imgFailed, setImgFailed] = useState(false);
  // Ratio real de la foto (width/height). Se usa solo cuando el juego termina
  // para devolver al contenedor su forma natural. Mientras se juega siempre
  // forzamos 1:1.
  const [naturalRatio, setNaturalRatio] = useState(DEFAULT_ASPECT);

  // Ref al elemento img interior del <picture>. La usamos para detectar el caso de
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

  // Si cambia la foto (nuevo coche), volvemos a mostrar el skeleton. El src
  // sólo cambia: (1) al iniciar partida nueva, (2) al revelar la imagen
  // completa al terminar (won/lost) — NO entre intentos, porque durante
  // playing pedimos siempre la misma `?z=5`.
  useEffect(() => {
    setLoaded(false);
    setImgFailed(false);
  }, [src]);

  // Watchdog: si en 12 s la imagen no ha cargado, asumimos que el AVIF/WebP
  // se ha encallado (cold start de sharp, red lenta, etc.) y disparamos el
  // fallback a JPEG directo. Sin esto, algunos usuarios se quedan con el
  // skeleton borroso eterno y tienen que refrescar la página manualmente.
  //
  // 12 s (antes 8 s): en conexiones lentas un AVIF perfectamente válido aún
  // se está descargando a los 8 s; abandonarlo y saltar a un JPEG (más
  // pesado) era contraproducente — sobre la misma red lenta tardaba MÁS.
  // Los fallos reales (decode error, red caída) los captura onError al
  // instante, así que el watchdog solo cubre el "encallado sin error": ahí
  // damos más margen antes de cambiar de formato.
  useEffect(() => {
    if (loaded || imgFailed || !src) return;
    const t = setTimeout(() => setImgFailed(true), 12000);
    return () => clearTimeout(t);
  }, [src, loaded, imgFailed]);

  function handleImageError() {
    setImgFailed(true);
  }

  // Sincronización post-render: si el navegador tenía la imagen en cache
  // (recarga típica en móvil), `img.complete` ya es true y onLoad NUNCA se
  // disparará. Forzamos `loaded = true` para que opacity pase a 1 y el
  // usuario vea la foto, no el LQIP eterno.
  // Limitamos a cuando puede ocurrir realmente: tras cambio de src o
  // mientras loaded sigue false. Antes corría tras cada render (incluso al
  // cambiar flashKey o naturalRatio) — innecesario y ruidoso en profiler.
  useEffect(() => {
    if (loaded) return;
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
      setLoaded(true);
      // Imagen ya cacheada al montar (recarga con partida terminada): la
      // foto completa está visible de inmediato, avisamos para el scroll.
      if (status === "won" || status === "lost") onRevealLoad?.();
    }
  }, [src, loaded, status, onRevealLoad]);

  // Flash dorado de "pista desbloqueada" sólo durante la partida. Se
  // dispara al cambiar el `zoom` CSS (cada intento baja el scale).
  // El háptico (tap ligerísimo) acompaña al flash para reforzar la sensación
  // de "algo se ha revelado" — coherente con el shake del intento erróneo
  // que YA disparó haptic.warning() en GuessForm; aquí es el contrapunto
  // positivo del mismo gesto.
  useEffect(() => {
    const changed = prevZoomRef.current !== zoom;
    if (loaded && changed && status === "playing") {
      setFlashKey((k) => k + 1);
      haptic.impactLight();
    }
    prevZoomRef.current = zoom;
  }, [zoom, status, loaded]);

  // Las URLs de proxy propio (/api/...) soportan ?f=avif&w=640 etc.
  // Las URLs externas (Supabase CDN, /coches/, …) se usan directas.
  const isApiProxy = typeof src === "string" && src.startsWith("/api/");
  // En nativo, las URLs del proxy se absolutizan al dominio de producción
  // (el <img> no pasa por el shim de fetch). `isApiProxy` se calcula sobre el
  // `src` ORIGINAL relativo, así la detección no se rompe al absolutizar.
  const proxBase = isApiProxy ? apiUrl(src) : src;

  const isWinReveal = status === "won";
  // Estado "revelado": el juego ha terminado, por victoria o derrota. Al revelar,
  // el contenedor se ajusta al aspecto NATURAL de la foto (sin pedestal ni
  // florituras) para mostrarla completa; los intentos fluyen justo debajo.
  const isRevealed = status === "won" || status === "lost";
  // Punto de partida de la keyframe revealWin cuando se gana: el último
  // zoom CSS activo (p.ej. 1.667 si ganó en el 2º intento). Sin esto, la
  // animación arrancaría desde scale=1 y el "pop" no tendría amplitud.
  const zoomFrom = isWinReveal && prevZoom !== zoom ? prevZoom : zoom;
  const showLabel = showHintLabel && status === "playing" && hintIndex != null && totalHints;

  const { t } = useT();

  function handleImageLoad(e) {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
    }
    setLoaded(true);
    // Solo avisamos cuando lo que acaba de cargar es la imagen de revelado
    // (status won/lost). Durante la partida cargan imágenes recortadas por
    // intento — esas no deben disparar el scroll. El handler se recrea cada
    // render, así que `status` aquí es el del render que montó este elemento img: 
    // cuando carga la foto full del revelado, status ya es won/lost.
    if (status === "won" || status === "lost") onRevealLoad?.();
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
      className={
        configurator
          ? `cdd-stage-frame${isRevealed && loaded ? " revealed" : ""}`
          : // Marco de la variante NO-configurador (repesca, detalle del archivo):
            // esquina viva y filete, como el marco de la pantalla de juego. Traía
            // `rounded-xl` y una `shadow-md shadow-black/40` del tema oscuro: sobre
            // el papel del modo día esa sombra negra al 40% era una mancha, y el
            // redondeo hacía que la MISMA foto tuviera una forma en el juego y otra
            // aquí.
            `
        relative mb-3 mt-4 mx-auto w-full overflow-hidden rounded-none
        border border-border bg-bg-tertiary
        ${!isRevealed ? "max-w-[22rem]" : "max-w-full"}
        sm:max-w-full
      `
      }
      style={
        configurator
          ? {
              // En juego el marco es 1:1 (lo fija el CSS con cqmin); al revelar
              // adopta el aspecto natural de la foto para mostrarla completa.
              aspectRatio: isRevealed && loaded ? containerAspect : undefined,
              transition: isRevealed ? "aspect-ratio 600ms cubic-bezier(0.4, 0, 0.2, 1)" : undefined,
            }
          : undefined
      }
    >
      {/* ÁREA DE IMAGEN: cuadrada en juego, aspecto natural al revelar. Tiene
          su PROPIO overflow-hidden para recortar el zoom sin invadir la repisa
          inferior. El aspect-ratio (y su animación) vive aquí. */}
      <div
        className={configurator ? "absolute inset-0 overflow-hidden" : "relative w-full overflow-hidden"}
        onContextMenu={(e) => e.preventDefault()}
        style={
          configurator
            ? undefined
            : {
                aspectRatio: containerAspect,
                transition: "aspect-ratio 750ms cubic-bezier(0.4, 0, 0.2, 1)",
              }
        }
      >
      {/*
        Skeleton base: SIEMPRE montado, en la capa de abajo. Da la textura
        "cargando" mientras no hay ni LQIP ni imagen real (caso src=null
        del primer paint, antes de que get-daily-car resuelva).

        Clave para el feel premium: NO se desmonta nunca. Antes había un
        ternario `blurData ? <LQIP> : <pulse>` que al llegar la data
        desmontaba el pulse y montaba el LQIP en el mismo frame → micro-
        parpadeo en el handoff. Ahora el skeleton se queda detrás y el
        LQIP aparece encima cubriéndolo; cuando la imagen real carga, los
        tres (skeleton, LQIP, img) se cruzan suavemente por opacidad.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-pulse bg-bg-secondary/60"
        style={{ opacity: loaded ? 0 : 1, transition: "opacity 300ms ease-out" }}
      />

      {/*
        LQIP: el placeholder borroso ya intuye silueta y paleta del coche
        mientras descarga la foto real. El filter:blur es necesario porque
        la imagen base64 es solo 24 px de ancho y se escala a 100% del
        contenedor — sin blur se vería pixelado. scale(1.1) tapa el halo
        transparente que deja el blur en los bordes.

        Aparece encima del skeleton en cuanto llega blurData. Como el
        skeleton sigue detrás, no hay hueco visual durante el cambio. El
        `animate-fade-in` suaviza su propia entrada (0.4s) para que no sea
        un pop seco sobre el gris pulsante. Al cargar la imagen real
        fadea a opacity 0 por encima de su animación de entrada.
      */}
      {blurData && (
        <div
          aria-hidden="true"
          className={loaded ? "absolute inset-0" : "absolute inset-0 animate-fade-in"}
          style={{
            backgroundImage: `url(${blurData})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(20px) saturate(1.1)",
            transform: "scale(1.1)",
            opacity: loaded ? 0 : 1,
            transition: "opacity 300ms ease-out",
          }}
        />
      )}

      {/*
        <picture> con AVIF / WebP / JPEG (fallback):
          - El navegador elige el primer <source> que entiende. Safari 16+,
            Chrome y Firefox 93+ → AVIF. Safari 14-15 → WebP. Resto → JPEG.
          - El servidor entrega la imagen ya con un primer crop (?z=5,
            55% central) durante el juego. El cliente sigue aplicando un
            `transform: scale(1.94..1.0)` CSS encima para los intentos
            con más zoom — la combinación es lo que da el zoom-out animado.
          - Por eso le mentimos al `sizes` para que pida imágenes grandes:
            con scale 1.94, el "slot efectivo" en el primer intento es
            casi 2× el container CSS. Usamos "200vw" en móvil y 1280px en
            desktop, igual que antes de que reorganizáramos esto.
      */}
      <picture>
        {isApiProxy && !imgFailed && (
          <source
            type="image/avif"
            srcSet={`${proxBase}&f=avif&w=640 640w, ${proxBase}&f=avif&w=1280 1280w, ${proxBase}&f=avif&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        {isApiProxy && !imgFailed && (
          <source
            type="image/webp"
            srcSet={`${proxBase}&f=webp&w=640 640w, ${proxBase}&f=webp&w=1280 1280w, ${proxBase}&f=webp&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        <img
          // key cambia al activar fallback para forzar remount del elemento img y
          // que el navegador haga una request limpia (sin reaprovechar el
          // estado fallido del intento anterior).
          key={imgFailed ? "fallback" : "primary"}
          ref={imgRef}
          src={isApiProxy ? `${proxBase}&f=jpeg&w=1280` : src}
          srcSet={
            isApiProxy && !imgFailed
              ? `${proxBase}&f=jpeg&w=640 640w, ${proxBase}&f=jpeg&w=1280 1280w, ${proxBase}&f=jpeg&w=1920 1920w`
              : undefined
          }
          sizes={isApiProxy && !imgFailed ? "(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px" : undefined}
          alt={t("cdd.carImageAlt")}
          draggable={false}
          // Pistas al navegador para optimizar LCP: la foto del coche es el
          // hero element de la página y siempre está above-the-fold.
          // - fetchPriority="high": Chrome/Edge la priorizan en la cola de
          //   descarga incluso si el HTML aún no terminó de parsearse.
          // - decoding="async": la decodificación no bloquea el main thread,
          //   evita micro-jank al revelar.
          fetchPriority="high"
          decoding="async"
          onLoad={handleImageLoad}
          onError={handleImageError}
          className={`absolute inset-0 h-full w-full object-cover ${isWinReveal && loaded ? "animate-reveal-win" : ""}`}
          style={{
            opacity: loaded ? 1 : 0,
            transformOrigin: "center center",
            transform: isWinReveal ? undefined : `scale(${zoom})`,
            transition: isWinReveal
              ? "opacity 0.25s ease-out"
              : "transform 0.75s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease-out",
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

      {/* Viñeta decorativa: sólo cuando la imagen ya está visible. En modo
          configurador el diseño aporta su propio grano/HUD, así que se omite. */}
      {loaded && !configurator && (
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

      {/* Etiqueta narrativa de pista con mini progress bar. El texto va por
          i18n (misma clave prensa.pista que el ladillo del escenario): antes
          "Pista" iba hardcodeado y el jugador EN lo veía en español. */}
      {showLabel && loaded && (
        // Rectángulo, no píldora: sobre la foto esto es un PIE de imagen, y el
        // sistema no redondea nada. El fondo oscuro se queda (va encima de una
        // fotografía cualquiera, ahí el papel no es una opción) pero pierde la
        // forma de burbuja del tema anterior.
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded-none border border-white/20 bg-black/70 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-white tabular-nums">
            {t("prensa.pista", { n: hintIndex + 1, max: totalHints })}
          </span>
          <div className="flex gap-0.5">
            {Array.from({ length: totalHints }).map((_, i) => (
              <span
                key={i}
                className={`h-1 w-1.5 rounded-none transition-colors ${
                  i <= hintIndex ? "bg-accent" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>
      )}
      {/* Indicador de intentos: overlay discreto en la esquina inferior-derecha.
          pointer-events-none: es un rótulo sobre la foto, no un control. */}
      {bottomRight && (
        <div className="pointer-events-none absolute bottom-2 right-2 z-[6]">
          {bottomRight}
        </div>
      )}
      </div>

      {/* HUD del configurador (crosshair + grano): superpuesto al marco, fuera del
          área de imagen para que no escale. */}
      {configurator && hud}

      {/* Barra de progreso de intentos: anclada al borde inferior del marco, por
          ENCIMA de la viñeta ::after (z5) y del HUD (z7). El inset
          (left/right/bottom-2) es aire de margen; ya no hay curva de la que
          escapar (el marco es de esquina viva desde «Prensa del motor»). */}
      {configurator && bottomBar && (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-[8]">
          {bottomBar}
        </div>
      )}

      {/* REPISA: extensión del marco por debajo donde se anidan las shift
          lights de intentos. Forma parte del frame (mismo borde redondeado),
          separada de la foto por un filete sutil. Solo en partida (el caller
          pasa bottomCenter únicamente entonces). */}
      {bottomCenter && (
        <div className="flex items-center justify-center border-t border-white/[0.06] py-2.5">
          {bottomCenter}
        </div>
      )}
    </div>
  );
}
