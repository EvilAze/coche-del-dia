// api/_lib/imagen-origen.js
// De dónde saca /api/daily-image los BYTES sobre los que recorta. Dos cosas,
// y las dos existen por la misma factura.
//
// EL PROBLEMA. Las fotos viven en Supabase Storage, y cada fallo de caché del
// CDN de Vercel hace que la función se descargue el ORIGINAL ENTERO otra vez.
// Y las variantes son muchas: 3 anchuras × 3 formatos × 6 estados de zoom =
// 54 entradas de caché al día, cada una con su propio fallo, multiplicadas por
// cada PoP. Con originales de ~1,3 MB eso son cientos de MB diarios de egress
// — el consumo que en agosto de 2026 se comió la cuota del plan gratuito
// (6,70 GB sobre 5 GB incluidos).
//
// DOS RECORTES, ninguno de los cuales toca un solo píxel de lo que se ve:
//
//   1. CACHÉ EN MEMORIA DEL PROCESO. Las 54 variantes salen todas del MISMO
//      original. Guardándolo en el módulo, una instancia caliente lo descarga
//      UNA vez y sirve todas las variantes que le toquen con esa copia.
//
//   2. MASTER EN WEBP. Un gemelo del original a la MISMA RESOLUCIÓN, solo
//      cambiando el contenedor. Pesa ~la mitad y se recorta exactamente igual.
//
// POR QUÉ EL MASTER NO SE REDUCE DE TAMAÑO, que era la idea obvia y es la
// equivocada: la resolución que ve el jugador en cada intento es
// `ladoCorto × porcentajeDeRecorte`, y ese porcentaje es minúsculo al
// principio (22% en el intento 1). Con originales de ~2700 px de lado corto,
// el intento 1 ya sirve solo ~600 px. Un master de 1920 px lo dejaría en ~289:
// menos de la mitad de resolución justo en la vista más ampliada, que es
// donde el jugador se deja los ojos. El ahorro tiene que salir del formato,
// nunca de los píxeles.

import { conTimeout } from "./timeout.js";

// Caché del proceso. Diminuta a propósito: en un día solo se piden el coche
// de hoy y, como mucho, el de una repesca. Guardar más sería ocupar memoria
// de la función para nada.
const MAX_ENTRADAS = 2;
const TTL_MS = 30 * 60 * 1000;
const PLAZO_MS = 15000; // descargar varios MB puede tardar; esto solo corta cuelgues
const _cache = new Map(); // url -> { buffer, contentType, en }

/**
 * URL del master WebP que corresponde a una imagen del bucket, por CONVENCIÓN
 * de ruta: el master vive en la carpeta `master/` del mismo bucket, con el
 * mismo nombre y sufijo `.webp`.
 *
 * Se deriva en vez de guardarse en una columna a propósito: `cars` no gana un
 * campo nuevo (con su migración y su discusión de GRANT), y un coche sin
 * master sigue funcionando solo — se cae al original y ya.
 *
 * @param {string} imageUrl URL pública del original
 * @returns {string|null}
 */
export function urlDelMaster(imageUrl) {
  try {
    const u = new URL(imageUrl);
    // .../storage/v1/object/public/<bucket>/<ruta>
    const m = u.pathname.match(/^(.*\/object\/public\/[^/]+\/)(.+)$/);
    if (!m) return null;
    const [, prefijo, ruta] = m;
    if (ruta.startsWith("master/")) return null; // ya es un master
    u.pathname = `${prefijo}master/${ruta}.webp`;
    return u.toString();
  } catch {
    return null;
  }
}

async function descargar(url) {
  const res = await conTimeout(fetch(url), PLAZO_MS, { etiqueta: `descarga ${url.slice(0, 60)}` });
  if (!res.ok) return { ok: false, status: res.status };
  return {
    ok: true,
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "image/jpeg",
  };
}

function guardar(url, entrada) {
  // Sin librería de LRU: con dos entradas, tirar la más vieja es suficiente.
  if (_cache.size >= MAX_ENTRADAS) {
    const masVieja = [..._cache.entries()].sort((a, b) => a[1].en - b[1].en)[0];
    if (masVieja) _cache.delete(masVieja[0]);
  }
  _cache.set(url, { ...entrada, en: Date.now() });
}

/**
 * Bytes sobre los que recortar. Prefiere el master (más ligero, misma
 * resolución) y cae al original si no existe todavía — que es lo normal
 * mientras no se hayan generado, y lo que hace que esto se pueda desplegar
 * sin migrar nada.
 *
 * NUNCA lanza por el master: un fallo ahí solo significa usar el original.
 *
 * @param {string} imageUrl
 * @returns {Promise<{buffer: Buffer, contentType: string, deMaster: boolean}|null>}
 */
export async function leerImagenOrigen(imageUrl) {
  const master = urlDelMaster(imageUrl);
  const candidatos = master ? [master, imageUrl] : [imageUrl];

  // La caché se consulta por las dos, para no volver a preguntar por un
  // master que ya sabemos que existe (ni redescargar el original).
  for (const url of candidatos) {
    const hit = _cache.get(url);
    if (hit && Date.now() - hit.en < TTL_MS) {
      return { buffer: hit.buffer, contentType: hit.contentType, deMaster: url === master };
    }
  }

  for (const url of candidatos) {
    try {
      const r = await descargar(url);
      if (r.ok) {
        guardar(url, r);
        return { buffer: r.buffer, contentType: r.contentType, deMaster: url === master };
      }
      // 404 del master es lo esperado antes de generarlos: al original.
      if (url === master) continue;
      console.error("[imagen-origen] status del original:", r.status);
      return null;
    } catch (err) {
      if (url === master) {
        console.error("[imagen-origen] master no disponible:", err?.message || err);
        continue;
      }
      console.error("[imagen-origen] fallo al descargar el original:", err?.message || err);
      return null;
    }
  }
  return null;
}

// Solo para tests.
export function _resetCacheImagenes() {
  _cache.clear();
}
