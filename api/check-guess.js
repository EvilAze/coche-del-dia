import { CARS } from '../src/data/cars';

const ANIO_CORRECT_MARGIN = 2;
const ANIO_PARTIAL_MARGIN = 5;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST allowed' });

  const { guess, carId, attemptNumber } = req.body;
  const { marca, modelo, anio } = guess;

  // Usamos CARS en mayúsculas
  const realCar = CARS[carId];

  const anioNum = parseInt(anio);
  const diff = Math.abs(anioNum - realCar.anio);
  const marcaOk = marca.trim().toLowerCase() === realCar.marca.toLowerCase();
  const modeloOk = modelo.trim().toLowerCase() === realCar.modelo.toLowerCase();
  
  const result = {
    marca: { val: marca, status: marcaOk ? "correct" : "wrong" },
    modelo: { val: modelo, status: modeloOk ? "correct" : "wrong" },
    anio: {
      val: anio,
      status: (diff <= ANIO_CORRECT_MARGIN) ? "correct" : (diff <= ANIO_PARTIAL_MARGIN) ? "partial" : "wrong",
    },
    win: marcaOk && modeloOk && (diff <= ANIO_CORRECT_MARGIN),
  };

  // Solo desvelamos el coche real si ha ganado o si es su último intento
  const isGameOver = result.win || attemptNumber >= 5;

  res.status(200).json({
    result,
    carData: isGameOver ? realCar : null
  });
}