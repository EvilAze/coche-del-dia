// src/components/configurator/SelectorHoja.jsx
// La HOJA: el contenedor de los selectores de marca, modelo y año en la app.
//
// POR QUÉ EXISTE. En la app, el cupón dejó de ser un formulario que se teclea y
// pasó a ser tres renglones que se tocan (ver CampoBoton). Cada uno abre esto:
// una hoja anclada al borde inferior con la lista de opciones dentro. El
// teclado del sistema no vuelve a aparecer sobre la pantalla de juego, y con él
// se fueron el salto de maqueta, el desplegable descolocado y los 170px de
// presupuesto vertical que se comía el formulario. En web no cambia nada: allí
// se sigue tecleando (ver GuessForm).
//
// SE APOYA EN ModalShell, que ya resuelve lo aburrido y lo importante: bloqueo
// de scroll de fondo, foco al abrir y devuelto al cerrar, trampa de tabulador,
// `role="dialog"` y las transiciones de entrada/salida. Reimplementarlo aquí
// habría sido escribir otra vez —peor— la accesibilidad que la app ya tiene.
//
// Y ese `role="dialog"` hace un trabajo extra que no se ve: src/lib/teclado.js
// IGNORA los campos de texto que viven dentro de un diálogo, así que cuando el
// jugador toca «buscar» y sube el teclado, la pantalla de juego de detrás no se
// entera ni se recompone. El teclado sube contra la hoja, que es la única
// superficie preparada para él.
//
// EL ALTO ES `dvh` A PROPÓSITO. Con el teclado abierto Android redimensiona el
// WebView, así que `dvh` ya vale lo que queda libre y la hoja se ajusta sola
// por encima del teclado. Sin medir nada y sin plugin.
//
// Y LA HOJA NO ES UNA PANTALLA, ES UNA BANDA: deja arriba el hueco de la
// fotografía y no lo tiñe. Eran 86dvh de lista bajo un velo al 72%, o sea que
// en el momento exacto de decidir —que es para lo que se abre— el jugador se
// quedaba sin lo único que hay que mirar. Ahora el alto máximo se calcula
// restando el hueco de la foto (`--pm-hueco-foto`, en index.css) y el velo es
// transparente: la separación la hacen el papel de la hoja y su filete de
// arriba, que es como se separan las cosas en este sistema. Del otro lado del
// hueco se ocupa useEscenarioApartado, que aparta la foto lo justo para que
// quepa entera. Tocar la foto sigue cerrando la hoja: el velo la cubre.

import { useCallback, useState } from "react";
import ModalShell from "../ModalShell";
import { useEscape } from "../../hooks/useEscape";
import { useEscenarioApartado } from "../../hooks/useEscenarioApartado";
import { useT } from "../../i18n";
import { Icon, I } from "./icons";

export default function SelectorHoja({
  open,
  onClose,
  titulo,
  // Línea de apoyo bajo el título (la horquilla del año, el «elige marca
  // primero»…). Opcional: sin ella el encabezado es solo el título.
  apunte = null,
  children,
}) {
  const { t } = useT();
  useEscape(open, onClose);

  // El panel, para poder medirlo. Va en ESTADO y no en un ref porque ModalShell
  // lo monta un render DESPUÉS de abrirse (primero decide que hay que montar,
  // luego anima la entrada): con un ref, el efecto que mide llegaría antes que
  // el nodo y no habría a qué volver. Con estado, la aparición del nodo es la
  // que dispara la medida.
  //
  // El `useCallback` no es adorno: un ref en línea se recrea en cada render y
  // React lo llamaría con null y con el nodo cada vez, encadenando medidas por
  // nada. Así solo se ejecuta al montar y al desmontar.
  const [hojaEl, setHojaEl] = useState(null);
  const anclar = useCallback(
    // El tirador es hijo del panel; `closest` sube al panel de ModalShell, que
    // es el que lleva la clase que este mismo componente le pone abajo.
    (nodo) => setHojaEl(nodo ? nodo.closest(".pm-hoja") : null),
    []
  );
  useEscenarioApartado(open, hojaEl);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={titulo}
      // Sin `modal-scrim`: el velo de la hoja no tiñe (ver la cabecera). Sigue
      // siendo una capa a pantalla completa, así que tocar la foto —o el
      // pliego— cierra la hoja igual que antes.
      backdropClassName="pm-hoja-velo fixed inset-0 z-[90] flex items-end justify-center"
      panelClassName="pm-hoja"
    >
      {/* El tirador: no arrastra nada (no hay gesto de arrastre), pero es el
          signo universal de «esto es una hoja que se cierra hacia abajo». El
          gesto real de cierre son el velo, la X y el atrás de Android. */}
      <div className="pm-hoja-tirador" aria-hidden="true" ref={anclar} />

      <div className="pm-hoja-cab">
        <div className="min-w-0">
          <h2 className="pm-hoja-titulo">{titulo}</h2>
          {apunte && <p className="pm-hoja-apunte">{apunte}</p>}
        </div>
        <button
          type="button"
          className="pm-hoja-cerrar"
          onClick={onClose}
          aria-label={t("cdd.selectorClose")}
        >
          <Icon d={I.x} size={18} />
        </button>
      </div>

      {/* El cuerpo es lo ÚNICO que se desplaza. La cabecera se queda fija
          arriba: con 80 marcas, perder el título al bajar deja al jugador sin
          saber qué está eligiendo. */}
      <div className="pm-hoja-cuerpo">{children}</div>
    </ModalShell>
  );
}
