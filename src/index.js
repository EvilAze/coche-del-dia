import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import Preview from "./Preview";
import { ToastProvider } from "./components/Toast";

// Sala de pruebas interna y oculta. No enlazada en ningún menú.
// Acceso: /preview  o  cualquier URL con ?preview (útil si el host no
// hace fallback a index.html para rutas SPA).
const { pathname, search } = window.location;
const isPreview =
  pathname.startsWith("/preview") || /(\?|&)preview(=|&|$)/.test(search);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ToastProvider>
      {isPreview ? <Preview /> : <App />}
    </ToastProvider>
  </React.StrictMode>
);
