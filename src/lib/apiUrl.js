// src/lib/apiUrl.js
// En la app Android (Capacitor) el build viaja empaquetado y el origen del
// WebView es https://localhost, así que las rutas relativas `/api/*` no
// resuelven. apiUrl() las absolutiza al dominio de producción SOLO en nativo;
// en web son no-op (siguen relativas, como hoy). installApiFetchShim() aplica
// lo mismo de forma transparente a window.fetch para no tocar los ~20 call
// sites. Las URLs de imagen `/api/*` (CarImage, preload) usan apiUrl()
// directamente porque el shim no afecta al `src` de <img>.

import { Capacitor } from "@capacitor/core";

export const PROD_ORIGIN =
  import.meta.env.VITE_PROD_ORIGIN || "https://cochedeldia.com";

export function apiUrl(path) {
  if (typeof path !== "string") return path;
  if (Capacitor.isNativePlatform() && path.startsWith("/api")) {
    return PROD_ORIGIN + path;
  }
  return path;
}

export function installApiFetchShim() {
  if (!Capacitor.isNativePlatform()) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api")) {
      return orig(PROD_ORIGIN + input, init);
    }
    return orig(input, init);
  };
}
