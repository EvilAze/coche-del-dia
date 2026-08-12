// src/lib/historyTrap.js
// EL RELEVO: la contabilidad de la «entrada fantasma» de historial con la que
// los overlays capturan la pulsación de «atrás» del móvil.
//
// Vive fuera de los hooks porque el fallo peligroso aquí no es visual: es
// descuadrar la cuenta de entradas. Si nos dejamos una puesta, la siguiente
// «atrás» del usuario no hace nada (parece que la app se ha colgado); si
// consumimos una de más, le robamos una navegación real de su historial.
// Ninguno de los dos se ve en pantalla ni se reproduce en escritorio — solo en
// un Android, y tarde. Por eso la lógica se aísla y se testea.
//
// ── POR QUÉ HAY UNA SOLA TRAMPA PARA TODA LA APP ──────────────────────────
// Antes cada overlay creaba la suya: empujaba su entrada al abrir y la retiraba
// con `history.back()` al cerrar. Con un overlay a la vez cuadraba, pero el
// juego hace RELEVOS —del sumario al Archivo, del carnet al Archivo, de la
// clasificación al perfil ajeno— y ahí se rompía, porque los dos gestos no son
// simétricos:
//
//   · `pushState` es SÍNCRONO: la entrada aparece en el acto.
//   · `history.back()` es ASÍNCRONO: encola un recorrido, y el navegador
//     resuelve el «-1» CUANDO le toca, no cuando se pide.
//
// React ejecuta en un mismo commit primero las limpiezas y luego los efectos
// nuevos, así que al tocar «Archivo» en el sumario pasaba esto: el sumario
// encolaba su back(), el Archivo empujaba su entrada, y el recorrido encolado
// se comía LA DEL ARCHIVO. El resultado era un rebote —el panel abría y se
// cerraba solo en una fracción de segundo— reproducible en el APK y en ningún
// sitio más: jsdom se traga ese back() y en escritorio nadie usa la «atrás».
//
// Ahora hay UNA entrada fantasma para toda la app y una PILA de manejadores.
// Abrir un overlay es apuntarse a la pila; cerrarlo, borrarse. La entrada solo
// se retira cuando la pila se queda vacía, y esa retirada se aplaza a una
// microtarea: si en el mismo commit otro overlay toma el testigo, no se toca el
// historial en absoluto. Un relevo deja de ser dos operaciones sobre el
// historial para ser cero.
//
// Contrato del manejador (lo que devuelve al recibir una «atrás»):
//   true  → el overlay sigue abierto (solo retrocedió un nivel interno), así
//           que hay que reponer la entrada para la siguiente pulsación.
//   false → el overlay se cerró del todo.

export function crearRelevo(ventana) {
  // Pila de overlays vivos. El último que se apunta es el que está ENCIMA en
  // pantalla, así que es el único que recibe la pulsación: sin esto, con el
  // pliego del resultado abierto y el Archivo encima, una sola «atrás» cerraba
  // los dos a la vez.
  const manejadores = [];

  // ¿Hay una entrada nuestra viva en el historial ahora mismo?
  let armada = false;
  // ¿Hay ya una retirada aplazada esperando su microtarea?
  let retiradaPendiente = false;
  // Recorridos que hemos pedido NOSOTROS y cuyo popstate aún no ha llegado.
  // El navegador tarda en digerirlos, y en ese hueco puede abrirse un overlay
  // (El Archivo es un chunk perezoso: llega cuando llega). Sin esta cuenta, su
  // entrada recién puesta se la comería nuestro propio back() — el mismo
  // rebote, por la puerta de atrás.
  let propios = 0;
  let escuchando = false;

  function alPop() {
    if (propios > 0) {
      // Era nuestro: el navegador acaba de digerir una retirada.
      propios -= 1;
      return;
    }
    // Sin trampa puesta no hay nada que interceptar: esto es una navegación de
    // verdad del usuario y no nos toca meternos.
    if (!armada) return;

    // El navegador acaba de consumir NUESTRA entrada.
    armada = false;
    const arriba = manejadores[manejadores.length - 1];
    const sigueAbierto = arriba ? Boolean(arriba()) : false;

    // Reponemos si el overlay de arriba sigue abierto (le quedaban niveles) o
    // si debajo queda otro esperando su pulsación. El manejador que acaba de
    // cerrarse aún está en la pila: se borra en el commit siguiente, de ahí el
    // `> 1` en vez de `> 0`.
    if (sigueAbierto || manejadores.length > 1) armar();
  }

  function armar() {
    if (armada) return;
    if (!escuchando) {
      ventana.addEventListener("popstate", alPop);
      escuchando = true;
    }
    ventana.history.pushState({ cddOverlay: true }, "");
    armada = true;
  }

  function retirar() {
    if (!armada) return;
    armada = false;
    // `back()` siempre tiene a dónde ir: solo retiramos con la trampa puesta, y
    // ponerla implica que hay una entrada nuestra encima de la del usuario. Por
    // eso el popstate llega seguro y la cuenta de `propios` no se queda colgada.
    propios += 1;
    ventana.history.back();
  }

  function programarRetirada() {
    if (retiradaPendiente) return;
    retiradaPendiente = true;
    // La microtarea es el margen del relevo: corre después de que React haya
    // terminado el commit entero (limpiezas Y efectos nuevos), así que aquí ya
    // se sabe si el testigo ha pasado a otro overlay o si de verdad no queda
    // ninguno abierto.
    queueMicrotask(() => {
      retiradaPendiente = false;
      if (manejadores.length > 0) return;
      retirar();
    });
  }

  return {
    // Overlay abierto. Devuelve la función de baja (la limpieza del efecto).
    registrar(manejador) {
      manejadores.push(manejador);
      armar();
      let dadoDeBaja = false;
      return () => {
        // Idempotente: React puede llamar dos veces a la limpieza en el
        // montaje doble de StrictMode, y una baja de más descuadraría la pila.
        if (dadoDeBaja) return;
        dadoDeBaja = true;
        const i = manejadores.lastIndexOf(manejador);
        if (i !== -1) manejadores.splice(i, 1);
        if (manejadores.length === 0) programarRetirada();
      };
    },

    // Solo para las pruebas y para diagnosticar: el estado de la trampa.
    get armada() {
      return armada;
    },
    get abiertos() {
      return manejadores.length;
    },
  };
}

// La instancia única de la app, perezosa: así el módulo se puede importar en
// entornos sin `window` (tests de lógica pura, SSR) sin tocar nada.
let compartido = null;

export function relevoGlobal() {
  if (!compartido) compartido = crearRelevo(window);
  return compartido;
}

// Semilla para las pruebas del cableado con React: permite inyectar una ventana
// falsa que SÍ modela la cola de recorridos del navegador. jsdom no la modela
// —se traga el `back()` encolado si alguien empuja después—, que es justamente
// por lo que este bug llegó a producción sin que ninguna suite se enterara.
export function instalarRelevoParaTest(relevo) {
  compartido = relevo;
}
