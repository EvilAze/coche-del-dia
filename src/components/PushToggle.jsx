// src/components/PushToggle.jsx
// Botón-icono de "avisos diarios" para la barra de acciones del header (junto a
// garaje/ranking). Segunda oportunidad al opt-in: quien dijo "ahora no" (o
// quiere apagarlo) lo gestiona aquí. Solo se pinta si el navegador soporta push
// web (en nativo e iOS-no-instalado devuelve null → no aparece).
//
// Coherente con los otros iconos del header (h-11 w-11, SVG currentColor). El
// ESTADO va por color + punto: activado = campana en acento menta con punto;
// desactivado = campana muted. Replica el estilo iconBtn de HeaderSandwich
// (no exportado) para ser autocontenido.

import { useEffect, useState } from "react";
import { useT, getLocale } from "../i18n";
import { haptic } from "../lib/haptics";
import { isPushSupported, isSubscribed, subscribe, unsubscribe } from "../lib/webpush";

// Campana estilo line-icon, mismo grosor/tamaño que GarageIcon/PodiumIcon.
function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function PushToggle() {
  const { t } = useT();
  const supported = isPushSupported();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    isSubscribed().then(setOn);
  }, [supported]);

  if (!supported) return null;

  async function toggle() {
    if (busy) return;
    haptic.impactLight();
    setBusy(true);
    try {
      if (on) {
        await unsubscribe();
        setOn(false);
      } else {
        const ok = await subscribe(getLocale());
        setOn(ok);
      }
    } finally {
      setBusy(false);
    }
  }

  const label = on ? t("notif.menuPushOn") : t("notif.menuPushOff");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={
        // Réplica de iconBtn (HeaderSandwich) + estado activo en acento.
        "focus-ring relative flex h-11 w-11 items-center justify-center rounded-full " +
        "transition-colors duration-200 hover:bg-accent/15 hover:text-accent active:scale-90 " +
        "disabled:opacity-50 " +
        (on ? "text-accent" : "text-muted")
      }
    >
      <BellIcon />
      {on && (
        // Punto de estado "activado": acento menta con glow, anclado al hombro
        // del icono (mismo lenguaje que el dot de alerta del garaje).
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_6px_#7af0c8] ring-2 ring-[#0d0c0a]"
        />
      )}
    </button>
  );
}
