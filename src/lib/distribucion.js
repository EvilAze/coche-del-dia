// src/lib/distribucion.js
// La distribución de las partidas de un jugador: en cuántos intentos gana y
// cuántas pierde. Lógica pura, aparte de statsService (que importa el cliente
// de Supabase y no se puede cargar en un test sin envs).
//
// Cada fila trae su `status` y, de los intentos 2 a 5, un escalar que solo
// existe si ese intento existe (ver getMyDistribution): una partida ganada en
// tres intentos llega con i2 e i3 rellenos e i4/i5 a null.
export function contarDistribucion(filas) {
  const porIntento = [0, 0, 0, 0, 0];
  let perdidas = 0;
  for (const f of filas || []) {
    if (f?.status === "lost") {
      perdidas++;
      continue;
    }
    if (f?.status !== "won") continue;
    const n = 1 + ["i2", "i3", "i4", "i5"].filter((k) => f[k] != null).length;
    porIntento[n - 1]++;
  }
  const ganadas = porIntento.reduce((a, b) => a + b, 0);
  return { porIntento, perdidas, ganadas, jugadas: ganadas + perdidas };
}
