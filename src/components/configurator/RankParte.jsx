// src/components/configurator/RankParte.jsx
// EL PARTE DE LA CLASIFICACIÓN, en el panel del final de partida.
//
// Sistema «Asfalto»: una TARJETA entera que lleva a la tabla, no una sección
// con ladillo y un enlace al pie. Lo que importa al cerrar la partida es la
// noticia —«Subes 4 puestos»— y, debajo, dónde te deja: el puesto sobre el
// total y a cuánto estás del de arriba. El icono de la izquierda dice el
// sentido sin leer: tendencia en verde si subes, en rojo si bajas, el trofeo
// si te mantienes o estrenas puesto.
//
// La temporada ya no se anuncia aquí (antes iba en el ladillo y costaba una
// petición): la tabla, que es adonde lleva la tarjeta, la enseña en grande.
//
// Solo para cuentas: un anónimo no tiene fila en la tabla.

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { rankMovement } from "../../lib/rankMovement";
import { ordinal } from "../PuestoCifra";
import { Icon, I } from "./icons";

export default function RankParte({ rank, user, onOpenRanking }) {
  const { t, tn, locale } = useT();
  if (!user) return null;

  const mv = rankMovement(rank);
  const abrir = () => {
    haptic.impactLight();
    onOpenRanking?.("end_screen");
  };

  // Sin puesto todavía esta temporada: la invitación, con el mismo objeto.
  if (mv.kind === "unranked") {
    return (
      <button type="button" className="fin-tarjeta fin-fila fin-entra" onClick={abrir}>
        <span className="fin-icono"><Icon d={I.trophy} size={19} /></span>
        <span className="fin-fila-texto">
          <b>{t("parte.cta")}</b>
          <span>{t("parte.unranked")}</span>
        </span>
        <Icon d={I.chevR} size={17} className="fin-chev" />
      </button>
    );
  }

  const titulo =
    mv.kind === "up" ? tn("parte.up", mv.n)
    : mv.kind === "down" ? tn("parte.down", mv.n)
    : mv.kind === "hold" ? t("parte.hold")
    : t("parte.new");
  const arriba = ordinal(mv.pos - 1, locale);
  const distancia =
    mv.pos === 1
      ? t("parte.lider")
      : rank?.gap === 0
      ? t("parte.empate", { pos: arriba })
      : rank?.gap > 0
      ? tn("parte.distancia", rank.gap, { pos: arriba })
      : null;
  const puesto = `${ordinal(mv.pos, locale)} ${t("parte.of", { total: mv.total })}`;
  const icono = mv.kind === "up" ? I.trendUp : mv.kind === "down" ? I.trendDown : I.trophy;

  return (
    <button type="button" className="fin-tarjeta fin-fila fin-entra" onClick={abrir} aria-label={`${titulo}. ${puesto}${distancia ? `. ${distancia}` : ""}. ${t("parte.cta")}`}>
      <span className={"fin-icono" + (mv.kind === "up" ? " verde" : mv.kind === "down" ? " rojo" : "")}>
        <Icon d={icono} size={19} />
      </span>
      <span className="fin-fila-texto">
        <b>{titulo}</b>
        <span>{distancia ? `${puesto} · ${distancia}` : puesto}</span>
      </span>
      <Icon d={I.chevR} size={17} className="fin-chev" />
    </button>
  );
}
