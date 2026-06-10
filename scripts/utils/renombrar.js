const fs = require('fs');

const content = fs.readFileSync('./src/data/cars.js', 'utf8');
const match = content.match(/export const CARS = (\[[\s\S]*?\]);/);

if (match) {
    const cars = eval(match[1]);
    let count = 0;
    
    // Usamos el 'index' (0, 1, 2...) en lugar del id
    cars.forEach((car, index) => {
        const oldPath = `./public${car.img}`;
        const newPath = `./public/coches/${index}.jpg`; 
        
        if (fs.existsSync(oldPath)) {
            fs.renameSync(oldPath, newPath);
            count++;
        }
    });
    console.log(`¡Jaque Mate Navarro! Se han renombrado ${count} imágenes a números ocultos.`);
} else {
    console.log("No se pudo leer cars.js");
}