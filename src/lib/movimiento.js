// src/lib/movimiento.js
// Lo que el sistema sabe sobre el movimiento desde JavaScript.
//
// El CSS ya tiene su mitad resuelta en un solo sitio (index.css: los peldaños
// del compás y la regla que lo apaga todo bajo `prefers-reduced-motion`). Esto
// es la otra mitad, la que el CSS no alcanza: los desplazamientos que se piden
// por código y las APIs del navegador que animan por su cuenta.
//
// Por qué existe: `prefers-reduced-motion` se consultaba en UN sitio
// (lib/haptics.js) y en ningún otro, así que los tres `scrollIntoView({
// behavior: "smooth" })` de la app —volver a la foto desde el recorte, recolocar
// el cupón al enviar, el reacomodo del teclado— seguían desplazando la pantalla
// con animación a quien había pedido explícitamente que no. Es justo el gesto
// que peor sienta a quien tiene sensibilidad vestibular: la pantalla entera
// moviéndose sola.

// ¿El usuario ha pedido menos movimiento? Protegido para poder importarse en
// node (los tests corren sin DOM en varios ficheros).
export function menosMovimiento() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Desplazamiento suave que se convierte en salto instantáneo cuando toca. El
// destino es el mismo en los dos casos: lo que cambia es si se ve el viaje.
export function desplazarSuave(el, opciones = {}) {
  if (!el?.scrollIntoView) return;
  el.scrollIntoView({
    ...opciones,
    behavior: menosMovimiento() ? "auto" : "smooth",
  });
}

// Envuelve un cambio visual en una transición de vista del navegador, que
// fotografía el ANTES y el DESPUÉS y los cruza. Se usa para el cambio de
// edición día/noche: sin ella, toda la pantalla —papel, tinta, filetes, la
// fotografía— salta de golpe de un tema al otro en un fotograma.
//
// Es mejora progresiva de las de verdad: donde la API no existe (o donde se ha
// pedido menos movimiento), se ejecuta el cambio a pelo y no se nota nada
// distinto de lo que había. No se espera a la promesa: la función tiene que
// devolver el control inmediatamente para que el estado de React siga su curso.
export function conCruce(cambio) {
  if (typeof document === "undefined" || menosMovimiento() || !document.startViewTransition) {
    cambio();
    return;
  }
  try {
    document.startViewTransition(cambio);
  } catch {
    // Navegador que anuncia la API pero falla al usarla: el cambio se aplica
    // igual. Un tema que no cambia sería mucho peor que un tema sin cruce.
    cambio();
  }
}
