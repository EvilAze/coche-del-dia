import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import Preview from "./Preview";
import Repesca from "./Repesca";
import Privacidad from "./Privacidad";
import AddCar from "./admin/AddCar";
import EditCar from "./admin/EditCar";
import { ToastProvider } from "./components/Toast";

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

function pickRoute() {
  if (isAdminEditCar) return <EditCar />;
  if (isAdminAddCar) return <AddCar />;
  if (isRepesca) return <Repesca />;
  if (isPreview) return <Preview />;
  if (isPrivacy) return <Privacidad />;
  return <App />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ToastProvider>
      {pickRoute()}
    </ToastProvider>
  </React.StrictMode>
);
