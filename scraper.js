/**
 * scraper.js — Coche del Día: generador automático de base de datos
 *
 * Fuente: API de Wikimedia Commons (abierta, sin login, sin captchas)
 * Uso:    node scraper.js
 *
 * Requisitos previos:
 *   npm install axios sharp
 *   mkdir -p public/coches
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const https = require("https");

const CAR_LIST = require("./carList");

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const CONFIG = {
  outputDir: path.resolve(__dirname, "./public/coches"),
  outputJs: path.resolve(__dirname, "./src/data/cars.js"),
  delayMs: 2500,          // pausa entre descargas (ms) — NO bajar de 1500
  userAgent: "CocheDelDiaBot/1.0 (juego educativo; contacto: tu@email.com)",
  timeoutMs: 15000,
  maxRetries: 2,
  imageWidth: 900,        // ancho máximo al que se redimensiona (px)
};
// ──────────────────────────────────────────────────────────────────────────────

// Asegurar que existe la carpeta de imágenes
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  console.log(`✅ Carpeta creada: ${CONFIG.outputDir}`);
}

/** Pausa genérica */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Llama a la API de búsqueda de Wikimedia Commons y devuelve
 * la URL de la primera imagen que encuentre para la query dada.
 */
async function buscarImagenWikimedia(query) {
  // Paso 1 — buscar el archivo por nombre
  const searchUrl = "https://commons.wikimedia.org/w/api.php";
  const params = {
    action: "query",
    list: "search",
    srsearch: `${query} car automobile`,
    srnamespace: 6,       // namespace 6 = File:
    srlimit: 5,
    format: "json",
    origin: "*",
  };

  const searchResp = await axios.get(searchUrl, {
    params,
    headers: { "User-Agent": CONFIG.userAgent },
    timeout: CONFIG.timeoutMs,
  });

  const hits = searchResp.data?.query?.search;
  if (!hits || hits.length === 0) return null;

  // Paso 2 — obtener la URL directa del primer resultado
  for (const hit of hits) {
    const title = hit.title; // e.g. "File:Ferrari F40.jpg"
    const infoUrl = "https://commons.wikimedia.org/w/api.php";
    const infoParams = {
      action: "query",
      titles: title,
      prop: "imageinfo",
      iiprop: "url|mime",
      format: "json",
      origin: "*",
    };

    const infoResp = await axios.get(infoUrl, {
      params: infoParams,
      headers: { "User-Agent": CONFIG.userAgent },
      timeout: CONFIG.timeoutMs,
    });

    const pages = infoResp.data?.query?.pages;
    if (!pages) continue;

    for (const page of Object.values(pages)) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      // Solo imágenes (no SVG ni PDFs)
      if (info.mime && !info.mime.startsWith("image/")) continue;
      if (info.mime === "image/svg+xml") continue;
      if (info.url) return info.url;
    }
  }

  return null;
}

/**
 * Descarga una imagen desde imageUrl y la guarda en destPath usando Axios.
 * Devuelve true si tuvo éxito.
 */
async function descargarImagen(imageUrl, destPath) {
  try {
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: CONFIG.timeoutMs,
      headers: { "User-Agent": CONFIG.userAgent } // ¡Aquí está el DNI que faltaba!
    });

    const file = fs.createWriteStream(destPath);
    response.data.pipe(file);

    return new Promise((resolve) => {
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      file.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        console.error(`    ⚠️  Error guardando archivo: ${err.message}`);
        resolve(false);
      });
    });
  } catch (err) {
    fs.unlink(destPath, () => {}); // Borra el archivo si se queda a medias
    console.error(`    ⚠️  Error de red/Timeout: ${err.message}`);
    return false;
  }


    request.on("error", (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      console.error(`    ⚠️  Error de red: ${err.message}`);
      resolve(false);
    });

    request.on("timeout", () => {
      request.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      console.error(`    ⚠️  Timeout descargando imagen`);
      resolve(false);
    });
  };


/**
 * Construye un nombre de archivo seguro a partir de marca + modelo + año.
 * Ejemplo: "ferrari_f40_1992.jpg"
 */
function nombreArchivo(car, ext = "jpg") {
  const slug = `${car.marca}_${car.modelo}_${car.anio}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${slug}.${ext}`;
}

/**
 * Detecta la extensión real de la imagen a partir de la URL.
 */
function detectarExtension(url) {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "png";
  if (clean.endsWith(".webp")) return "webp";
  if (clean.endsWith(".gif")) return "gif";
  return "jpg";
}

