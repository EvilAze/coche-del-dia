// src/components/Superficie.jsx
// UNA SUPERFICIE DE NAVEGACIÓN: la clasificación, el archivo, el perfil, el
// sumario, las reglas. Dicho de otra forma: los sitios a los que se VA, no las
// preguntas que se contestan.
//
// LA REGLA, QUE ES LO ÚNICO QUE HAY QUE RECORDAR (CLAUDE.md #24):
//
//   · Superficie de NAVEGACIÓN (vas a un sitio) → hoja inferior arrastrable
//     (Vaul) en la app y en móvil web, con inercia nativa, rebote elástico y
//     profundidad sobre la pantalla de fondo; en escritorio ancho, la tarjeta
//     centrada de siempre (`ModalShell`).
//   · Diálogo de DECISIÓN (contestas algo y vuelves) → tarjeta centrada, en app
//     y en web. Entrar, elegir firma, borrar la cuenta, escribir al equipo: eso
//     no es un sitio, es una pregunta, y una pregunta se pone delante. Siguen
//     usando `ModalShell` a pelo, y así debe quedarse.
//
// POR QUÉ VAUL AQUÍ Y NO EN `SelectorHoja`. La hoja del cupón (`SelectorHoja`)
// está coreografiada al frame con el marco de la fotografía (`useEscenarioApartado`)
// y con `--cdd-teclado` + el índice A-Z (regla 18); no debe tocarse. En cambio,
// las superficies de navegación viajan solas y ganan muchísimo con la física de
// Vaul (arrastre con amortiguación elástica, handoff inteligente con el scroll
// del cuerpo y escala sutil del fondo) tanto en el APK como en navegadores
// móviles.

import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import ModalShell from "./ModalShell";
import { esApp } from "../lib/plataforma";

// En móvil web (< 640px) las superficies de navegación también se presentan
// como hojas inferiores nativas; en escritorio ancho conservan la tarjeta
// centrada donde el puntero es preciso y una hoja anclada abajo sería rara.
const QUERY_MOVIL = "(max-width: 639px)";

function useEsHoja() {
  const [esMovil, setEsMovil] = useState(() => {
    if (esApp()) return true;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(QUERY_MOVIL).matches;
  });

  useEffect(() => {
    if (esApp() || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(QUERY_MOVIL);
    const onChange = (e) => setEsMovil(e.matches);
    setEsMovil(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return esApp() || esMovil;
}

// Extrae la capa z-* con nombre (`z-hoja`, `z-hoja-sobre`, `z-dialogo`…) del
// string de clases del caller para respetar la pila cuando una superficie se
// abre encima de otra (p. ej. el perfil público o la ayuda sobre el ranking).
function capaDe(clases) {
  if (!clases) return "z-hoja";
  const match = clases.match(/\bz-(?:barra|panel|hoja-sobre|hoja|dialogo-sobre|dialogo|aviso)\b/);
  return match ? match[0] : "z-hoja";
}

export default function Superficie({
  open,
  onClose,
  // Nombre accesible del diálogo.
  label,
  // Clases del VELO. El caller las escribe enteras porque la pila de capas la
  // conoce él: el perfil público se abre SOBRE la clasificación.
  veloWeb,
  veloApp,
  // Clases del panel en escritorio web: las que el caller ya tenía.
  panelWeb,
  // Aire del cuerpo cuando se muestra como hoja. Por defecto el del resto de
  // paneles; el Archivo lo deja vacío porque su contenido trae el suyo.
  cuerpoApp = "px-5 pb-4 pt-2",
  dismissOnBackdrop = true,
  children,
}) {
  const usarHoja = useEsHoja();

  if (!usarHoja) {
    return (
      <ModalShell
        open={open}
        onClose={onClose}
        label={label}
        dismissOnBackdrop={dismissOnBackdrop}
        backdropClassName={veloWeb}
        panelClassName={panelWeb}
      >
        {children}
      </ModalShell>
    );
  }

  const capa = capaDe(veloApp);
  // Solo la primera hoja escala el fondo: si una segunda hoja (`z-hoja-sobre`,
  // como el perfil ajeno sobre la clasificación) intentara volver a escalar el
  // wrapper, pelearía con la transformación ya activa de la primera.
  const esCapaSobre = capa === "z-hoja-sobre" || capa === "z-dialogo-sobre";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
      dismissible={dismissOnBackdrop}
      shouldScaleBackground={!esCapaSobre}
      // Nunca pintar `black` crudo en el body al escalar: Asfalto tiene edición
      // de día (niebla) y de noche (grafito), y el fondo real vive en `--bg`.
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className={`cdd-vaul-velo fixed inset-0 ${capa}`} />
        <Drawer.Content
          // Sin descripción obligatoria: evita avisos de Radix cuando la hoja
          // ya presenta su contenido estructurado con título propio.
          aria-describedby={undefined}
          className={`pm-hoja-nav cdd-vaul-hoja ${capa}`}
        >
          <Drawer.Title className="sr-only">{label}</Drawer.Title>
          <div className="pm-hoja-tirador" aria-hidden="true" />
          {/* `pm-hoja-cuerpo` y `pm-hoja-cuerpo--nav` conservan el contrato de
              scroll del cuerpo (no del panel) que verifica `test:layout`. */}
          <div className={`pm-hoja-cuerpo pm-hoja-cuerpo--nav ${cuerpoApp}`}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
