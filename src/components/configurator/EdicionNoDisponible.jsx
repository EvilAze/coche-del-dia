// src/components/configurator/EdicionNoDisponible.jsx
// Lo que se ve cuando la carga inicial del coche del día falla.
//
// Por qué existe: sin esto, un fallo de red dejaba la pantalla en una cáscara
// vacía para siempre. `useGame` apagaba isLoading en su `finally` pero `car`
// seguía en null, así que dataReady era false y el Configurator se limitaba a
// ocultar secciones — sin cartel, sin explicación y sin manera de reintentar.
// En la app Android ese es el caso NORMAL de abrir sin cobertura: el bundle
// viaja dentro del APK, así que la app arranca instantánea y perfecta… y luego
// no tiene absolutamente nada que enseñar.
//
// Dos mensajes, no uno: "no hay conexión" y "no hemos podido cargar" piden
// cosas distintas al lector (mira tu red / espera y reintenta). Distinguirlos
// cuesta un booleano y evita mandar a alguien a revisar el wifi cuando el que
// está caído es el servidor.
//
// Mantiene la voz del tema: el fallo es una edición que no ha llegado al
// quiosco, no un stack trace.

import { useT } from "../../i18n";
import { useOnline } from "../../hooks/useOnline";
import { haptic } from "../../lib/haptics";

export default function EdicionNoDisponible({ onRetry, isRetrying = false }) {
  const { t } = useT();
  const online = useOnline();

  function reintentar() {
    haptic.impactLight();
    onRetry?.();
  }

  return (
    <section
      className="prensa-area-foto flex flex-col items-center justify-center gap-3 py-10 text-center"
      // aria-live: si el reintento automático (vuelta de la conexión) cambia el
      // mensaje, quien usa lector de pantalla se entera sin tener que rastrear.
      aria-live="polite"
    >
      <p className="pm-kicker m-0">{t("offline.kicker")}</p>
      <p className="pm-title m-0">
        {online ? t("offline.titleServer") : t("offline.titleOffline")}
      </p>
      <p className="pm-body m-0 max-w-[38ch]">
        {online ? t("offline.bodyServer") : t("offline.bodyOffline")}
      </p>

      <button
        type="button"
        onClick={reintentar}
        disabled={isRetrying}
        className="pm-btn pm-btn--ghost mt-2 !w-auto px-8 disabled:opacity-60"
      >
        {isRetrying ? t("offline.retrying") : t("offline.retry")}
      </button>

      {/* Solo sin conexión: avisamos de que no hace falta quedarse vigilando el
          botón, porque useGame reintenta solo al volver la red. */}
      {!online && (
        <p className="pm-body m-0 !text-[12px] opacity-70">{t("offline.autoRetry")}</p>
      )}
    </section>
  );
}
