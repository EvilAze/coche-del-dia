// src/lib/compas.js
// EL COMPÁS, DEL LADO DEL JAVASCRIPT.
//
// Los peldaños viven en `:root` de index.css con su porqué, y `tailwind.config.js`
// apunta a esas MISMAS variables en vez de copiarlas. Faltaba el tercer
// consumidor: el JavaScript, que también programa tiempos —el revelado que se
// abre solo al terminar la partida, por ejemplo— y los venía escribiendo a
// mano. Un `900` suelto en un `setTimeout` no lo caza `test:estetica` (solo mira
// index.css) y no lo caza el build, así que es exactamente por donde el compás
// se vuelve a desafinar.
//
// RÉPLICA CON TEST DE SINCRONÍA, que es como este proyecto resuelve ya sus
// constantes compartidas (`src/lib/zoom.js` ↔ `api/_lib/zoom.js`,
// `resultCode.js`): los números se escriben dos veces y hay un test que falla si
// dejan de coincidir. La alternativa —leerlos en caliente con getComputedStyle—
// obliga igualmente a un respaldo escrito a mano para jsdom y para el primer
// frame, así que serían los mismos dos sitios con una lectura de layout de
// propina.
//
// Si tocas un peldaño, tócalo en index.css: `compas.sync.test.js` te dirá que
// vengas aquí.

export const MS = {
  pulso: 90,
  roce: 160,
  hoja: 200,
  sello: 280,
  escena: 460,
  revelado: 720,
  latido: 1200,
  paso: 40,
};
