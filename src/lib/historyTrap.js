// src/lib/historyTrap.js
// Contabilidad PURA de la «entrada fantasma» de historial con la que un
// overlay captura la pulsación de «atrás» del móvil.
//
// Vive fuera del hook porque el fallo peligroso aquí no es visual: es
// descuadrar la cuenta de entradas. Si nos dejamos una puesta, la siguiente
// «atrás» del usuario no hace nada (parece que la app se ha colgado); si
// consumimos una de más, le robamos una navegación real de su historial.
// Ninguno de los dos se ve en pantalla ni se reproduce en escritorio — solo
// en un Android, y tarde. Por eso la lógica se aísla y se testea.
//
// Contrato de `onBack()`:
//   true  → el overlay sigue abierto (solo retrocedió un nivel interno), así
//           que hay que reponer la trampa para la siguiente pulsación.
//   false → el overlay se cerró del todo; la «atrás» vuelve a ser navegación.

export function createHistoryTrap(history, onBack) {
  // ¿Hay una entrada nuestra viva en el historial ahora mismo?
  let armed = false;

  const push = () => {
    history.pushState({ cddOverlay: true }, "");
    armed = true;
  };

  return {
    // Overlay abierto: ponemos la trampa.
    arm() {
      if (!armed) push();
    },

    // El navegador acaba de consumir NUESTRA entrada (el usuario pulsó atrás).
    // Devuelve si la trampa sigue puesta tras resolver el nivel.
    handlePop() {
      armed = false;
      if (onBack()) push();
      return armed;
    },

    // Cierre por UI (X, scrim, Escape). Solo retiramos la entrada si sigue
    // puesta: si el cierre vino de una «atrás», el navegador ya la consumió y
    // volver atrás otra vez se comería una entrada real del usuario.
    disarm() {
      if (!armed) return false;
      armed = false;
      history.back();
      return true;
    },

    get armed() {
      return armed;
    },
  };
}
