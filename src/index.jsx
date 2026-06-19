import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorFallback from "./components/ErrorFallback";
import { ToastProvider } from "./components/Toast";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";
import { reportWebVitals } from "./lib/webVitals";
import { installApiFetchShim } from "./lib/apiUrl";

// Inicializar Sentry ANTES de cualquier render. Sin DSN configurado
// (VITE_SENTRY_DSN), es no-op total — dev local sigue funcionando con
// console.error como hoy. Con DSN, los errores no manejados llegan al
// dashboard de Sentry.
initSentry();
// En la app Android (Capacitor) reescribe las rutas /api relativas al dominio
// de producción. En web es no-op.
installApiFetchShim();

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
