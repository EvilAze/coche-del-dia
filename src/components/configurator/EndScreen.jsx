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
import { track } from "../../lib/analytics";
import { flagImagePath } from "../../data/countries";
import { useToast } from "../Toast";
import { Icon, I } from "./icons";
import { useDailyStats, Distribution, Percentile } from "./dailyStats";
// Opt-in de recordatorio (web push / notif nativa). Antes vivía solo en
// ResultPanel (legacy, hoy solo Repesca), así que NUNCA salía tras la partida
// diaria —cuya pantalla viva es ESTA—. Lo montamos aquí, en la pestaña
// COMPARTIR (la de por defecto al ganar), que es el pico de engagement.
import NotificationOptIn from "../NotificationOptIn";
// Rejilla ✅/❌ del share: fuente única en lib/shareText (la misma que usa
// buildShareText). El preview del panel y el texto que se copia ya NO pueden
// divergir — antes era un espejo manual con la advertencia "si cambias uno,
// cambia el otro".
import { shareGrid } from "../../lib/shareText";

// Umbral para colar el percentil en el TEXTO que se comparte. Solo se incluye
// cuando es un flex de verdad (top 30%). Por debajo, "Mejor que el 40%…" es un
// anti-flex —anuncia que lo hiciste peor que la mayoría— y encima roba una línea
// en un canal concurrido. La UI (componente Percentile) lo sigue mostrando
// siempre; este recorte es solo para el chat.
const SHARE_PERCENTILE_MIN = 70;

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
  onOpenGarage,
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
      // El percentil va JUSTO ANTES del dominio (última línea), no después:
      // colgado tras el enlace parecía una nota al pie desconectada, y el
      // dominio debe cerrar el mensaje (activa el OG preview y hace de firma).
      // Versión corta del copy (betterThanShare): en el chat cada carácter
      // cuenta; la UI conserva la frase completa (betterThan).
      let finalShareText = shareText;
      if (won && daily.betterThanPct >= SHARE_PERCENTILE_MIN) {
        const lines = shareText.split("\n");
        const domain = lines.pop();
        finalShareText = [
          ...lines,
          t("dailyStats.betterThanShare", { pct: daily.betterThanPct }),
          domain,
        ].join("\n");
      }

      if (navigator.share) {
        await navigator.share({ text: finalShareText });
        // Solo resuelve si se completó (cancelar → AbortError al catch): el
        // evento cuenta comparticiones REALES, la métrica de viralidad.
        track("share", { method: "native", where: "end_screen", result: won ? "win" : "lose" });
        return;
      }
      let ok = false;
      let method = "legacy";
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(finalShareText);
        ok = true;
        method = "clipboard";
      } else {
        ok = legacyCopy(finalShareText);
      }
      if (ok) {
        haptic.success();
        setCopied(true);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1800);
        toast.push(t("result.shareCopied"), { type: "success" });
        track("share", { method, where: "end_screen", result: won ? "win" : "lose" });
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
        {/* (Confetti retirado: en el lenguaje prensa la celebración es el
            SELLO estampándose — spec §2 del rediseño.) */}

        {/* Banda de revelado con el sello del veredicto */}
        <div className="cdd-reveal">
          <div className={"prensa-sello" + (won ? "" : " tinta")} aria-hidden="true">
            {won ? t("prensa.selloWin") : t("prensa.selloLose")}
          </div>
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

        {/* Desbloqueo de cromo: cierra el bucle juego→colección JUSTO en el
            pico de dopamina (ganar). Antes el desbloqueo ocurría en silencio
            en el servidor y nada en la victoria apuntaba al garaje — la
            colección era un huérfano. Solo logueado (el anónimo no persiste
            colección; a ese ya le habla el CTA de "guardar progreso").
            DELIBERADAMENTE subordinado a COMPARTIR: tira tintada y fina, no un
            botón relleno — compartir sigue siendo el único CTA primario y la
            palanca de captación. Tappable → abre el garaje (+ evento para medir
            si el bucle realmente tira). */}
        {won && user && hasReveal && (
          <button
            type="button"
            className="cdd-unlock"
            aria-label={t("cdd.garageAria")}
            onClick={() => { haptic.impactLight(); track("garage_from_endscreen"); onOpenGarage?.(); }}
          >
            <Icon d={I.garage} size={16} />
            <span className="cdd-unlock-text">
              <span className="cdd-unlock-kicker cdd-mono">{t("cdd.unlockKicker")}</span>
              <span className="cdd-unlock-name">{car.modelo}</span>
            </span>
            <Icon d={I.chevR} size={16} className="cdd-unlock-chev" />
          </button>
        )}

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
            {/* Micro-encabezado: da contexto a la cuadrícula de cuadritos. */}
            <div className="cdd-mono cdd-grid-k">{t("cdd.yourGame")}</div>
            <pre className="cdd-grid">{grid}</pre>
            <Percentile data={daily} won={won} />
            {/* CTA primario de esta pantalla: compartir (momento viral). */}
            <button className="cdd-submit cdd-share-btn" onClick={copyShare}>
              <Icon d={I.share} size={17} /> <span>{copied ? t("cdd.copied") : t("cdd.copyResult")}</span>
            </button>

            {/* CTA de registro para anónimos que ganan (conserva la pieza de
                producción: no perder racha/estadísticas). Estilo SECUNDARIO
                (ghost): es otra clase de acción y no debe competir con compartir. */}
            {won && !user && (
              <button className="cdd-submit cdd-submit--ghost" onClick={onOpenLogin}>
                <span>{t("result.saveProgressCta")}</span>
              </button>
            )}

            {/* Recordatorio diario: se ofrece UNA vez (persiste la decisión).
                En web pide Web Push; en nativo, notif local; en iOS-no-instalado,
                el hint de "añadir a inicio". Devuelve null si ya se preguntó o no
                hay soporte, así que no molesta en cada apertura del EndScreen. */}
            <NotificationOptIn />
          </div>
        )}

        {/* Cuenta atrás */}
        <div className="cdd-next">
          <div className="cdd-mono cdd-next-k">{t("cdd.nextCar")}</div>
          <div className="cdd-next-clock cdd-mono">{countdown.formatted}</div>
        </div>

        {/* Túnel de viento: el CTA vive JUSTO bajo la cuenta atrás a propósito
            — "falta mucho para el próximo" es el momento exacto en que ofrecer
            seguir jugando. Ghost para no competir con COMPARTIR (el CTA
            primario y palanca viral). Solo logueados: el modo requiere sesión
            y el anónimo ya tiene aquí su propio CTA de registro. */}
        {user && (
          <button
            className="cdd-submit cdd-submit--ghost cdd-tunel-cta"
            onClick={() => {
              haptic.impactLight();
              track("tunel_cta", { from: "end_screen" });
              window.location.href = "/tunel";
            }}
          >
            <span>{t("cdd.tunelCta")}</span>
          </button>
        )}

        <button className="cdd-end-close cdd-mono" onClick={onClose}>{t("cdd.seeGame")}</button>
      </div>
    </div>
  );
}
