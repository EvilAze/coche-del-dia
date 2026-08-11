// src/components/AchievementsModal.jsx
// Destino propio para los Logros personales (Colección + Rachas). Antes
// vivían dentro de "Mi Perfil"; se separan para que cada destino haga una
// sola cosa y los logros tengan sitio para respirar.
//
// Las colecciones por marca/país NO están aquí: son el Garaje (que ahora
// muestra la medalla de tier en cada tarjeta). Aquí solo hitos y rachas.

import { useEffect, useState } from "react";
import { getMyStats } from "../lib/statsService";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import Achievements from "./Achievements";

// Anillo de progreso global de logros (hitos + rachas).
function ProgressRing({ unlocked, total }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? unlocked / total : 0;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(27,23,18,0.15)" strokeWidth="3.5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          className="text-rojo"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-courier text-lg font-bold leading-none text-tinta">{unlocked}</span>
        <span className="pm-label !text-[9px] leading-none">/ {total}</span>
      </div>
    </div>
  );
}

export default function AchievementsModal({ open, onClose }) {
  const { t } = useT();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reintento, setReintento] = useState(0);
  const [progress, setProgress] = useState({ unlocked: 0, total: 0 });

  useEscape(open, onClose);

  // UN FALLO AQUÍ SE VEÍA COMO «NO TIENES NADA», que es la peor forma de
  // fallar en una pantalla de progreso.
  //
  // El `.catch` se limitaba a apagar el spinner: no registraba el error, no
  // guardaba estado de error y dejaba `stats` en null. Con eso, el cuerpo
  // montaba igualmente <Achievements stats={null}>, que calcula sin datos y
  // pinta la escalera entera a cero. O sea que a quien lleva medio año jugando
  // se le decía, con toda la seguridad del mundo, que no ha conseguido nada —
  // y sin un solo indicio de que lo que ha fallado es la carga. Mentir en
  // silencio es peor que dar un error.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setProgress({ unlocked: 0, total: 0 });
    getMyStats()
      .then(({ stats: s }) => {
        setStats(s);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[AchievementsModal] fallo cargando las estadísticas", err);
        setError(t("achievements.errorLoad"));
        setLoading(false);
      });
  }, [open, reintento]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      // Sin esto el diálogo se anunciaba solo como «diálogo». Lo pasan ya casi
      // todos los modales del proyecto; a este, al de identidad y al de acceso
      // se les había quedado sin poner.
      label={t("achievements.sectionTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden"
    >
      {/* Cabecera con anillo de progreso. */}
      <div className="flex items-center gap-4 border-b border-tinta p-5">
        <ProgressRing unlocked={progress.unlocked} total={progress.total} />
        <div className="min-w-0 flex-1">
          <h2 className="pm-title !text-2xl">{t("achievements.sectionTitle")}</h2>
          <p className="pm-body mt-0.5 text-xs">{t("achievements.modalSubtitle")}</p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {/* Cuerpo. */}
      <div className="scrollbar-premium flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="pm-body py-8 text-center text-sm">{t("common.loading")}</p>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="font-display text-sm text-rojo">{error}</p>
            <button
              type="button"
              onClick={() => setReintento((n) => n + 1)}
              className="pm-btn pm-btn--ghost mt-3 !w-auto px-6 !py-2 !text-[11px]"
            >
              {t("offline.retry")}
            </button>
          </div>
        ) : (
          <Achievements stats={stats} onProgress={setProgress} />
        )}
      </div>
    </ModalShell>
  );
}
