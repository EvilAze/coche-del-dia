// src/components/FaldonApp.jsx
// EL FALDÓN DE LA EDICIÓN ANDROID. Único sitio de la web donde se ofrece la app.
//
// DÓNDE: al final del pliego del resultado, justo DEBAJO de la cuenta atrás.
// El renglón de encima acaba de decir "próximo coche en 07:41:12", o sea
// "vuelve mañana": es el único momento de la web en que ofrecer un icono en la
// pantalla de inicio es la consecuencia de lo que estás leyendo y no un anuncio
// interrumpiendo. Por eso no está en la cabecera (taparía la fotografía, que es
// el juego) ni en un modal de bienvenida (se lo comería quien aún no ha jugado).
//
// A QUIÉN: lo decide `debeOfrecerFaldon()` — Android en navegador, tres días
// jugados y sin rechazo previo. El razonamiento de cada condición está en
// lib/edicionApp.js.
//
// FORMA: el mismo recuadro de "suscripción al boletín" que NotificationOptIn
// (filete de tinta, kicker rojo, cuerpo en Fraunces). Deliberadamente NO parece
// una tarjeta de tienda de aplicaciones: ni icono de la app, ni estrellas, ni
// captura. En este lenguaje una edición nueva se anuncia con tipografía.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { track } from "../lib/analytics";
import { debeOfrecerFaldon, marcarFaldonDescartado, urlPlay } from "../lib/edicionApp";

const SURFACE = "faldon_final";

export default function FaldonApp() {
  const { t } = useT();
  // Decisión en el primer render (síncrona, sin parpadeo): igual que
  // NotificationOptIn, para que no aparezca un bloque a mitad de lectura.
  const [visible, setVisible] = useState(debeOfrecerFaldon);

  // Denominador del embudo: impresiones → clics. Una vez por montaje.
  useEffect(() => {
    if (visible) track("app_promo_shown", { surface: SURFACE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  function instalar() {
    haptic.impactLight();
    track("app_promo_click", { surface: SURFACE });
    // No marcamos descarte: si vuelve sin instalar, el faldón sigue ahí. Lo que
    // cierra el faldón para siempre es un "no", no un "sí" a medias.
    window.open(urlPlay(SURFACE), "_blank", "noopener,noreferrer");
  }

  function descartar() {
    haptic.impactLight();
    track("app_promo_dismiss", { surface: SURFACE });
    marcarFaldonDescartado();
    setVisible(false);
  }

  return (
    <div className="mb-4 border border-tinta p-4 text-left">
      <p className="pm-kicker">{t("app.promoTitle")}</p>
      <p className="pm-body mt-2 text-sm">{t("app.promoBody")}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={instalar} className="pm-btn flex-1 !py-2.5 !text-xs">
          {t("app.promoCta")}
        </button>
        <button
          type="button"
          onClick={descartar}
          className="pm-btn pm-btn--ghost !w-auto !py-2.5 !text-xs"
        >
          {t("app.promoDecline")}
        </button>
      </div>
    </div>
  );
}
