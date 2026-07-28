// src/components/configurator/RankParte.jsx
// «El parte de la clasificación» del final de partida: el puesto del jugador en la
// TEMPORADA en curso + su movimiento vs ayer, como palanca de retorno (aversión a
// la pérdida). Solo para logueados con datos; el anónimo ya tiene su propio CTA de
// registro en el EndScreen, así que aquí devolvemos null y no duplicamos.
//
// Compartir sigue siendo el CTA principal del EndScreen: esto es un bloque
// secundario de tinta + oro viejo (el puesto es «valioso»), nunca un botón que
// compita con el de compartir.
//
// El countdown de cierre vive en el banner del modal de ranking (al que apunta el
// CTA), no aquí: el parte es un empujón compacto y no queremos duplicar la cuenta.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { rankMovement } from "../../lib/rankMovement";
import { getCurrentSeason } from "../../lib/statsService";
import PuestoCifra, { ordinal } from "../PuestoCifra";
import { Icon, I } from "./icons";

export default function RankParte({ rank, user, onOpenRanking }) {
  const { t, tn, locale } = useT();
  // Temporada activa para el ladillo (tema). La pedimos aquí para no arrastrar el
  // prop por EndScreen; es una lectura barata de la tabla pública `seasons`.
  const [season, setSeason] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getCurrentSeason()
      .then((s) => {
        if (!cancelled) setSeason(s);
      })
      .catch(() => {
        if (!cancelled) setSeason(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Solo logueados: al anónimo no le pintamos puesto (no tiene) y ya tiene el CTA
  // "guarda tu progreso" un poco más abajo.
  if (!user) return null;

  const mv = rankMovement(rank);

  // Ladillo: el tema de la temporada (o solo el kicker mientras carga / sin
  // temporada). Sustituye al mes que se mostraba antes.
  const label = season ? (locale === "en" ? season.label_en : season.label_es) : null;
  const lad = label ? `${t("parte.kicker")} · ${label}` : t("parte.kicker");

  const openRanking = () => {
    haptic.impactLight();
    // El `source` lo emite el ÚNICO track de openRanking (App.jsx). Antes se
    // disparaba también aquí, así que cada apertura desde el final de partida
    // contaba dos veces y la comparación entre orígenes salía sesgada.
    onOpenRanking?.("end_screen");
  };

  const Cta = (
    <button type="button" className="cdd-parte-cta" onClick={openRanking}>
      {t("parte.cta")} <Icon d={I.chevR} size={13} />
    </button>
  );

  // Logueado pero sin puesto esta temporada (0 victorias) → empujón a competir.
  if (mv.kind === "unranked") {
    return (
      <div className="cdd-parte">
        <div className="cdd-parte-lad">{lad}</div>
        <p className="cdd-parte-nudge">{t("parte.unranked")}</p>
        {Cta}
      </div>
    );
  }

  const movText =
    mv.kind === "up" ? tn("parte.up", mv.n)
    : mv.kind === "down" ? tn("parte.down", mv.n)
    : mv.kind === "hold" ? t("parte.hold")
    : t("parte.new");

  // La distancia al de arriba: el movimiento cuenta lo que YA pasó, esto cuenta
  // lo que falta. Es el gancho de vuelta — «a 3 puntos del 6º» son dos partidas.
  // Llega null contra una base de datos sin la migración de la distancia, y
  // entonces el parte se queda como estaba.
  const arriba = ordinal(mv.pos - 1, locale);
  const distancia =
    mv.pos === 1
      ? t("prensa.fajaLider")
      : rank?.gap === 0
      ? t("prensa.fajaEmpate", { pos: arriba })
      : rank?.gap > 0
      ? tn("prensa.fajaDistancia", rank.gap, { pos: arriba })
      : null;

  return (
    <div className="cdd-parte">
      <div className="cdd-parte-lad">{lad}</div>
      <div className="cdd-parte-row">
        {/* El mismo marcador que la faja de portada: al cerrar el periódico se
            ve exactamente el objeto que se vio al abrirlo. */}
        <PuestoCifra pos={mv.pos} total={mv.total} size="xl" />
      </div>
      <p className={"cdd-parte-mov cdd-parte-mov--" + mv.kind}>{movText}</p>
      {distancia && <p className="cdd-parte-dist">{distancia}</p>}
      {Cta}
    </div>
  );
}
