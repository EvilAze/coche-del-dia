// middleware.js
// Edge Middleware que inyecta un `Link: rel=preload` de la imagen del coche
// del día en la respuesta HTML de la home. Objetivo: que el navegador
// descubra y empiece a descargar la imagen hero AL PARSEAR EL HTML, en
// paralelo con el bundle JS — sin esperar a que React ejecute
// /api/get-daily-car para conocer la URL. Rompe el waterfall:
//
//   ANTES:  HTML → JS → React → get-daily-car → daily-image
//   AHORA:  HTML (con Link preload) ─┬→ JS bundle
//                                    └→ daily-image (arranca ya, en paralelo)
//
// De dónde sale la URL: el cron `api/cron/warm-daily.js` la escribe cada
// noche en Vercel Edge Config bajo la clave `daily_preload` con forma
// `{ date, img }`. Edge Config se lee en <1ms desde el edge, así que no
// añadimos latencia perceptible al HTML (a diferencia de consultar
// Supabase aquí, que era la alternativa descartada).
//
// Degradación segura: si Edge Config no está configurado, está vacío, o la
// fecha guardada no es la de hoy (el cron falló esa noche), NO inyectamos
// nada y la página carga exactamente como antes — sin regresión, solo sin
// el adelanto del preload.
//
// Requisitos de plataforma:
//   - Edge Config store conectado al proyecto (inyecta env `EDGE_CONFIG`).
//   - El cron alimentándolo (ver warm-daily.js PASO 3).

import { next } from "@vercel/edge";
import { get } from "@vercel/edge-config";

export const config = {
  // Solo la home. Es donde se monta CarImage con el coche del día. Otras
  // rutas (/privacidad, /repesca) no consumen esta imagen.
  matcher: "/",
};

// Fecha de hoy en Europe/Madrid (YYYY-MM-DD). Mismo formato que usa el
// resto del backend (todayInMadrid) y que el cron guarda en `date`.
function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// srcset/sizes DEBEN coincidir byte-a-byte con los del <picture> de
// CarImage.jsx. Si difieren, el navegador no reusa el recurso precargado
// y descarga dos veces. Si tocas el srcset de CarImage, tócalo también aquí.
const IMAGE_SIZES =
  "(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px";

export default async function middleware() {
  try {
    const preload = await get("daily_preload");

    // Guard anti-stale: solo inyectamos si el cron escribió HOY. Si la
    // clave es de ayer (cron falló) o no existe, no arriesgamos a precargar
    // una imagen que ya no es la del día.
    if (preload?.img && preload.date === todayInMadrid()) {
      // `preload.img` = "/api/daily-image?d=YYYY-MM-DD&v=HASH"
      // Reconstruimos las 3 variantes AVIF del crop de juego (z=5), igual
      // que pide el cliente durante "playing".
      const variant = `${preload.img}&z=5&f=avif`;
      const srcset =
        `${variant}&w=640 640w, ` +
        `${variant}&w=1280 1280w, ` +
        `${variant}&w=1920 1920w`;
      // Fallback para navegadores que no entiendan imagesrcset en el Link
      // header: 1280w es la mejor apuesta universal (móvil con DPR alto y
      // desktop ≤1280px ambos tiran hacia ahí).
      const fallback = `${variant}&w=1280`;

      const linkHeader =
        `<${fallback}>; rel=preload; as=image; fetchpriority=high; ` +
        `imagesrcset="${srcset}"; imagesizes="${IMAGE_SIZES}"`;

      return next({ headers: { Link: linkHeader } });
    }
  } catch {
    // EDGE_CONFIG no inyectado / error de lectura → seguimos sin preload.
    // Nunca rompemos el HTML por esto.
  }

  return next();
}
