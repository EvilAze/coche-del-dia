// src/hooks/useTecladoAbierto.js
// ¿Está arriba el teclado del sistema? Suscripción al estado que sella
// src/lib/teclado.js en <html>.
//
// POR QUÉ UN HOOK Y NO LEER EL ATRIBUTO. El CSS se entera solo (el selector
// `[data-teclado="abierto"]` recompone el pliego), pero React no: leer
// `document.documentElement.dataset` en el render devolvería el valor del
// momento del render y nadie volvería a pintar al cambiar. El único consumidor
// hoy es el «recorte» de la foto, y precisamente ahí el retraso se ve — la foto
// desaparece del flujo y su sustituta tiene que estar ya puesta en ese mismo
// frame, no en el siguiente.
//
// `useSyncExternalStore` y no un `useState` + efecto: es el que garantiza que
// el valor leído durante el render es el mismo que el de la suscripción (sin
// tearing) y el que evita un primer pintado con el valor viejo.

import { useSyncExternalStore } from "react";
import { suscribirTeclado, tecladoAbierto } from "../lib/teclado";

export function useTecladoAbierto() {
  // El tercer argumento (snapshot de servidor) no lo usa nadie —la app es una
  // SPA sin SSR— pero React lo exige si algún día se pre-renderiza.
  return useSyncExternalStore(suscribirTeclado, tecladoAbierto, () => false);
}
