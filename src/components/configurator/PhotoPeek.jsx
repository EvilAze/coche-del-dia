// src/components/configurator/PhotoPeek.jsx
// Miniatura flotante de la foto del día. Aparece cuando el escenario sale del
// viewport DURANTE la partida (p.ej. al enfocar marca/modelo/año en móvil: el
// auto-scroll + teclado expulsan la foto justo cuando el jugador decide, y
// elegir sin ver la foto es jugar a ciegas — auditoría UX #7). Tap = cerrar
// teclado y volver al escenario.
//
// SEGURIDAD (regla 5, no revelar de más): mismo patrón que el lightbox de
// CarImage — mismo `src` (ya recortado por el servidor) + mismo `scale(zoom)`
// CSS + marco 1:1 = exactamente los MISMOS píxeles que ve el jugador en el
// intento actual, solo que en pequeño. Ni un píxel nuevo.
//
// CACHÉ: el <picture> replica BYTE A BYTE el srcset/sizes del CarImage
// principal (mismo criterio que la regla 6 middleware↔CarImage): así el
// navegador resuelve a la MISMA URL que ya descargó para el escenario y la
// miniatura sale de caché — cero red extra. Si cambias el <picture> de
// CarImage, cambia este igual.

import { useT } from "../../i18n";

export default function PhotoPeek({ src, zoom, onClick }) {
  const { t } = useT();
  const isApiProxy = typeof src === "string" && src.startsWith("/api/");

  if (!src) return null;

  return (
    <button
      type="button"
      className="cdd-peek"
      aria-label={t("cdd.peekAria")}
      title={t("cdd.peekAria")}
      onClick={onClick}
    >
      <picture>
        {isApiProxy && (
          <source
            type="image/avif"
            srcSet={`${src}&f=avif&w=640 640w, ${src}&f=avif&w=1280 1280w, ${src}&f=avif&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        {isApiProxy && (
          <source
            type="image/webp"
            srcSet={`${src}&f=webp&w=640 640w, ${src}&f=webp&w=1280 1280w, ${src}&f=webp&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        <img
          src={isApiProxy ? `${src}&f=jpeg&w=1280` : src}
          srcSet={
            isApiProxy
              ? `${src}&f=jpeg&w=640 640w, ${src}&f=jpeg&w=1280 1280w, ${src}&f=jpeg&w=1920 1920w`
              : undefined
          }
          sizes={isApiProxy ? "(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px" : undefined}
          // alt vacío: es un duplicado decorativo de la foto principal; el
          // botón ya se anuncia con su aria-label ("volver a la foto").
          alt=""
          draggable={false}
          decoding="async"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        />
      </picture>
    </button>
  );
}
