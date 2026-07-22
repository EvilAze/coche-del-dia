/**
 * Genera los assets fuente para @capacitor/assets (Easy Mode).
 * Entrada: assets/brand-logo-source.png (2048×2048, RGBA) — el máster de marca.
 *   Antes leía el 512 y lo escalaba a 1024 (upscale borroso); partir del
 *   máster a 2048 y bajar a 1024 da un icono nítido.
 * Salida:
 *   assets/logo.png       — 1024×1024, icono sobre fondo transparente
 *   assets/logo-dark.png  — mismo (válido para modo oscuro)
 *
 * Por qué aquí SÍ conservamos el alfa (y en gen-favicons.mjs no):
 *   el icono adaptativo de Android es dos capas — foreground (el dibujo) sobre
 *   background (un color plano). capacitor-assets espera justo eso: le pasamos
 *   el máster transparente como foreground y el papel por --iconBackgroundColor.
 *   La web, en cambio, necesita el cuadrado YA compuesto (ver gen-favicons.mjs).
 *
 * OJO con el doble margen: el máster ya reserva su zona de seguridad (el dibujo
 * ocupa ~73% del lienzo) y encima android/…/mipmap-anydpi-v26/ic_launcher.xml
 * aplica un inset del 16.7%. Si al verlo en un móvil el coche sale pequeño, el
 * sitio para corregirlo es ese inset, no el máster (que la web comparte).
 *
 * En Easy Mode, capacitor-assets genera el splash internamente usando
 * los colores de fondo que pasamos por CLI, así que NO necesitamos
 * un splash.png manual.
 *
 * Ejecutar con: node scripts/gen-cap-assets.js
 */
const sharp = require('sharp');
const path = require('path');

const SRC = path.resolve(__dirname, '../assets/brand-logo-source.png');
const OUT_DIR = path.resolve(__dirname, '../assets');

async function main() {
  // 1. Icono 1024×1024 con transparencia (sin fondo sólido; el CLI añade
  //    el fondo de color con --iconBackgroundColor)
  await sharp(SRC)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${OUT_DIR}/logo.png`);
  console.log('✓  assets/logo.png  (1024×1024)');

  // 2. Variante dark — idéntica por ahora (mismo icono)
  await sharp(SRC)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${OUT_DIR}/logo-dark.png`);
  console.log('✓  assets/logo-dark.png  (1024×1024)');

  // Papel (#f3eee1) y grafito (#17130d) = --bg de los temas día/noche del sitio
  // (src/index.css). Antes iban los dos a #0d1014, el gris azulado del tema
  // «Platino Eléctrico»: el icono y el splash de la app se quedaron en la
  // estética anterior cuando la web pasó a «Prensa del motor».
  console.log('\nListo. Ahora ejecuta:');
  console.log('npx capacitor-assets generate --android \\');
  console.log('  --iconBackgroundColor "#f3eee1" --iconBackgroundColorDark "#17130d" \\');
  console.log('  --splashBackgroundColor "#f3eee1" --splashBackgroundColorDark "#17130d"');
}

main().catch(err => { console.error(err); process.exit(1); });
