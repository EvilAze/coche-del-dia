// src/components/NotificationOptIn.jsx
// Prompt suave (solo nativo) que aparece UNA vez tras terminar una partida
// para ofrecer el recordatorio diario. No se pide permiso al abrir la app
// (intrusivo); se pide aquí, en el pico de engagement. La elección se persiste
// (markAskedOptIn) para no volver a preguntar. En web devuelve null.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import {
  isNative,
  hasAskedOptIn,
  markAskedOptIn,
  ensurePermission,
  scheduleDailyReminder,
} from "../lib/notifications";

export default function NotificationOptIn() {
  const { t } = useT();
  // Decisión inicial síncrona: solo se muestra en nativo y si no se preguntó ya.
  const [visible, setVisible] = useState(() => isNative() && !hasAskedOptIn());

  // Si por carrera (StrictMode) cambiara, mantenemos coherencia.
  useEffect(() => {
    if (isNative() && hasAskedOptIn()) setVisible(false);
  }, []);

  if (!visible) return null;

  async function accept() {
    haptic.impactLight();
    markAskedOptIn();
    setVisible(false);
    const granted = await ensurePermission();
    if (granted) {
      await scheduleDailyReminder({
        title: t("notif.reminderTitle"),
        body: t("notif.reminderBody"),
      });
    }
  }

  function decline() {
    haptic.impactLight();
    markAskedOptIn();
    setVisible(false);
  }

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
      <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
        {t("notif.optInTitle")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-white/90">
        {t("notif.optInBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={accept}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary transition hover:brightness-110 active:scale-[0.98]"
        >
          {t("notif.optInAccept")}
        </button>
        <button
          type="button"
          onClick={decline}
          className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
        >
          {t("notif.optInDecline")}
        </button>
      </div>
    </div>
  );
}
