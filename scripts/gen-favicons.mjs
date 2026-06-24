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
// Nota: el máster ya trae ~22% de margen transparente alrededor del badge,
// la MISMA proporción que tenían los iconos dorados previos. Por eso basta un
// resize directo (sin trim): el encuadre queda idéntico al set anterior y el
// rebrand oro→menta es 1:1. Se conserva el alfa (esquinas transparentes) para
// no romper la paridad con el set histórico.
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

// Fondo transparente: el badge "flota", igual que el set anterior.
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Reescala el máster a un PNG cuadrado de NxN conservando alfa.
async function pngAt(size) {
  return sharp(SRC)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
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
