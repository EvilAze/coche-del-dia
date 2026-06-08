// src/components/configurator/EndScreen.jsx
// Revelado cinematográfico (port de endscreen.jsx) wired a datos reales:
//   · Banda de revelado con la foto + verdicto + marca/modelo/meta (solo si el
//     servidor reveló la identidad — en victoria; en derrota anónima se bloquea).
//   · Tabs FICHA (descripción + país/año) y COMPARTIR (cuadrícula + copiar).
//   · Cuenta atrás real al próximo coche, racha e intentos.
// La copia usa el texto de compartir de producción; las piezas críticas
// (compartir nativo/clipboard, CTA de registro para anónimos) se conservan.

import { useEffect, useRef, useState } from "react";
import { useCountdown } from "../../hooks/useCountdown";
import { useT, getCarDescription, getLocalizedCountry } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { flagImagePath } from "../../data/countries";
import { useToast } from "../Toast";
import Confetti from "../Confetti";
import { Icon, I } from "./icons";
import { useDailyStats, Distribution, Percentile } from "./dailyStats";

function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function shareGrid(guesses) {
  return guesses
    .map((g) => {
      const m = g.marca?.status === "correct" ? "🟩" : g.marca?.status === "partial" ? "🟨" : "⬛";
      const mo = g.modelo?.status === "correct" ? "🟩" : g.marca?.status === "correct" ? "🟨" : "⬛";
      const an =
        g.anio?.status === "correct" ? "🟩" : g.anio?.direction === "up" ? "🔼" : "🔽";
      return m + mo + an;
    })
    .join("\n");
}

function Stat({ k, v, accent }) {
  return (
    <div className="cdd-stat">
      <div className="cdd-mono cdd-stat-k">{k}</div>
      <div className={"cdd-stat-v" + (accent ? " accent" : "")}>{v}</div>
    </div>
  );
}

export default function EndScreen({
  won,
  car,
  guesses,
  max,
  streak,
  shareText,
  user,
  onClose,
  onOpenLogin,
}) {
  const { t, tn } = useT();
  const toast = useToast();
  const countdown = useCountdown();
  const [copied, setCopied] = useState(false);
  // Por defecto COMPARTIR: al acertar, el botón de compartir te recibe sin un
  // toque extra (el pico viral es el momento de ganar). FICHA queda a un toque.
  const [tab, setTab] = useState("compartir");
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const hasReveal = Boolean(car?.marca && car?.modelo && car?.anio);
  const attempts = guesses.length;
  const description = getCarDescription(car)?.trim();
  // Datos reales del día (un solo fetch): alimenta el percentil (COMPARTIR) y
  // la distribución de intentos (FICHA).
  const daily = useDailyStats(attempts, won);
  const grid = shareGrid(guesses);

  async function copyShare() {
    haptic.impactLight();
    try {
      let finalShareText = shareText;
      if (won && daily.betterThanPct > 0) {
        finalShareText += "\n" + t("dailyStats.betterThan", { pct: daily.betterThanPct });
      }

      if (navigator.share) { await navigator.share({ text: finalShareText }); return; }
      let ok = false;
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(finalShareText);
        ok = true;
      } else {
        ok = legacyCopy(finalShareText);
      }
      if (ok) {
        haptic.success();
        setCopied(true);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1800);
        toast.push(t("result.shareCopied"), { type: "success" });
      } else {
        toast.push(t("result.shareUnsupported"), { type: "error" });
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      haptic.error();
      toast.push(t("result.shareError"), { type: "error" });
    }
  }

  return (
    <div className="cdd-end" role="dialog" aria-modal="true">
      <div className="cdd-end-scrim" onClick={onClose} />
      <div className="cdd-end-card">
        {won && <Confetti active />}

        {/* Banda de revelado */}
        <div className="cdd-reveal">
          {car?.img && (
            <img
              src={car.img}
              alt=""
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          <div className="cdd-reveal-grad" />
          <div className="cdd-reveal-head">
            <div className={"cdd-verdict cdd-mono " + (won ? "win" : "lose")}>
              {won ? t("cdd.endWin", { n: attempts, max }) : t("cdd.endLose", { max })}
            </div>
            {hasReveal ? (
              <>
                <div className="cdd-reveal-name">
                  <span className="cdd-reveal-brand">{car.marca}</span>
                  <span className="cdd-reveal-model">{car.modelo}</span>
                </div>
                <div className="cdd-reveal-meta cdd-mono">
                  {car.pais && <img className="cdd-flag" src={flagImagePath(car.pais)} alt="" />}
                  {car.pais ? getLocalizedCountry(car.pais) : ""} · {car.anio}
                </div>
              </>
            ) : (
              <div className="cdd-reveal-meta cdd-mono">{t("cdd.lockedAnswer")}</div>
            )}
          </div>
        </div>

        {/* Tabs (solo si hay revelado que mostrar) */}
        {hasReveal && (
          <div className="cdd-end-tabs">
            {[["compartir", t("cdd.tabShare")], ["ficha", t("cdd.tabFicha")]].map(([id, lbl]) => (
              <button key={id} className={"cdd-tab cdd-mono" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {hasReveal && tab === "ficha" ? (
          <div className="cdd-end-body">
            <div className="cdd-sheet">
              {car.pais && <Stat k={t("cdd.labelOrigin")} v={getLocalizedCountry(car.pais)} />}
              <Stat k={t("cdd.labelAnio")} v={car.anio} />
            </div>
            {description && <p className="cdd-note">{description}</p>}
            <Distribution data={daily} attempts={attempts} won={won} />
          </div>
        ) : null}

        {(!hasReveal || tab === "compartir") && (
          <div className="cdd-end-body">
            <pre className="cdd-grid">{grid}</pre>
            <Percentile data={daily} won={won} />
            <button className="cdd-submit cdd-share-btn" onClick={copyShare}>
              <Icon d={I.share} size={17} /> <span>{copied ? t("cdd.copied") : t("cdd.copyResult")}</span>
            </button>
            

            {/* CTA de registro para anónimos que ganan (conserva la pieza de
                producción: no perder racha/estadísticas). */}
            {won && !user && (
              <button className="cdd-submit" onClick={onOpenLogin} style={{ marginTop: 2 }}>
                <span>{t("result.saveProgressCta")}</span>
              </button>
            )}
          </div>
        )}

        {/* Cuenta atrás */}
        <div className="cdd-next">
          <div className="cdd-mono cdd-next-k">{t("cdd.nextCar")}</div>
          <div className="cdd-next-clock cdd-mono">{countdown.formatted}</div>
        </div>
        <button className="cdd-end-close cdd-mono" onClick={onClose}>{t("cdd.seeGame")}</button>
      </div>
    </div>
  );
}
