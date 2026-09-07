// src/lib/insets.js
// LOS INSETS DEL SISTEMA, PEDIDOS AL ARRANCAR.
//
// En la app, las cuatro variables `--safe-area-inset-*` que consume index.css
// las publica el nativo (`InsetsBridgePlugin`, en android/), porque el `env()`
// del WebView no es de fiar: mide bien la barra de estado y devuelve CERO en la
// de gestos por debajo de Chromium 140 — que es lo que dibujaba la última fila
// de la lista de marcas y el reloj de cierre debajo del sistema.
//
// El nativo EMPUJA los valores cuando cambian, pero un estilo en línea no
// sobrevive a una recarga de la página, y esta app recarga sola (cambio de día,
// coche cambiado). Esto es el TIRÓN: se piden una vez al arrancar, síncrono,
// antes del primer pintado. Sin él, la pantalla recién recargada volvería a
// dibujarse bajo la barra hasta el siguiente evento de layout del sistema.
//
// En web es un no-op absoluto: no hay puente, no se toca nada y manda el
// `env()` del navegador, que allí sí funciona (y donde vale 0 porque no hay
// barras que esquivar).

/**
 * Lee los insets del puente nativo y los escribe en el documento. Silencioso y
 * sin efecto si no hay puente o si contesta algo raro: unos insets a cero son
 * exactamente lo que había antes de existir esto, así que el peor caso es el
 * comportamiento anterior y nunca una pantalla rota (regla 9).
 */
export function aplicarInsetsNativos() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const puente = window.CddInsets;
  if (!puente || typeof puente.leer !== "function") return;

  let crudo;
  try {
    crudo = puente.leer();
  } catch {
    return;
  }

  const partes = String(crudo).split(",");
  if (partes.length !== 4) return;

  const nombres = ["top", "right", "bottom", "left"];
  const estilo = document.documentElement.style;
  partes.forEach((valor, i) => {
    const n = Number(valor);
    // `Number("")` es 0 y `Number("x")` es NaN: solo pasa un número de verdad.
    if (!Number.isFinite(n) || n < 0) return;
    estilo.setProperty(`--safe-area-inset-${nombres[i]}`, `${n}px`);
  });
}
