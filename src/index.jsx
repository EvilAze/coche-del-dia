import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";
import { reportWebVitals } from "./lib/webVitals";

// Inicializar Sentry ANTES de cualquier render. Sin DSN configurado
// (VITE_SENTRY_DSN), es no-op total — dev local sigue funcionando con
// console.error como hoy. Con DSN, los errores no manejados llegan al
// dashboard de Sentry.
initSentry();

// Empezar a recolectar Core Web Vitals (LCP/CLS/INP/FCP/TTFB) y mandarlos
// a Umami. Es seguro llamar antes de createRoot: web-vitals se suscribe
// a eventos del browser, no toca el DOM.
reportWebVitals();

// El usuario normal solo carga <App />. Las rutas secundarias
// (admin-tools, repesca, privacidad, header-test) se piden bajo demanda
// para no engordar el bundle inicial.
const HeaderTest = lazy(() => import("./HeaderTest"));
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

const isHeaderTest =
  pathname.startsWith("/header-test") ||
  /(\?|&)header-test(=|&|$)/.test(search);

const isAnyAdminTools =
  isAdminTools || isLegacyEditCar || isLegacyAddCar || isLegacyPreview;

// App va eager (la ruta principal); el resto pasa por Suspense para no
// quedarse en blanco mientras descarga su chunk.
function pickRoute() {
  if (isAnyAdminTools) return <AdminTools defaultTab={legacyTab()} />;
  if (isRepesca) return <Repesca />;
  if (isHeaderTest) return <HeaderTest />;
  if (isPrivacy) return <Privacidad />;
  return <App />;
}

const isMainApp = !(
  isAnyAdminTools ||
  isRepesca ||
  isHeaderTest ||
  isPrivacy
);

// Fallback de la ErrorBoundary: si el árbol React peta durante el render,
// mostramos algo decente en vez de la pantalla blanca de la muerte.
// Mantenemos el tono visual del resto de la app (dark + accent) y damos
// al usuario una salida: refrescar. El error ya ha llegado a Sentry
// automáticamente en este punto, no necesitamos hacer nada más aquí.
function ErrorFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        textAlign: "center",
        backgroundColor: "#0a0a0b",
        color: "#f0f0f4",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <p
        style={{
          fontFamily: "'Bebas Neue', cursive",
          fontSize: "2rem",
          letterSpacing: "0.18em",
          color: "#e8c87a",
          margin: 0,
        }}
      >
        ALGO FALLÓ
      </p>
      <p style={{ marginTop: "0.75rem", color: "#9a9aab", maxWidth: 380 }}>
        Hemos tenido un problema cargando la página. Vuelve a intentarlo
        en un momento — si persiste, recarga.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginTop: "1.5rem",
          padding: "0.65rem 1.5rem",
          border: "1px solid #e8c87a",
          borderRadius: "0.5rem",
          background: "transparent",
          color: "#e8c87a",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        Recargar
      </button>
    </div>
  );
}

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
