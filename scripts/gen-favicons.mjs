// scripts/gen-favicons.mjs
//
// Genera TODOS los favicons / iconos PWA de la web a partir del máster de
// marca en alta resolución (assets/brand-logo-source.png, 2048×2048 RGBA).
//
// Por qué un solo máster:
//   El badge "Coche del Día" es el mismo en todos los tamaños; tenerlo una
//   vez a 2048 y derivar el resto por downscale (Lanczos de sharp) da bordes
//   más nítidos que reescalar desde el 512. Si rediseñas el logo, sustituye
//   SOLO el máster y reejecuta este script + scripts/gen-cap-assets.js.
//
// Salida (public/):
//   - favicon-96x96.png              96×96   (pestañas Chrome/Firefox/Edge)
//   - web-app-manifest-192x192.png   192×192 (resultado de búsqueda Google, PWA)
//   - web-app-manifest-512x512.png   512×512 (PWA / fuente de los iconos Android)
//   - apple-touch-icon.png           180×180 (iOS "añadir a inicio")
//   - favicon.ico                    16/32/48 multi-resolución (fallback legacy)
//
// El máster llega TRANSPARENTE (solo el dibujo: coche + filete, con su zona de
// seguridad ya reservada) y aquí se compone A SANGRE sobre el papel #f3eee1.
// Dos razones, las dos eran bugs del set anterior:
//
//   1. `purpose: "maskable"` (manifest.json) exige que el icono llene el lienzo
//      entero: el launcher lo recorta con la forma que quiera (círculo, squircle,
//      gota). Un PNG con margen transparente se recortaba sobre el fondo del
//      sistema y el badge quedaba flotando y diminuto.
//   2. La estética «Prensa del motor» pinta en tinta #1b1712. Sobre transparente
//      eso desaparece en una barra de pestañas oscura — la menta del tema viejo
//      brillaba sobre cualquier fondo y disimulaba el problema. Llevando el
//      icono su propio papel, se lee siempre.
//
// La zona de seguridad vive en el MÁSTER (dibujo al ~73% del ancho), no aquí:
// así el mismo archivo sirve a la web y al foreground adaptativo de Android
// (scripts/gen-cap-assets.js) sin que cada script invente su propio encuadre.
//
// El .ico se construye a mano embebiendo PNGs (PNG-in-ICO): sharp no exporta
// .ico y no queremos depender de ImageMagick ni de paquetes extra. Todos los
// navegadores modernos y Windows Vista+ leen PNG dentro de .ico, y el .ico
// solo es el fallback legacy (los consumidores actuales usan los PNG/manifest).
//
// Uso:  node scripts/gen-favicons.mjs

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "assets/brand-logo-source.png");
const PUB = resolve(ROOT, "public");

// Papel de prensa = --bg del tema día (src/index.css). Opaco a propósito.
const PAPEL = { r: 243, g: 238, b: 225, alpha: 1 };

// TAMAÑO ÓPTICO. El máster reserva zona de seguridad porque los iconos del
// manifest son `maskable` y el launcher los recorta. Pero al favicon NO lo
// recorta nadie, y a 16px ese margen se comía el dibujo: la silueta quedaba en
// ~11px de ancho y se leía como una mancha gris (verificado ampliando el
// render). Para los tamaños pequeños acercamos el encuadre; para los grandes
// se respeta el máster tal cual.
//   Recortar el 79% central sube el bloque del 73% al ~92% del lienzo.
const ZOOM_PEQUENO = 0.79;
const CORTE_OPTICO = 96; // ≤ 96px van apretados; por encima, encuadre completo

// Reescala el máster a un PNG cuadrado de NxN y lo aplana sobre el papel.
// `flatten` DESPUÉS del resize: al revés, el antialias de los bordes del dibujo
// se mezclaría con el negro por defecto de sharp y dejaría un halo sucio.
async function pngAt(size) {
  let pipe = sharp(SRC);

  if (size <= CORTE_OPTICO) {
    const meta = await sharp(SRC).metadata();
    const lado = Math.round(meta.width * ZOOM_PEQUENO);
    const off = Math.round((meta.width - lado) / 2);
    pipe = pipe.extract({ left: off, top: off, width: lado, height: lado });
  }

  return pipe
    .resize(size, size, { fit: "contain", background: PAPEL })
    .flatten({ background: PAPEL })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Ensambla un .ico (formato ICONDIR) embebiendo los PNG indicados.
// Cada entrada apunta a su blob PNG; width/height=0 significaría 256.
function buildIco(images /* [{ size, data }] */) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icono
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count; // los blobs van tras la cabecera + directorio
  images.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0); // width
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // paleta (0 = sin paleta)
    dir.writeUInt8(0, b + 3); // reservado
    dir.writeUInt16LE(1, b + 4); // planes
    dir.writeUInt16LE(32, b + 6); // bits por píxel
    dir.writeUInt32LE(img.data.length, b + 8); // tamaño del blob
    dir.writeUInt32LE(offset, b + 12); // offset del blob
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

async function generate() {
  // PNGs sueltos para los distintos consumidores.
  const targets = [
    { name: "favicon-96x96.png", size: 96 },
    { name: "web-app-manifest-192x192.png", size: 192 },
    { name: "web-app-manifest-512x512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 },
  ];
  for (const { name, size } of targets) {
    const buf = await pngAt(size);
    writeFileSync(resolve(PUB, name), buf);
    console.log(`✓ public/${name} (${size}×${size})`);
  }

  // favicon.ico multi-resolución (16/32/48).
  const icoSizes = [16, 32, 48];
  const icoImages = [];
  for (const size of icoSizes) {
    icoImages.push({ size, data: await pngAt(size) });
  }
  writeFileSync(resolve(PUB, "favicon.ico"), buildIco(icoImages));
  console.log(`✓ public/favicon.ico (${icoSizes.join("/")})`);
}

generate().catch((err) => {
  console.error("[gen-favicons] ERROR:", err);
  process.exit(1);
});
