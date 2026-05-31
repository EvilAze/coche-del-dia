// src/components/AchievementsModal.jsx
// Destino propio para los Logros personales (Colección + Rachas). Antes
// vivían dentro de "Mi Perfil"; se separan para que cada destino haga una
// sola cosa y los logros tengan sitio para respirar.
//
// Las colecciones por marca/país NO están aquí: son el Garaje (que ahora
// muestra la medalla de tier en cada tarjeta). Aquí solo hitos y rachas.

import { useEffect, useState } from "react";
import { getMyStats } from "../hooks/useStats";
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
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          className="text-accent"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-lg leading-none text-accent">{unlocked}</span>
        <span className="text-[9px] leading-none text-muted">/ {total}</span>
      </div>
    </div>
  );
}

export default function AchievementsModal({ open, onClose }) {
  const { t } = useT();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ unlocked: 0, total: 0 });

  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setProgress({ unlocked: 0, total: 0 });
    getMyStats()
      .then(({ stats: s }) => {
        setStats(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [open]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      panelClassName="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl"
    >
      {/* Cabecera con anillo de progreso. */}
      <div className="flex items-center gap-4 border-b border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-5">
        <ProgressRing unlocked={progress.unlocked} total={progress.total} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl tracking-widest text-white">
            {t("achievements.sectionTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {t("achievements.modalSubtitle")}
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {/* Cuerpo. */}
      <div className="scrollbar-premium flex-1 overflow-y-auto p-5">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">{t("common.loading")}</p>
        ) : (
          <Achievements stats={stats} onProgress={setProgress} />
        )}
      </div>
    </ModalShell>
  );
}
