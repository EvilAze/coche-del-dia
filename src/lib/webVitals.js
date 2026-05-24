// src/lib/webVitals.js
// Mide Core Web Vitals reales (no synthetic Lighthouse) y los manda como
// eventos a Umami para tenerlos junto al funnel de uso.
//
// Por qué no Sentry Performance:
//   El free tier de Sentry tiene 10k performance units/mes. Un launch con
//   1k usuarios y 10 page views/día se lo come en 4 días. Umami contabiliza
//   por eventos custom, sin límite separado para vitals — sale gratis.
//
// Métricas que emitimos (todas a través del paquete oficial `web-vitals`,
// que ya implementa el sampling y las definiciones canónicas de Google):
//   - LCP: Largest Contentful Paint. Cuándo aparece el contenido principal.
//     En El Coche del Día suele ser la imagen del coche del día.
//   - CLS: Cumulative Layout Shift. Cuánto "salta" el layout. Multiplicamos
//     por 1000 para evitar mandar floats microscópicos.
//   - INP: Interaction to Next Paint. Reemplaza a FID en 2024+. La métrica
//     real de "responsiveness" — cuánto tarda en pintar tras un click/tap.
//   - FCP: First Contentful Paint. Auxiliar, útil para diagnosticar LCP.
//   - TTFB: Time To First Byte. Auxiliar, indica si el backend va lento.
//
// Cada métrica llega con `rating` ∈ {good, needs-improvement, poor}.
// En Umami filtramos por `rating=poor` para alarmas.

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { track } from "./analytics";

function emit(metric) {
  // CLS llega como un float 0..1 (unitless). El resto van en ms.
  // Para que un solo event_value en Umami sea legible para todas,
  // convertimos CLS a "milli-CLS" (×1000) y redondeamos todo a enteros.
  const isCLS = metric.name === "CLS";
  const value = isCLS ? Math.round(metric.value * 1000) : Math.round(metric.value);
  track("web_vital", {
    name: metric.name,            // 'LCP', 'CLS', 'INP', 'FCP', 'TTFB'
    value,                         // ms o milli-CLS
    rating: metric.rating,         // 'good' | 'needs-improvement' | 'poor'
    nav_type: metric.navigationType, // 'navigate' | 'reload' | 'back-forward' | ...
  });
}

/**
 * Arranca la recolección de Web Vitals. Llamar UNA SOLA VEZ al iniciar
 * la app (src/index.jsx). Es seguro llamar en SSR — no hace nada hasta
 * que el browser dispara los eventos correspondientes.
 */
export function reportWebVitals() {
  if (typeof window === "undefined") return;
  try {
    onLCP(emit);
    onCLS(emit);
    onINP(emit);
    onFCP(emit);
    onTTFB(emit);
  } catch (err) {
    // Si web-vitals falla por cualquier motivo, no rompemos la app.
    // eslint-disable-next-line no-console
    console.warn("[web-vitals] init failed:", err?.message || err);
  }
}
