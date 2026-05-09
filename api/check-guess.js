import { CARS, MARCA_PAIS } from "../src/data/cars";

const ANIO_CORRECT_MARGIN = 2;
const ANIO_PARTIAL_MARGIN = 5;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function getPaisByMarca(marca) {
  const normalized = normalize(marca);
  const canonicalMarca = Object.keys(MARCA_PAIS).find(
    (m) => normalize(m) === normalized
  );

  return canonicalMarca ? MARCA_PAIS[canonicalMarca] : null;
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Only POST allowed" });
  }

  const { guess, carId, attemptNumber } = req.body;
  const { marca, modelo, anio } = guess;

  const realCar = CARS[carId];

  if (!realCar) {
    return res.status(404).json({ message: "Car not found" });
  }

  const anioNum = parseInt(anio);
  const diff = Math.abs(anioNum - realCar.anio);

  const marcaOk = normalize(marca) === normalize(realCar.marca);
  const modeloOk = normalize(modelo) === normalize(realCar.modelo);

  const guessedPais = getPaisByMarca(marca);
  const realPais = realCar.pais || getPaisByMarca(realCar.marca);
  const paisOk = !marcaOk && guessedPais && realPais && guessedPais === realPais;

  const result = {
    marca: {
      val: marca,
      status: marcaOk ? "correct" : paisOk ? "partial" : "wrong",
      pais: guessedPais,
    },
    modelo: {
      val: modelo,
      status: modeloOk ? "correct" : "wrong",
    },
    anio: {
      val: anio,
      status:
        diff <= ANIO_CORRECT_MARGIN
          ? "correct"
          : diff <= ANIO_PARTIAL_MARGIN
          ? "partial"
          : "wrong",
    },
    win: marcaOk && modeloOk && diff <= ANIO_CORRECT_MARGIN,
  };

  const isGameOver = result.win || attemptNumber >= 5;

  let finalCarData = null;
  if (isGameOver) {
    finalCarData = {
      ...realCar,
      img: `/coches/${carId}.jpg`,
    };
  }

  res.status(200).json({
    result,
    carData: finalCarData,
  });
}