// ─── BUCLE PRINCIPAL ──────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚗  Coche del Día — Scraper de imágenes");
  console.log(`📋  Coches en lista: ${CAR_LIST.length}`);
  console.log(`📂  Destino imágenes: ${CONFIG.outputDir}`);
  console.log(`📄  Destino JS: ${CONFIG.outputJs}`);
  console.log(`⏱️  Delay entre descargas: ${CONFIG.delayMs}ms\n`);

  const resultados = []; // array final para cars.js
  const fallidos = [];   // coches sin imagen encontrada

  for (let i = 0; i < CAR_LIST.length; i++) {
    const car = CAR_LIST[i];
    const label = `${car.marca} ${car.modelo} (${car.anio})`;
    const prefix = `[${String(i + 1).padStart(3, "0")}/${CAR_LIST.length}]`;

    console.log(`${prefix} 🔍  ${label}`);

    // ── Comprobar si la imagen ya existe (reanudación) ──────────────────────
    const existingFiles = fs.readdirSync(CONFIG.outputDir).filter((f) =>
      f.startsWith(
        `${car.marca}_${car.modelo}_${car.anio}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
      )
    );

    if (existingFiles.length > 0) {
      const existingFile = existingFiles[0];
      console.log(`    ✅  Ya descargada: ${existingFile} (saltando)`);
      resultados.push({
        id: i + 1,
        marca: car.marca,
        modelo: car.modelo,
        anio: car.anio,
        img: `/coches/${existingFile}`,
      });
      continue;
    }

    // ── Buscar imagen en Wikimedia Commons ──────────────────────────────────
    let imageUrl = null;
    const queries = [
      `${car.marca} ${car.modelo} ${car.anio}`,
      `${car.marca} ${car.modelo}`,
      `${car.modelo} ${car.anio} automobile`,
    ];

    for (const query of queries) {
      try {
        imageUrl = await buscarImagenWikimedia(query);
        if (imageUrl) break;
      } catch (err) {
        console.error(`    ⚠️  Error buscando "${query}": ${err.message}`);
      }
      await sleep(500); // pequeña pausa entre intentos de búsqueda
    }

    if (!imageUrl) {
      console.log(`    ❌  Sin imagen encontrada para ${label}`);
      fallidos.push(car);
      // Añadimos igual al resultado con img vacío para no romper el array
      resultados.push({
        id: i + 1,
        marca: car.marca,
        modelo: car.modelo,
        anio: car.anio,
        img: null,
      });
      await sleep(CONFIG.delayMs);
      continue;
    }

    // ── Descargar imagen ────────────────────────────────────────────────────
    const ext = detectarExtension(imageUrl);
    const filename = nombreArchivo(car, ext);
    const destPath = path.join(CONFIG.outputDir, filename);

    let descargaOk = false;
    for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
      if (retry > 0) {
        console.log(`    🔄  Reintento ${retry}/${CONFIG.maxRetries}...`);
        await sleep(2000);
      }
      descargaOk = await descargarImagen(imageUrl, destPath);
      if (descargaOk) break;
    }

    if (descargaOk) {
      const stats = fs.statSync(destPath);
      const kb = (stats.size / 1024).toFixed(0);
      console.log(`    ✅  Guardada: ${filename} (${kb} KB)`);
      resultados.push({
        id: i + 1,
        marca: car.marca,
        modelo: car.modelo,
        anio: car.anio,
        img: `/coches/${filename}`,
      });
    } else {
      console.log(`    ❌  Descarga fallida: ${label}`);
      fallidos.push(car);
      resultados.push({
        id: i + 1,
        marca: car.marca,
        modelo: car.modelo,
        anio: car.anio,
        img: null,
      });
    }

    // ── Guardar progreso parcial cada 10 coches ─────────────────────────────
    if ((i + 1) % 10 === 0) {
      guardarJs(resultados);
      console.log(`    💾  Progreso guardado (${i + 1} coches procesados)\n`);
    }

    // ── DELAY OBLIGATORIO entre descargas ───────────────────────────────────
    await sleep(CONFIG.delayMs);
  }

  // ── GUARDAR ARCHIVO FINAL ─────────────────────────────────────────────────
  guardarJs(resultados);

  // ── RESUMEN ───────────────────────────────────────────────────────────────
  const exitosos = resultados.filter((r) => r.img !== null).length;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅  Imágenes descargadas: ${exitosos}/${CAR_LIST.length}`);
  console.log(`❌  Sin imagen:           ${fallidos.length}`);
  console.log(`📄  Archivo generado:     ${CONFIG.outputJs}`);

  if (fallidos.length > 0) {
    console.log("\n⚠️  Coches sin imagen (busca manualmente):");
    fallidos.forEach((c) =>
      console.log(`   - ${c.marca} ${c.modelo} (${c.anio})`)
    );
    // Guardar lista de fallidos en JSON para revisión
    const fallFile = path.join(__dirname, "fallidos.json");
    fs.writeFileSync(fallFile, JSON.stringify(fallidos, null, 2));
    console.log(`\n   Lista guardada en: ${fallFile}`);
  }

  console.log("\n🏁  ¡Proceso terminado!\n");
}

/** Genera y escribe el archivo src/data/cars.js */
function guardarJs(resultados) {
  const coches = resultados
    .filter((r) => r.img !== null) // omitir coches sin imagen
    .map((r) => ({
      id: r.id,
      marca: r.marca,
      modelo: r.modelo,
      anio: r.anio,
      img: r.img,
    }));

  const marcas = [...new Set(coches.map((c) => c.marca))].sort();

  const content = `// src/data/cars.js
// AUTOGENERADO por scraper.js — ${new Date().toISOString().slice(0, 10)}
// Total: ${coches.length} coches

export const CARS = ${JSON.stringify(coches, null, 2)};

export const MARCAS = ${JSON.stringify(marcas, null, 2)};

export function getCarOfDay() {
  const start = new Date(2024, 0, 1);
  const today = new Date();
  const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  return CARS[diff % CARS.length];
}
`;

  fs.writeFileSync(CONFIG.outputJs, content, "utf-8");
}

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("\n💥 Error fatal:", err);
  process.exit(1);
});
