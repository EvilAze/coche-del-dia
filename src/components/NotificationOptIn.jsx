// src/components/NotificationOptIn.jsx
// Prompt suave tras terminar una partida (pico de engagement) para ofrecer el
// recordatorio diario. Dos mundos:
//   · NATIVO (app Android): notificaciones locales (lib/notifications.js).
//   · WEB (navegador): Web Push (lib/webpush.js). Incluye anónimos.
// En iOS-no-instalado el push no existe → mostramos un hint para "añadir a
// inicio". La decisión se persiste para no volver a preguntar.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import {
  isNative,
  hasAskedOptIn as hasAskedNative,
  markAskedOptIn as markAskedNative,
  ensurePermission,
  scheduleDailyReminder,
} from "../lib/notifications";
import {
  isPushSupported,
  isIosNotInstalled,
  hasAskedOptIn as hasAskedWeb,
  markAskedOptIn as markAskedWeb,
  subscribe as webSubscribe,
} from "../lib/webpush";
import { getLocale } from "../i18n";

// Decide qué variante mostrar en el primer render (síncrono, sin parpadeo):
//   "native" | "web" | "ios-hint" | null
function initialMode() {
  if (isNative()) return hasAskedNative() ? null : "native";
  if (isPushSupported()) return hasAskedWeb() ? null : "web";
  if (isIosNotInstalled()) return hasAskedWeb() ? null : "ios-hint";
  return null;
}

export default function NotificationOptIn() {
  const { t } = useT();
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    // Coherencia ante carreras de StrictMode.
    if (isNative() && hasAskedNative()) setMode(null);
  }, []);

  if (!mode) return null;

  // --- NATIVO (comportamiento original) ---
  async function acceptNative() {
    haptic.impactLight();
    markAskedNative();
    setMode(null);
    const granted = await ensurePermission();
    if (granted) {
      await scheduleDailyReminder({
        title: t("notif.reminderTitle"),
        body: t("notif.reminderBody"),
      });
    }
  }

  // --- WEB ---
  async function acceptWeb() {
    haptic.impactLight();
    markAskedWeb();
    setMode(null);
    await webSubscribe(getLocale());
  }

  function decline() {
    haptic.impactLight();
    if (isNative()) markAskedNative();
    else markAskedWeb();
    setMode(null);
  }

  function dismissHint() {
    haptic.impactLight();
    markAskedWeb();
    setMode(null);
  }

  // iOS no instalado: solo informamos (no hay botón que funcione).
  if (mode === "ios-hint") {
    return (
      <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
        <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
          {t("notif.iosHintTitle")}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/90">
          {t("notif.iosHintBody")}
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={dismissHint}
            className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
          >
            {t("notif.webOptInDecline")}
          </button>
        </div>
      </div>
    );
  }

  const isWeb = mode === "web";
  const accept = isWeb ? acceptWeb : acceptNative;

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.07] p-4 text-left">
      <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
        {t("notif.optInTitle")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-white/90">
        {isWeb ? t("notif.webOptInBody") : t("notif.optInBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={accept}
          className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary transition hover:brightness-110 active:scale-[0.98]"
        >
          {isWeb ? t("notif.webOptInAccept") : t("notif.optInAccept")}
        </button>
        <button
          type="button"
          onClick={decline}
          className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted transition hover:text-white active:scale-[0.98]"
        >
          {isWeb ? t("notif.webOptInDecline") : t("notif.optInDecline")}
        </button>
      </div>
    </div>
  );
}
