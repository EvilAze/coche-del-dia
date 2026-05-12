import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import Preview from "./Preview";
import AddCar from "./admin/AddCar";
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

function pickRoute() {
  if (isAdminAddCar) return <AddCar />;
  if (isPreview) return <Preview />;
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
