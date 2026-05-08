const fs = require('fs');
const path = require('path');

// Configuración de rutas
const dirCoches = path.join(__dirname, 'public', 'coches');
const archivoSalida = path.join(__dirname, 'src', 'data', 'cars.js');

console.log("🔍 Escaneando carpeta de imágenes...");

try {
    // 1. Leer todos los archivos de la carpeta
    const archivos = fs.readdirSync(dirCoches);
    
    // 2. Filtrar solo imágenes y transformarlas en objetos de coche
    const cochesEncontrados = archivos
        .filter(file => file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp'))
        .map((file, index) => {
            // Quitamos la extensión (.jpg)
            const nombreSinExt = file.substring(0, file.lastIndexOf('.'));
            
            // Separamos por los guiones bajos (marca_modelo_anio)
            const partes = nombreSinExt.split('_');
            
            // Intentamos sacar los datos (si el nombre está bien formado)
            const marca = partes[0] ? partes[0].charAt(0).toUpperCase() + partes[0].slice(1) : "Desconocida";
            const anio = partes[partes.length - 1] || "2000";
            // El modelo es todo lo que hay en medio
            const modelo = partes.slice(1, -1).join(' ').toUpperCase() || "Modelo";

            return {
                id: index + 1,
                marca: marca,
                modelo: modelo,
                anio: parseInt(anio),
                img: `/coches/${file}`
            };
        });

    // 3. Generar el contenido del archivo cars.js
    const marcasUnicas = [...new Set(cochesEncontrados.map(c => c.marca))].sort();
    
    const contenidoJS = `// src/data/cars.js
// AUTOGENERADO POR SYNC.JS - ${new Date().toLocaleDateString()}
// Total coches detectados: ${cochesEncontrados.length}

export const CARS = ${JSON.stringify(cochesEncontrados, null, 2)};

export const MARCAS = ${JSON.stringify(marcasUnicas, null, 2)};

export function getCarOfDay() {
  const start = new Date(2024, 0, 1);
  const today = new Date();
  const diff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  return CARS[diff % CARS.length];
}
`;

    // 4. Guardar el archivo
    fs.writeFileSync(archivoSalida, contenidoJS);
    
    console.log(`✅ ¡ÉXITO! Tu cars.js ahora tiene los ${cochesEncontrados.length} coches que tienes en la carpeta.`);

} catch (error) {
    console.error("❌ Error al sincronizar:", error.message);
}