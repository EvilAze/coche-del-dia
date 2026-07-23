import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorFallback from "./components/ErrorFallback";
import { ToastProvider } from "./components/Toast";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";
import { reportWebVitals } from "./lib/webVitals";
import { installApiFetchShim } from "./lib/apiUrl";
import { Capacitor } from "@capacitor/core";
import { rearmIfEnabled } from "./lib/notifications";
import { initNativeAuth } from "./lib/nativeAuth";
import { hideSplashWhenReady } from "./lib/splash";
import { reminderCopy } from "./lib/reminderCopy";
import { t, tn } from "./i18n";

// Inicializar Sentry ANTES de cualquier render. Sin DSN configurado
// (VITE_SENTRY_DSN), es no-op total — dev local sigue funcionando con
// console.error como hoy. Con DSN, los errores no manejados llegan al
// dashboard de Sentry.
initSentry();
// En la app Android (Capacitor) reescribe las rutas /api relativas al dominio
// de producción. En web es no-op.
installApiFetchShim();

// Solo nativo (Capacitor): re-armar el recordatorio si el permiso ya está
// concedido, y enganchar el botón físico "atrás" de Android.
if (Capacitor.isNativePlatform()) {
  // Inicializa el plugin de login nativo (idempotente; no-op sin WEB_CLIENT_ID).
  initNativeAuth().catch(() => {});

  // Racha 0 a propósito: aquí todavía no sabemos la del usuario (la trae App
  // tras hablar con el servidor), así que va el copy genérico. App vuelve a
  // re-armar con el copy de racha en cuanto la tiene. reminderCopy aporta
  // también el nombre del canal de Android, que es lo que ve el usuario en los
  // ajustes de notificaciones del móvil.
  rearmIfEnabled(reminderCopy(t, tn, 0)).catch(() => {});

  import("@capacitor/app").then(({ App: CapApp }) => {
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapApp.exitApp();
    });
  });
}

// Empezar a recolectar Core Web Vitals (LCP/CLS/INP/FCP/TTFB) y mandarlos
// a Umami. Es seguro llamar antes de createRoot: web-vitals se suscribe
// a eventos del browser, no toca el DOM.
reportWebVitals();

// El usuario normal solo carga <App />. Las rutas secundarias
// (admin-tools, repesca, privacidad) se piden bajo demanda para no engordar
// el bundle inicial.
const Repesca = lazy(() => import("./Repesca"));
const Privacidad = lazy(() => import("./Privacidad"));
const AdminTools = lazy(() => import("./admin/AdminTools"));

const { pathname, search } = window.location;

// Herramientas internas unificadas. /admin-tools es la ruta canónica.
// Las rutas viejas (/admin/edit-car, /admin/add-car, /preview) cargan
// el mismo shell con el tab apropiado preseleccionado — así no se rompen
// los bookmarks que tengamos.
const isAdminTools =
  pathname.startsWith("/admin-tools") ||
  /(\?|&)admin-tools(=|&|$)/.test(search);
const isLegacyEditCar =
  pathname.startsWith("/admin/edit-car") ||
  /(\?|&)admin-edit-car(=|&|$)/.test(search);
const isLegacyAddCar =
  pathname.startsWith("/admin/add-car") ||
  /(\?|&)admin-add-car(=|&|$)/.test(search);
const isLegacyPreview =
  pathname.startsWith("/preview") || /(\?|&)preview(=|&|$)/.test(search);

function legacyTab() {
  if (isLegacyEditCar) return "edit";
  if (isLegacyAddCar) return "add";
  if (isLegacyPreview) return "preview";
  return null;
}

// Modo Repesca: el usuario llega aquí desde el Garaje tras confirmar el
// uso de su repesca diaria. La página recoge ?id=<carId> de la query.
const isRepesca =
  pathname.startsWith("/repesca") || /(\?|&)repesca(=|&|$)/.test(search);

// Página pública de Política de Privacidad. Requerida para la pantalla
// de consentimiento de Google OAuth y para conformidad básica.
// Aceptamos también /privacy y /politica-de-privacidad como aliases por
// si los enlaza desde fuera con esos slugs.
const isPrivacy =
  pathname.startsWith("/privacidad") ||
  pathname.startsWith("/privacy") ||
  pathname.startsWith("/politica-de-privacidad");

const isAnyAdminTools =
  isAdminTools || isLegacyEditCar || isLegacyAddCar || isLegacyPreview;

// App va eager (la ruta principal); el resto pasa por Suspense para no
// quedarse en blanco mientras descarga su chunk.
function pickRoute() {
  if (isAnyAdminTools) return <AdminTools defaultTab={legacyTab()} />;
  if (isRepesca) return <Repesca />;
  if (isPrivacy) return <Privacidad />;
  return <App />;
}

const isMainApp = !(
  isAnyAdminTools ||
  isRepesca ||
  isPrivacy
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <ToastProvider>
        {isMainApp ? pickRoute() : <Suspense fallback={null}>{pickRoute()}</Suspense>}
      </ToastProvider>
    </SentryErrorBoundary>
  </React.StrictMode>
);

// Solo nativo: retirar el splash cuando el primer frame esté pintado. Va aquí y
// no en un efecto de App porque tiene que cubrir TODAS las rutas (repesca,
// privacidad, admin), no solo el juego. En web es no-op.
hideSplashWhenReady();

// Registro del service worker para Web Push. Diferido a 'load' para no competir
// con el primer render. Guard explícito de nativo: en la app Android NO
// registramos el SW (esa usa notif locales), en vez de depender de que el
// WebView no exponga serviceWorker. Falla en silencio si el navegador no lo
// soporta: el juego funciona igual, solo sin push web.
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  !Capacitor.isNativePlatform()
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW no disponible: el juego funciona igual, solo sin push web */
    });
  });
}
