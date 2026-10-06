// src/components/Puntuacion.jsx
// Las dos piezas que explican la puntuación: la curva de puntos por intento y
// la escalera del bonus de racha. Las comparten «Cómo se juega» (su tercer
// paso) y «Cómo se puntúa» (la ayuda de la clasificación), para que las dos
// pantallas digan lo mismo con el mismo dibujo.
import { useT } from "../i18n";
import { PUNTOS_POR_INTENTO, BONUS_RACHA } from "../lib/puntos";
import { Icon, I } from "./configurator/icons";

// Barras proporcionales a los puntos: la del primer intento en tinta y las
// demás apagándose, que es lo que la curva cuenta — cuanto antes, más.
export function TablaPuntos({ animada = false }) {
  const { t } = useT();
  const max = PUNTOS_POR_INTENTO[0];
  return (
    <div className={"pun-tabla" + (animada ? " animada" : "")}>
      <span className="pun-kicker">{t("howto.puntosKicker")}</span>
      {PUNTOS_POR_INTENTO.map((pts, i) => (
        <div key={i} className={`pun-fila n${i + 1}`}>
          <span className="pun-k">{i + 1}</span>
          <span className="pun-barra">
            <i style={{ width: `${(pts / max) * 100}%` }} />
          </span>
          <span className="pun-v">{pts}</span>
        </div>
      ))}
    </div>
  );
}

// La escalera de la racha: tres peldaños, el último en oro (es el que vale).
export function EscaleraRacha() {
  const { t } = useT();
  return (
    <div className="pun-racha">
      {BONUS_RACHA.map(({ dias, bonus }, i) => (
        <span key={dias} className={`pun-peldano p${i + 1}`}>
          <span className="pun-dias">
            <Icon d={I.flame} size={12} />
            {i === BONUS_RACHA.length - 1 ? t("howto.diasOMas", { n: dias }) : t("howto.diasN", { n: dias })}
          </span>
          <b>+{bonus}</b>
        </span>
      ))}
    </div>
  );
}
