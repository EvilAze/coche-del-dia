/**
 * Genera los assets fuente para @capacitor/assets (Easy Mode).
 * Entrada: public/web-app-manifest-512x512.png (512×512, RGBA)
 * Salida:
 *   assets/logo.png       — 1024×1024, icono sobre fondo transparente
 *   assets/logo-dark.png  — mismo (válido para modo oscuro)
 *
 * En Easy Mode, capacitor-assets genera el splash internamente usando
 * los colores de fondo que pasamos por CLI, así que NO necesitamos
 * un splash.png manual.
 *
 * Ejecutar con: node scripts/gen-cap-assets.js
 */
const sharp = require('sharp');
const path = require('path');

const SRC = path.resolve(__dirname, '../public/web-app-manifest-512x512.png');
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

  console.log('\nListo. Ahora ejecuta:');
  console.log('npx capacitor-assets generate --android \\');
  console.log('  --iconBackgroundColor "#0d1014" --iconBackgroundColorDark "#0d1014" \\');
  console.log('  --splashBackgroundColor "#0d1014" --splashBackgroundColorDark "#0d1014"');
}

main().catch(err => { console.error(err); process.exit(1); });
