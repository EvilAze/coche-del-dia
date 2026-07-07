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
import { track } from "../lib/analytics";

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

  // Impresión del prompt (denominador del embudo de opt-in). Solo web/iOS: el
  // funnel que medimos es el de Web Push, no el nativo. Una vez por montaje.
  useEffect(() => {
    if (mode === "web" || mode === "ios-hint") {
      track("push_prompt_shown", { surface: mode === "ios-hint" ? "ios_hint" : "web" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    track("push_optin", { result: "accept", surface: "web" });
    markAskedWeb();
    setMode(null);
    // webSubscribe dispara push_subscribed si el permiso se concede: el hueco
    // entre "accept" y "subscribed" = permisos denegados por el navegador.
    await webSubscribe(getLocale());
  }

  function decline() {
    haptic.impactLight();
    // Solo el rechazo WEB entra en el embudo de push (el nativo es otra cosa).
    if (mode === "web") track("push_optin", { result: "decline", surface: "web" });
    if (isNative()) markAskedNative();
    else markAskedWeb();
    setMode(null);
  }

  function dismissHint() {
    haptic.impactLight();
    track("push_optin", { result: "dismiss", surface: "ios_hint" });
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
    // Recuadro de "suscripción al boletín": filete de tinta, sin tinte de
    // color. Los textos varían según el canal (web push vs. nativo).
    <div className="mb-4 border border-tinta p-4 text-left">
      <p className="pm-kicker">{t("notif.optInTitle")}</p>
      <p className="pm-body mt-2 text-sm">
        {isWeb ? t("notif.webOptInBody") : t("notif.optInBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={accept} className="pm-btn flex-1 !py-2.5 !text-xs">
          {isWeb ? t("notif.webOptInAccept") : t("notif.optInAccept")}
        </button>
        <button type="button" onClick={decline} className="pm-btn pm-btn--ghost !w-auto !py-2.5 !text-xs">
          {isWeb ? t("notif.webOptInDecline") : t("notif.optInDecline")}
        </button>
      </div>
    </div>
  );
}
