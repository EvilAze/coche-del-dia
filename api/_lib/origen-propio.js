// api/_lib/origen-propio.js
// ¿Esta petición la hace NUESTRA página (la web o la app), o alguien que ha
// pegado la URL en la barra del navegador / un script?
//
// QUÉ ES Y QUÉ NO ES. No es autenticación: todo lo que mira aquí son cabeceras
// que un `curl` puede escribir a mano, así que quien se empeñe lo reproduce.
// Lo que sí cierra es el camino de los curiosos —abrir /api/list-cars en una
// pestaña, copiarla desde F12 y compartirla, enlazarla desde otra web o tirar
// de ella con `fetch` desde un dominio ajeno—, porque esas cabeceras las pone
// el NAVEGADOR y una página no las puede falsificar:
//
//   - `Sec-Fetch-Site` (Fetch Metadata): `same-origin` cuando el fetch sale de
//     una página de este mismo host; `none` al abrir la URL a mano;
//     `cross-site` desde otra web. Lo mandan Chrome/Edge (76+), Firefox (90+)
//     y Safari (16.4+).
//   - `Origin`: la app Android vive en `https://localhost` y llama cross-origin
//     contra producción, así que se reconoce por la misma allowlist del CORS.
//   - `Referer`, SOLO como respaldo para navegadores sin Fetch Metadata (Safari
//     viejo): si un navegador SÍ manda `Sec-Fetch-Site` y no es same-origin, el
//     Referer no lo rescata, porque es la cabecera que más fácil se cuela.
//
// La defensa de verdad del catálogo es que la base ya no lo sirve a `anon`
// (scripts/2026-10-catalogo-privado.sql): sin eso, este portero sería teatro,
// porque la anon key viaja en el bundle y PostgREST contestaría directamente.

import { isAllowedOrigin } from "./cors.js";

/**
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {boolean}
 */
export function esPeticionPropia(req) {
  const h = req?.headers || {};
  const sitio = String(h["sec-fetch-site"] || "").toLowerCase();
  if (sitio === "same-origin") return true;
  if (isAllowedOrigin(h.origin)) return true;
  if (sitio) return false;

  const host = String(h["x-forwarded-host"] || h.host || "").toLowerCase();
  const referer = String(h.referer || "");
  if (!host || !referer) return false;
  try {
    return new URL(referer).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
