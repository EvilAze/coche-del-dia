# 🚗 Coche del Día

Juego diario de adivinar un coche — al estilo Wordle. 5 intentos. La imagen empieza muy ampliada y se aleja con cada fallo.

## Estructura del proyecto

```
coche-del-dia/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── CarImage.jsx       # Imagen del coche con zoom animado
│   │   ├── AttemptDots.jsx    # Indicador de intentos restantes
│   │   ├── HintLegend.jsx     # Leyenda de colores (✓ ✗ ≈)
│   │   ├── GuessRow.jsx       # Fila de un intento con resultado
│   │   ├── GuessForm.jsx      # Formulario de entrada
│   │   └── ResultPanel.jsx    # Panel final (victoria / derrota)
│   ├── data/
│   │   └── cars.js            # Base de datos de 30 coches + helpers
│   ├── hooks/
│   │   └── useGame.js         # Lógica completa del juego + localStorage
│   ├── App.jsx                # Componente raíz
│   ├── index.css              # Tailwind + Google Fonts
│   └── index.js               # Entry point React
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

## Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. Arrancar en desarrollo
npm start

# 3. Build para producción
npm run build
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Mecánica del juego

| Intento | Zoom imagen |
|---------|-------------|
| 1       | 2.8× (muy cerca) |
| 2       | 2.2× |
| 3       | 1.7× |
| 4       | 1.3× |
| 5       | 1.0× (vista completa) |

### Colores de resultado

- 🟩 **Verde** — correcto
- 🟥 **Rojo** — incorrecto
- 🟨 **Amarillo** — año incorrecto pero a ±3 años

### Persistencia

El progreso de cada día se guarda automáticamente en `localStorage`. Si cierras y vuelves a abrir, el juego continúa desde donde lo dejaste.

## Añadir más coches

Edita `src/data/cars.js` y añade objetos al array `CARS`:

```js
{
  id: 31,
  marca: "Ferrari",
  modelo: "LaFerrari",
  anio: 2013,
  img: "https://url-de-la-imagen.jpg",
},
```

La imagen debe ser de libre uso (Wikimedia Commons, Unsplash, etc.).

## Despliegue

Compatible con **Vercel**, **Netlify** o cualquier hosting estático:

```bash
npm run build
# Sube la carpeta /build
```
