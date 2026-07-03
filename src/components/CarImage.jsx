// src/components/CarImage.jsx
import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptics";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import { apiUrl } from "../lib/apiUrl";

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
  // Desenfoque progresivo del Túnel de viento (px CSS). Se COMPONE sobre la
  // imagen ya horneada por el servidor con el sigma del último intento (ver
  // src/lib/blur.js): cada intento fallido baja blurPx y la foto "enfoca".
  // A diferencia de `blurred` (candado fijo de anónimo-perdedor), esto es
  // mecánica de juego: anima con transition y dispara el hint-flash.
  blurPx = 0,
  overlay = null,
  showHintLabel = true,
  // Nodo opcional anidado en el borde inferior-centro de la imagen (lo usan
  // las shift lights de intentos como "readout"). Decorativo: pointer-events
  // off para no interferir con el tap-to-ampliar.
  bottomCenter = null,
  // Nodo opcional anclado en la esquina inferior-DERECHA de la imagen (lo usa
  // el indicador de intentos del juego principal). La izquierda la ocupa el
  // botón de ampliar. Overlay discreto y pointer-events off; como la imagen es
  // tap-to-ampliar, si molesta se ve sin interrupciones con un solo clic.
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
  // seguridad con el servidor) quedan intactos. Desactiva la viñeta, el
  // tap-to-ampliar y la etiqueta de pista propios del diseño anterior.
  configurator = false,
  hud = null,
  // Barra de progreso de intentos anclada al BORDE INFERIOR de la imagen (dentro
  // del marco), por encima de la viñeta ::after que ya oscurece esa franja para
  // contener carrocerías claras → legible sobre cualquier coche. pointer-events
  // off: el tap-para-ampliar sigue activo debajo y el lightbox NO la pinta, así
  // que un toque muestra la foto limpia. Solo en modo configurador.
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
  // dispara al cambiar el `zoom` CSS (cada intento baja el scale) o el
  // `blurPx` (en el Túnel cada intento enfoca en lugar de alejar).
  // El háptico (tap ligerísimo) acompaña al flash para reforzar la sensación
  // de "algo se ha revelado" — coherente con el shake del intento erróneo
  // que YA disparó haptic.warning() en GuessForm; aquí es el contrapunto
  // positivo del mismo gesto.
  const prevBlurRef = useRef(blurPx);
  useEffect(() => {
    const changed =
      prevZoomRef.current !== zoom || prevBlurRef.current !== blurPx;
    if (loaded && changed && status === "playing") {
      setFlashKey((k) => k + 1);
      haptic.impactLight();
    }
    prevZoomRef.current = zoom;
    prevBlurRef.current = blurPx;
  }, [zoom, blurPx, status, loaded]);

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

  // Tap-to-ampliar: la imagen se puede abrir en grande (lightbox) al MISMO
  // nivel de zoom del intento. NO revela más coche (mismo src + mismo
  // scale(zoom)), solo facilita la vista. Excluida cuando está bloqueada/
  // borrosa (anónimo que perdió) o aún sin cargar.
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  // Tap-para-ampliar disponible también en el configurador (toda la foto es
  // tappable). El HUD va con pointer-events:none, así que el toque pasa al botón
  // de zoom de abajo; solo ocultamos el icono de esquina en modo configurador
  // para que no choque visualmente con el HUD (ver más abajo).
  // Con blur de juego activo (blurPx > 0) el lightbox queda deshabilitado: su
  // img interna no replica el filter CSS, así que ampliarla mostraría el
  // nivel de enfoque del último intento — un salto de pistas gratis. En el
  // último intento (blurPx = 0) vuelve a estar disponible sin riesgo.
  const canExpand =
    loaded && !blurred && !(blurPx > 0) && Boolean(src) && status === "playing";
  useEscape(expanded, () => setExpanded(false));

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
          : `
        relative mb-3 mt-4 mx-auto w-full overflow-hidden rounded-xl
        border border-border bg-bg-tertiary shadow-md shadow-black/40
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
          alt="Coche del día"
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
            // La transición de filter da el efecto "focus pull" del Túnel al
            // bajar blurPx tras cada intento; inocua en el resto de modos
            // (filter estático).
            transition: isWinReveal
              ? "opacity 0.25s ease-out"
              : "transform 0.75s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease-out, filter 0.75s cubic-bezier(0.4,0,0.2,1)",
            filter: blurred
              ? "blur(18px) saturate(0.85)"
              : blurPx > 0
              ? `blur(${blurPx}px)`
              : undefined,
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

      {/* Etiqueta narrativa de pista con mini progress bar */}
      {showLabel && loaded && (
        <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded-full border border-border bg-black/70 px-3 py-1.5">
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
      {/* Capa clicable para ampliar: cubre la imagen (los usuarios ya intentan
          tocarla). Transparente salvo el icono de "ampliar" en una esquina.
          Solo cuando se puede ampliar (cargada y no bloqueada). */}
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={t("app.enlargeImage")}
          className="group absolute inset-0 z-[5] cursor-zoom-in"
        >
          {/* En configurador no pintamos el icono de esquina (chocaría con el
              HUD "· INTENTO" abajo-izquierda): toda la foto es tappable y el
              encuadre de visor ya invita a tocarla. En el resto de modos sí. */}
          {!configurator && (
            <span className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/70 transition group-hover:border-accent/60 group-hover:text-accent">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
              </svg>
            </span>
          )}
        </button>
      )}

      {/* Indicador de intentos: overlay discreto en la esquina inferior-derecha
          (la izquierda la ocupa el botón de ampliar). Mismo lenguaje de "chip"
          que ese botón → integrado con los controles sobre la imagen.
          pointer-events-none: el tap-para-ampliar sigue activo debajo. */}
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
          ENCIMA de la viñeta ::after (z5) y del HUD (z7). pointer-events:none para
          no robar el tap-para-ampliar. El inset (left/right/bottom-2) la mantiene
          fuera de la curva de las esquinas redondeadas, que el marco recorta. */}
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

      {/* Lightbox: mismo recorte (src + scale(zoom)) en grande → MISMO nivel de
          zoom del intento, sin revelar más. position:fixed cubre el viewport
          aunque el contenedor tenga overflow-hidden. */}
      {expanded && (
        <div
          className="scrim-flat fixed inset-0 z-[120] flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t("app.enlargeImage")}
        >
          <div
            className={
              configurator
                ? // MISMA proporción que el escenario → mismo recorte, sin revelar
                  // más coche (coherencia de dificultad). Tamaño en la clase CSS.
                  "cdd-lightbox-frame relative overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
                : "relative aspect-[4/3] w-full max-w-[min(92vw,calc(92vh*4/3))] overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <picture>
              {isApiProxy && (
                <source
                  type="image/avif"
                  srcSet={`${proxBase}&f=avif&w=1280 1280w, ${proxBase}&f=avif&w=1920 1920w`}
                  sizes="92vw"
                />
              )}
              {isApiProxy && (
                <source
                  type="image/webp"
                  srcSet={`${proxBase}&f=webp&w=1280 1280w, ${proxBase}&f=webp&w=1920 1920w`}
                  sizes="92vw"
                />
              )}
              <img
                src={isApiProxy ? `${proxBase}&f=jpeg&w=1920` : src}
                alt="Coche del día"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
              />
            </picture>

            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t("common.close")}
              className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/80 transition hover:border-accent/60 hover:text-accent active:scale-90"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
