// src/components/Superficie.jsx
// UNA SUPERFICIE DE NAVEGACIÓN: la clasificación, el archivo, el perfil, el
// sumario, las reglas. Dicho de otra forma: los sitios a los que se VA, no las
// preguntas que se contestan.
//
// POR QUÉ EXISTE. Todas ellas eran `ModalShell` con la misma receta —tarjeta
// centrada de 384px que entra encogiendo desde el centro sobre un velo—, que es
// el diálogo de escritorio de toda la vida. Dentro del APK eso tiene un nombre:
// una web disfrazada de app. Y lo que lo delataba no era la tarjeta en sí sino
// el CONTRASTE: el cupón se había trabajado hasta el frame (regla 18) y abrir el
// Archivo seguía sintiéndose de otra aplicación. Una app no puede tener dos
// idiomas de presentación.
//
// LA REGLA, QUE ES LO ÚNICO QUE HAY QUE RECORDAR:
//
//   · Superficie de NAVEGACIÓN (vas a un sitio) → hoja en la app.
//   · Diálogo de DECISIÓN (contestas algo y vuelves) → tarjeta centrada, en app
//     y en web. Entrar, elegir firma, borrar la cuenta, escribir al equipo: eso
//     no es un sitio, es una pregunta, y una pregunta se pone delante. Siguen
//     usando `ModalShell` a pelo, y así debe quedarse.
//
// EN WEB NO CAMBIA NADA, y es deliberado: allí la ventana es ancha, el puntero
// es preciso y una hoja anclada abajo sería una rareza. El caller sigue pasando
// exactamente las clases que ya tenía (`panelWeb`), así que la web se queda
// byte a byte como estaba.
//
// LO QUE APORTA EN LA APP, además del chasis: el TIRADOR y su gesto. Se arrastra
// hacia abajo para cerrarla, con el mismo `useArrastreHoja` que la hoja del
// cupón — el tirador no se dibuja nunca sin el gesto, que fue exactamente el
// pecado que este proyecto ya cometió una vez («durante meses fue un adorno de
// tres píxeles prometiendo un gesto que no existía»).
//
// El gesto va en UN SOLO SENTIDO, hacia abajo, igual que en la hoja del cupón:
// hacia arriba manda el navegador y la lista scrollea nativa, con su inercia
// (ver la cabecera de `useArrastreHoja`, donde está el porqué).

import { useCallback, useState } from "react";
import ModalShell from "./ModalShell";
import { useArrastreHoja } from "../hooks/useArrastreHoja";
import { esApp } from "../lib/plataforma";

// Estable entre renders: si fuera una flecha en línea, el hook la recibiría
// nueva cada vez. Da igual (la guarda en un ref), pero declararla fuera dice que
// es una constante y no configuración. Aquí no hay fotografía que mover con la
// hoja: la superficie viaja sola.
const NADA_QUE_SEGUIR = () => {};

export default function Superficie({
  open,
  onClose,
  // Nombre accesible del diálogo.
  label,
  // Clases del VELO. El caller las escribe enteras (con su `z-[…]` literal,
  // que Tailwind necesita ver en el fuente para generarlo) porque la pila de
  // capas la conoce él: el perfil público se abre SOBRE la clasificación.
  veloWeb,
  veloApp,
  // Clases del panel en web: las que el caller ya tenía. En la app no se usan —
  // allí el panel es la hoja y punto.
  panelWeb,
  // Aire del cuerpo en la app. Por defecto el del resto de paneles; el Archivo
  // lo deja vacío porque su contenido trae el suyo.
  cuerpoApp = "px-5 pb-4 pt-2",
  dismissOnBackdrop = true,
  children,
}) {
  const enApp = esApp();

  // El panel, para poder agarrarlo. Va en ESTADO y no en un ref por lo mismo que
  // en SelectorHoja: ModalShell monta el nodo un render DESPUÉS de abrirse, así
  // que un ref llegaría antes que el nodo. El `useCallback` evita que React
  // ejecute el ref con null y con el nodo en cada render.
  const [hojaEl, setHojaEl] = useState(null);
  const anclar = useCallback(
    (nodo) => setHojaEl(nodo ? nodo.closest(".pm-hoja-nav") : null),
    []
  );

  useArrastreHoja({
    hojaEl,
    activo: enApp && open,
    onCerrar: onClose,
    onDesplazar: NADA_QUE_SEGUIR,
  });

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={label}
      dismissOnBackdrop={dismissOnBackdrop}
      backdropClassName={enApp ? veloApp : veloWeb}
      panelClassName={enApp ? "pm-hoja-nav" : panelWeb}
      // La hoja entra deslizándose desde el borde, entera: un objeto que se
      // trae a mano, no un dibujo que se desvanece. La tarjeta de la web
      // conserva su entrada de siempre (los valores por defecto del chasis).
      panelEntraClassName={enApp ? "opacity-100 translate-y-0" : undefined}
      panelSaleClassName={enApp ? "opacity-100 translate-y-full" : undefined}
      // La hoja sí puede salir más rápido de lo que entró (a diferencia de la
      // del cupón, que va coreografiada con el marco de la fotografía): aquí no
      // hay ninguna otra pieza con la que caer en el mismo frame.
    >
      {enApp ? (
        <>
          <div className="pm-hoja-tirador" aria-hidden="true" ref={anclar} />
          {/* `pm-hoja-cuerpo` además de la variante: es la clase que el arrastre
              busca para saber cuánto contenido queda por debajo del corte. */}
          <div className={"pm-hoja-cuerpo pm-hoja-cuerpo--nav " + cuerpoApp}>
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </ModalShell>
  );
}
