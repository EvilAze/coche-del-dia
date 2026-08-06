// src/lib/teclado.js
// Sella en <html> si el teclado del sistema está abierto (`data-teclado`).
// Solo nativo; en web es no-op (allí el teclado ni siquiera redimensiona el
// viewport de la misma forma, y además la web SÍ scrollea, que es lo normal).
//
// POR QUÉ EXISTE. La app monta un shell fijo: `.app-pantalla` ocupa exactamente
// el alto de la pantalla y NO scrollea (ver «EL PLIEGO SIN SCROLL» en
// index.css). Eso funciona mientras el alto de la ventana sea el de la pantalla
// — y deja de ser cierto en cuanto se abre el teclado, porque Android
// redimensiona el WebView (adjustResize) y `100dvh` encoge con él. Con el shell
// fijo y el cupón anclado abajo, escribir el intento aplastaría la fotografía
// contra el suelo.
//
// La salida no es pelearse con el alto: es SOLTAR el shell mientras se escribe.
// Con `data-teclado="abierto"` el pliego vuelve al flujo normal con scroll —
// exactamente el comportamiento que la app ya tenía— y de paso vuelve a
// funcionar el «recorte» flotante (PhotoPeek), que existe precisamente para
// este caso: el escenario sale del viewport y una miniatura mantiene la
// referencia visual del coche mientras el jugador teclea. Al cerrarse el
// teclado el shell se recompone solo.
//
// El plugin se importa DINÁMICAMENTE por el mismo motivo que en notifications /
// splash: en web no debe entrar en el bundle inicial, y si el plugin faltase
// (build viejo sin `cap sync`) la app tiene que seguir arrancando — sin shell
// que soltar, pero arrancando.

import { Capacitor } from "@capacitor/core";

const ABIERTO = "abierto";

function sellar(abierto) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (abierto) el.dataset.teclado = ABIERTO;
  else delete el.dataset.teclado;
}

/**
 * Engancha los listeners del teclado. Llamar UNA vez al arrancar, dentro del
 * bloque nativo de index.jsx. No devuelve nada: los listeners viven lo que vive
 * la app (no hay desmontaje posible de la raíz en Capacitor).
 */
export async function installKeyboardWatcher() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    // `Will` y no `Did` a propósito: queremos soltar el shell ANTES de que el
    // WebView cambie de alto, para que el usuario no llegue a ver el frame
    // aplastado. Al cerrar es al revés — esperamos a `Did` para recomponer el
    // shell cuando el alto ya ha vuelto a su sitio, o mediríamos el de en medio.
    await Keyboard.addListener("keyboardWillShow", () => sellar(true));
    await Keyboard.addListener("keyboardDidHide", () => sellar(false));
  } catch (err) {
    // Plugin ausente (assets sin `cap sync`) o WebView sin soporte: la app
    // funciona igual, solo que el shell no se suelta al escribir. Regla 9: si
    // la optimización falta, la pantalla carga igual.
    console.error("[teclado] watcher no instalado:", err?.message || err);
  }
}
