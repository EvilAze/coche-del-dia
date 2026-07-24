// src/lib/compat.js
// Sonda de compatibilidad del ESCENARIO de juego.
//
// El cuadrado 1:1 de la foto (index.css, bloque .cdd-fold .cdd-stage) se
// construye con unidades de CONTAINER (100cqmin) y de VIEWPORT PEQUEÑO (100svh)
// — CSS de 2022-2023. Los navegadores in-app (el WebView de Reddit, Instagram,
// Facebook…) y los móviles viejos que NO las soportan degeneran ese cuadrado en
// un rectángulo más ancho: con object-cover eso revela coche de más y el zoom
// "salta a coche completo" un par de intentos antes (bug reportado desde Reddit,
// jul 2026). Hay un fallback @supports en index.css que reconstruye el cuadrado
// con vmin para esos navegadores.
//
// Esta sonda MIDE cuántos usuarios caen en ese camino y con qué navegador, para
// no depender de que alguien lo reporte a mano. Umami ya desglosa cada evento
// por navegador/SO, así que con dos flags basta para saber "qué navegadores no
// soportan qué". Se dispara UNA vez por sesión y SOLO si falta soporte: el caso
// feliz (navegador moderno) no genera ruido en el dashboard.

import { track } from "./analytics";

export function reportViewportCompat() {
  if (typeof window === "undefined") return;
  try {
    // CSS.supports es universal (Chrome 28+, Safari 9+). Si no existiera,
    // asumimos lo peor (sin soporte) para no perder la señal en ese navegador.
    const supports =
      window.CSS && typeof window.CSS.supports === "function"
        ? (decl) => window.CSS.supports(decl)
        : () => false;
    const cq = supports("width: 100cqmin");
    const svh = supports("height: 100svh");
    if (cq && svh) return; // navegador moderno: nada que reportar.

    // Guard "una vez por sesión": evita duplicar el evento en cada recarga de
    // la misma pestaña. Si sessionStorage falla (modo privado / sandbox),
    // reportamos igual — un duplicado ocasional es mejor que perder el dato.
    try {
      if (sessionStorage.getItem("ccd_compat_reported")) return;
      sessionStorage.setItem("ccd_compat_reported", "1");
    } catch {
      /* sin sessionStorage: seguimos y reportamos igualmente */
    }

    // No mandamos el user-agent crudo: Umami ya guarda navegador/SO por evento
    // y evitamos arrastrar PII innecesaria (CLAUDE.md #8). Con cq/svh sabemos
    // exactamente qué feature falta y, cruzado con el desglose de Umami, en qué
    // navegadores.
    track("viewport_compat", { cq, svh });
  } catch {
    // Nunca romper el arranque por una sonda de métrica.
  }
}
