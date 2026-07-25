// src/lib/nativeLocale.js
// Lee el idioma que el usuario eligió en el selector POR APP de Android
// (LocaleBridgePlugin lo expone como interfaz JS síncrona `CochePlatform`).
//
// En web `window.CochePlatform` no existe → devuelve "" y todo el sistema de
// idioma se comporta exactamente como antes de este puente. En nativo devuelve
// "en"/"es" si hay elección explícita por app, o "" si no la hay.
//
// Síncrono a propósito: el i18n resuelve el idioma al cargarse, antes del primer
// render. Ver el porqué del timing en LocaleBridgePlugin.java.

export function readNativeLocale() {
  try {
    const tag = window?.CochePlatform?.getPersistedLocale?.();
    return typeof tag === "string" ? tag : "";
  } catch {
    // Cualquier problema del puente (versión vieja, interfaz no registrada):
    // nos comportamos como en web, sin idioma nativo.
    return "";
  }
}
