// src/components/configurator/RankParte.jsx
// «El parte de la clasificación» del final de partida: el puesto MENSUAL del
// jugador + su movimiento vs ayer, como palanca de retorno (aversión a la
// pérdida). Solo para logueados con datos; el anónimo ya tiene su propio CTA de
// registro en el EndScreen, así que aquí devolvemos null y no duplicamos.
//
// Compartir sigue siendo el CTA principal del EndScreen: esto es un bloque
// secundario de tinta + oro viejo (el puesto es «valioso»), nunca un botón que
// compita con el de compartir.

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { track } from "../../lib/analytics";
import { rankMovement } from "../../lib/rankMovement";
import { Icon, I } from "./icons";

export default function RankParte({ rank, user, onOpenRanking }) {
  const { t, tn, dateLocale } = useT();

  // Solo logueados: al anónimo no le pintamos puesto (no tiene) y ya tiene el
  // CTA "guarda tu progreso" un poco más abajo.
  if (!user) return null;

  const mv = rankMovement(rank);

  // Mes en curso para el ladillo ("· Julio"). Capitalizado como el folio.
  const rawMonth = new Date().toLocaleDateString(dateLocale, { month: "long" });
  const month = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);

  const openRanking = () => {
    haptic.impactLight();
    // Mide la palanca: cuántas aperturas del ranking nacen del final de partida.
    track("ranking_open", { source: "end_screen" });
    onOpenRanking?.();
  };

  const Cta = (
    <button type="button" className="cdd-parte-cta" onClick={openRanking}>
      {t("parte.cta")} <Icon d={I.chevR} size={13} />
    </button>
  );

  // Logueado pero sin puesto este mes (0 victorias) → empujón a competir.
  if (mv.kind === "unranked") {
    return (
      <div className="cdd-parte">
        <div className="cdd-parte-lad">{t("parte.kicker")} · {month}</div>
        <p className="cdd-parte-nudge">{t("parte.unranked", { month })}</p>
        {Cta}
      </div>
    );
  }

  const movText =
    mv.kind === "up" ? tn("parte.up", mv.n)
    : mv.kind === "down" ? tn("parte.down", mv.n)
    : mv.kind === "hold" ? t("parte.hold")
    : t("parte.new");

  return (
    <div className="cdd-parte">
      <div className="cdd-parte-lad">{t("parte.kicker")} · {month}</div>
      <div className="cdd-parte-row">
        <span className="cdd-parte-pos">{mv.pos}º</span>
        <span className="cdd-parte-of">{t("parte.of", { total: mv.total })}</span>
      </div>
      <p className={"cdd-parte-mov cdd-parte-mov--" + mv.kind}>{movText}</p>
      {Cta}
    </div>
  );
}
