// src/components/configurator/PhotoPeek.jsx
// El «recorte»: miniatura flotante de la foto del día en lenguaje prensa.
// Aparece cuando el escenario sale del viewport DURANTE la partida (p.ej. al
// enfocar marca/modelo/año en móvil: el auto-scroll + teclado expulsan la foto
// justo cuando el jugador decide, y elegir sin ver la foto es jugar a ciegas —
// auditoría UX 2026-07: la retirada del peek en el rediseño v0 dejó este hueco
// sin cubrir). Tap = cerrar teclado y volver al escenario.
//
// SEGURIDAD (regla 5, no revelar de más): mismo `src` (ya recortado por el
// servidor) + mismo `scale(zoom)` CSS + marco 4:3 (la MISMA proporción que
// .cdd-stage-frame; si el escenario cambia de formato, este marco cambia con
// él) = exactamente los MISMOS píxeles que ve el jugador en el intento actual,
// solo que en pequeño.
//
// CACHÉ: el <picture> replica BYTE A BYTE el srcset/sizes del CarImage
// principal (mismo criterio que la regla 6 middleware↔CarImage): así el
// navegador resuelve a la MISMA URL que ya descargó para el escenario y la
// miniatura sale de caché — cero red extra. Si cambias el <picture> de
// CarImage, cambia este igual. apiUrl() absolutiza en nativo por la misma
// razón que allí: el <img> no pasa por el shim de fetch.

import { useT } from "../../i18n";
import { apiUrl } from "../../lib/apiUrl";

export default function PhotoPeek({ src, zoom, onClick }) {
  const { t } = useT();
  const isApiProxy = typeof src === "string" && src.startsWith("/api/");
  const proxBase = isApiProxy ? apiUrl(src) : src;

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
            srcSet={`${proxBase}&f=avif&w=640 640w, ${proxBase}&f=avif&w=1280 1280w, ${proxBase}&f=avif&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        {isApiProxy && (
          <source
            type="image/webp"
            srcSet={`${proxBase}&f=webp&w=640 640w, ${proxBase}&f=webp&w=1280 1280w, ${proxBase}&f=webp&w=1920 1920w`}
            sizes="(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px"
          />
        )}
        <img
          src={isApiProxy ? `${proxBase}&f=jpeg&w=1280` : src}
          srcSet={
            isApiProxy
              ? `${proxBase}&f=jpeg&w=640 640w, ${proxBase}&f=jpeg&w=1280 1280w, ${proxBase}&f=jpeg&w=1920 1920w`
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
