// src/components/PushToggle.jsx
// Interruptor de "avisos diarios" para el menú. Segunda oportunidad al opt-in:
// quien dijo "ahora no" (o quiere apagarlo) lo gestiona aquí. Solo se pinta si
// el navegador soporta push web (en nativo e iOS-no-instalado no aparece).

import { useEffect, useState } from "react";
import { useT, getLocale } from "../i18n";
import { haptic } from "../lib/haptics";
import { isPushSupported, isSubscribed, subscribe, unsubscribe } from "../lib/webpush";

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

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-white/90 transition hover:bg-white/5 active:scale-[0.99] disabled:opacity-50"
    >
      <span>{on ? t("notif.menuPushOn") : t("notif.menuPushOff")}</span>
      <span
        className={
          "ml-3 h-2.5 w-2.5 shrink-0 rounded-full " +
          (on ? "bg-accent shadow-[0_0_8px_#7af0c8]" : "bg-muted-foreground/30")
        }
        aria-hidden="true"
      />
    </button>
  );
}
