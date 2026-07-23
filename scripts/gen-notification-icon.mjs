#!/usr/bin/env node
/**
 * Genera el icono pequeño de la notificación (status bar) de la app Android
 * a partir del máster de marca, en las 5 densidades.
 *
 *   assets/brand-logo-source.png
 *     -> android/app/src/main/res/drawable-{m,h,xh,xxh,xxxh}dpi/ic_stat_cdd.png
 *
 * Por qué existe:
 *   @capacitor/local-notifications, si no le das `plugins.LocalNotifications
 *   .smallIcon`, cae a `android.R.drawable.ic_dialog_info` (ver
 *   LocalNotificationManager#getDefaultSmallIcon). O sea: el recordatorio
 *   diario salía con la "i" azul genérica de Android en la barra de estado.
 *   Con el trabajo de marca hecho («Prensa del motor»), eso es lo único de la
 *   app que el usuario ve varias veces al día y no llevaba identidad.
 *
 * Reglas del formato (no son negociables, las impone Android):
 *   1. Android IGNORA el color: usa SOLO el canal alfa y lo tiñe él (blanco en
 *      la barra, o el `iconColor` en la bandeja). Por eso aquí el RGB se fuerza
 *      a blanco puro y toda la información va en el alfa. Un PNG a color sale
 *      como un cuadrado blanco sólido — el fallo clásico.
 *   2. Fondo transparente obligatorio.
 *   3. Densidades mdpi 24 / hdpi 36 / xhdpi 48 / xxhdpi 72 / xxxhdpi 96 px,
 *      con un margen interior (Android no lo añade).
 *
 * Encuadre:
 *   El máster son tres bandas de alfa: el coupé y los dos filetes. Aquí se toma
 *   el coupé MÁS el primer filete y se descarta el segundo. Motivo: el coche
 *   solo tiene una relación ~2.8:1 y en un lienzo cuadrado quedaría como una
 *   astilla flotando en el centro; con el filete debajo el conjunto gana masa
 *   vertical y se lee como una marca, no como un recorte. El segundo filete a
 *   24 px se funde con el primero, así que solo aportaría ruido.
 *
 * Uso:  node scripts/gen-notification-icon.mjs
 * (idempotente; se ejecuta a mano cuando cambie el máster, no en cada build)
 */

import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "assets/brand-logo-source.png");
const RES = resolve(ROOT, "android/app/src/main/res");

// Densidades de Android para un icono de 24dp, con la ganancia de contraste
// del alfa que se le aplica a cada una (1 = sin tocar).
//
// Por qué la ganancia solo abajo: a 24 px el coupé mide ~7 px de alto, y el
// suavizado del reescalado convierte techo, ruedas y filete en una mancha gris
// uniforme. Estirar el alfa alrededor del 50% vuelve a separar las formas. A
// partir de xhdpi el reescalado ya da un borde limpio y la ganancia solo
// añadiría dentado, así que se deja en 1. Probado x3.5: rompe el filete en una
// línea discontinua y se come las ruedas — 2 es el punto de equilibrio.
const DENSIDADES = [
  ["drawable-mdpi", 24, 2],
  ["drawable-hdpi", 36, 2],
  ["drawable-xhdpi", 48, 1],
  ["drawable-xxhdpi", 72, 1],
  ["drawable-xxxhdpi", 96, 1],
];

// Margen interior, en fracción del lado. Android recorta visualmente los
// iconos que llegan al borde; 1/12 deja el aire justo sin encoger el dibujo.
const MARGEN = 1 / 12;
// Un píxel cuenta como "tinta" a partir de este alfa. El máster tiene bordes
// antialiaseados; por debajo de esto es halo, no dibujo.
const UMBRAL_ALFA = 16;

/** Divide la imagen en bandas horizontales contiguas que contienen alfa. */
function bandasConAlfa(data, { width, height, channels }) {
  const bandas = [];
  let inicio = null;
  for (let y = 0; y < height; y++) {
    let hayTinta = false;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > UMBRAL_ALFA) {
        hayTinta = true;
        break;
      }
    }
    if (hayTinta && inicio === null) inicio = y;
    else if (!hayTinta && inicio !== null) {
      bandas.push([inicio, y - 1]);
      inicio = null;
    }
  }
  if (inicio !== null) bandas.push([inicio, height - 1]);
  return bandas;
}

/** Columnas mínima y máxima con tinta dentro del rango de filas [y0, y1]. */
function limitesX(data, { width, channels }, y0, y1) {
  let min = width;
  let max = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > UMBRAL_ALFA) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return [min, max];
}

const { data, info } = await sharp(SRC)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const bandas = bandasConAlfa(data, info);
if (bandas.length < 2) {
  throw new Error(
    `El máster no tiene la forma esperada (coupé + filetes): ${bandas.length} banda(s). ` +
      "¿Ha cambiado assets/brand-logo-source.png?"
  );
}

// Banda 0 = coupé, banda 1 = primer filete. Se recorta desde el techo del coche
// hasta el bajo del primer filete, con los límites horizontales del conjunto.
const y0 = bandas[0][0];
const y1 = bandas[1][1];
const [x0, x1] = limitesX(data, info, y0, y1);
const recorte = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };

console.log(
  `máster ${info.width}x${info.height} · bandas ${JSON.stringify(bandas)} · ` +
    `recorte ${recorte.width}x${recorte.height} en (${recorte.left},${recorte.top})`
);

for (const [carpeta, lado, ganancia] of DENSIDADES) {
  const util = Math.round(lado * (1 - 2 * MARGEN));

  // Escalado a caja: `fit: contain` con fondo transparente centra el dibujo y
  // conserva la proporción (el coupé es mucho más ancho que alto).
  const dibujo = await sharp(SRC)
    .extract(recorte)
    .resize(util, util, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // RGB a blanco puro conservando el alfa: es lo único que Android lee.
  // De paso, la ganancia de contraste del alfa para las densidades pequeñas.
  const px = dibujo.data;
  for (let i = 0; i < px.length; i += dibujo.info.channels) {
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    if (ganancia !== 1) {
      const a = px[i + 3] / 255;
      const estirado = (a - 0.5) * ganancia + 0.5;
      px[i + 3] = Math.round(Math.min(1, Math.max(0, estirado)) * 255);
    }
  }

  const glifo = await sharp(px, {
    raw: {
      width: dibujo.info.width,
      height: dibujo.info.height,
      channels: dibujo.info.channels,
    },
  })
    .png()
    .toBuffer();

  // Lienzo cuadrado transparente del tamaño de la densidad, con el glifo
  // centrado (el margen sale de la diferencia entre `lado` y `util`).
  const salida = await sharp({
    create: {
      width: lado,
      height: lado,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glifo, gravity: "center" }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const destino = resolve(RES, carpeta, "ic_stat_cdd.png");
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, salida);
  console.log(`  ${carpeta}/ic_stat_cdd.png  ${lado}x${lado}  ${salida.length} B`);
}

console.log("\nListo. Recuerda `npm run cap:sync` para que llegue al APK.");
