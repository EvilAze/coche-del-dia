// src/lib/compartir.js
// Compartir el resultado con la hoja NATIVA de Android.
//
// POR QUÉ HACE FALTA. El botón dice «Compartir resultado», y en la web cumple:
// `navigator.share` abre la hoja del sistema. Pero el WebView de Android NO
// implementa la Web Share API (no es Chrome: es Chromium embebido, y esa API
// no viene), así que dentro del APK el botón caía al portapapeles y decía
// «Copiado». En un juego diario el resultado compartido —en el grupo de
// WhatsApp, en una historia— es por donde llega la gente nueva, y la app lo
// estaba convirtiendo en «pégalo tú donde quieras».
//
// Vive en lib/ como el resto de lo nativo (ver lib/plataforma.js): el
// componente no sabe de Capacitor. El plugin se carga con import dinámico para
// que la web no lo arrastre en su bundle.

import { Capacitor } from "@capacitor/core";

/**
 * Abre la hoja de compartir del sistema dentro de la app.
 * @returns {Promise<"compartido"|"cancelado"|null>} null fuera de la app (el
 *   llamante sigue con su camino web); lanza si el plugin falla de verdad.
 */
export async function compartirEnApp(texto) {
  if (!Capacitor.isNativePlatform()) return null;
  const { Share } = await import("@capacitor/share");
  try {
    await Share.share({ text: texto });
    return "compartido";
  } catch (err) {
    // Cerrar la hoja sin elegir destino RECHAZA la promesa («Share canceled»).
    // Es una decisión del jugador, no un fallo: ni háptico de error ni plan B.
    if (/cancel/i.test(err?.message ?? "")) return "cancelado";
    throw err;
  }
}
