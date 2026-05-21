import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/Toast";

// El usuario normal solo carga <App />. Las rutas secundarias
// (admin, repesca, preview, privacidad, header-test) se piden bajo demanda
// para no engordar el bundle inicial.
const Preview = lazy(() => import("./Preview"));
const HeaderTest = lazy(() => import("./HeaderTest"));
const Repesca = lazy(() => import("./Repesca"));
const Privacidad = lazy(() => import("./Privacidad"));
const AddCar = lazy(() => import("./admin/AddCar"));
const EditCar = lazy(() => import("./admin/EditCar"));

// Sala de pruebas interna y oculta. No enlazada en ningún menú.
// Acceso: /preview  o  cualquier URL con ?preview (útil si el host no
// hace fallback a index.html para rutas SPA).
const { pathname, search } = window.location;
const isPreview =
  pathname.startsWith("/preview") || /(\?|&)preview(=|&|$)/.test(search);

// Herramienta interna para añadir coches al catálogo. Requiere sesión.
const isAdminAddCar =
  pathname.startsWith("/admin/add-car") ||
  /(\?|&)admin-add-car(=|&|$)/.test(search);

// Herramienta interna para editar coches existentes (hot-swap). Requiere sesión.
const isAdminEditCar =
  pathname.startsWith("/admin/edit-car") ||
  /(\?|&)admin-edit-car(=|&|$)/.test(search);

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

// App va eager (la ruta principal); el resto pasa por Suspense para no
// quedarse en blanco mientras descarga su chunk.
function pickRoute() {
  if (isAdminEditCar) return <EditCar />;
  if (isAdminAddCar) return <AddCar />;
  if (isRepesca) return <Repesca />;
  if (isPreview) return <Preview />;
  if (isHeaderTest) return <HeaderTest />;
  if (isPrivacy) return <Privacidad />;
  return <App />;
}

const isMainApp = !(
  isAdminEditCar ||
  isAdminAddCar ||
  isRepesca ||
  isPreview ||
  isHeaderTest ||
  isPrivacy
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ToastProvider>
      {isMainApp ? pickRoute() : <Suspense fallback={null}>{pickRoute()}</Suspense>}
    </ToastProvider>
  </React.StrictMode>
);
