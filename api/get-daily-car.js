import { CARS } from '../src/data/cars';

export default function handler(req, res) {
  const now = new Date();
  const spainTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const start = new Date(spainTime.getFullYear(), 0, 0);
  const diff = spainTime - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  const carIndex = dayOfYear % CARS.length;

  res.status(200).json({
    id: carIndex,
    img: `/coches/${carIndex}.jpg` 
  });
}