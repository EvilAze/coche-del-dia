// src/components/configurator/BotonMantener.jsx
// ADIVINAR MANTENIENDO — el botón del Modo Veterano.
//
// En el Veterano hay UN intento. Un toque suelto (el pulgar que roza el botón
// al ir a cerrar la hoja de selección) gastaría la partida entera, así que se
// confirma manteniendo: el oro llena el botón de izquierda a derecha y, si
// sueltas antes, se vacía. Es la misma idea que el «desliza para apagar» de un
// teléfono: no hace falta preguntar «¿seguro?», el gesto ya lo pregunta.
//
// SE SIENTE SUBIR. Tres toques cada vez más firmes mientras se llena (a un
// cuarto, a la mitad y a tres cuartos) y uno seco al completarse: la mano sabe
// cuánto falta sin mirar. Si el formulario está incompleto no hay nada que
// confirmar: el primer toque envía y el formulario hace su temblor y su aviso,
// como el ADIVINAR de siempre.
//
// Teclado: Espacio o Intro mantenidos hacen lo mismo que el dedo.
//
// Y DOS TOQUES, para quien no puede mantener (auditoría 7-oct). El botón solo
// escuchaba pointerdown y keydown, pero TalkBack y VoiceOver activan con un
// click sintético: con lector de pantalla el Veterano no se podía jugar. Ahora
// un click que no viene de un mantener completado ARMA el botón («Toca otra vez
// para confirmar») y un segundo click en los 4 s siguientes lo envía. Sigue
// pidiendo un gesto deliberado —un roce suelto solo arma—, que es lo que este
// botón protege. El nombre accesible es el texto visible (WCAG 2.5.3): antes
// decía «Mantén pulsado para adivinar» junto a un «Mantén para adivinar».

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";

// Lo que hay que mantener. Algo menos de un segundo: lo bastante para que un
// roce no cuente y lo bastante poco para que no se sienta como una espera.
// El CSS lo lee de `--mantener-ms` (lo escribe este componente), así que el
// relleno y el temporizador no pueden separarse.
const MANTENER_MS = 900;
// Cuánto dura armado el botón esperando el segundo toque.
const ARMADO_MS = 4000;
const PELDANOS = [
  [0.25, () => haptic.selection()],
  [0.5, () => haptic.impactLight()],
  [0.75, () => haptic.impactMedium()],
];

export default function BotonMantener({ onConfirmar, listo, enviando, deshabilitado }) {
  const { t } = useT();
  const [manteniendo, setManteniendo] = useState(false);
  const [armado, setArmado] = useState(false);
  const raf = useRef(0);
  const inicio = useRef(0);
  const dado = useRef(0);
  // ¿El click que llega viene de un gesto que ya hizo su trabajo? Un mantener
  // completado ya envió; un pointerdown/keydown con el cupón incompleto ya
  // lanzó la validación. En los dos casos el click siguiente no debe armar.
  const yaAtendido = useRef(false);
  const relojArmado = useRef(0);

  function desarmar() {
    clearTimeout(relojArmado.current);
    setArmado(false);
  }

  function parar() {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setManteniendo(false);
  }

  function empezar() {
    if (deshabilitado || enviando || raf.current) return;
    // Incompleto: no hay nada que confirmar, que hable el formulario.
    if (!listo) {
      yaAtendido.current = true;
      onConfirmar();
      return;
    }
    setManteniendo(true);
    inicio.current = performance.now();
    dado.current = 0;
    const paso = (ahora) => {
      const p = (ahora - inicio.current) / MANTENER_MS;
      while (dado.current < PELDANOS.length && p >= PELDANOS[dado.current][0]) {
        PELDANOS[dado.current][1]();
        dado.current++;
      }
      if (p >= 1) {
        raf.current = 0;
        setManteniendo(false);
        haptic.impactHeavy();
        yaAtendido.current = true;
        desarmar();
        onConfirmar();
        return;
      }
      raf.current = requestAnimationFrame(paso);
    };
    raf.current = requestAnimationFrame(paso);
  }

  function alClick() {
    if (yaAtendido.current) {
      yaAtendido.current = false;
      return;
    }
    if (deshabilitado || enviando) return;
    // Click sin gesto previo con el cupón incompleto: lo que hace el resto de
    // vías, que hable la validación del formulario.
    if (!listo) {
      onConfirmar();
      return;
    }
    if (armado) {
      desarmar();
      haptic.impactHeavy();
      onConfirmar();
      return;
    }
    haptic.selection();
    setArmado(true);
    clearTimeout(relojArmado.current);
    relojArmado.current = setTimeout(() => setArmado(false), ARMADO_MS);
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(relojArmado.current);
    },
    []
  );

  const texto = enviando
    ? t("cdd.submitting")
    : manteniendo
    ? t("repesca.mantenSigue")
    : armado
    ? t("repesca.mantenOtraVez")
    : t("repesca.mantenAdivinar");

  return (
    <>
      <button
        type="button"
        className={
          "prensa-submit mt-2 boton-mantener" +
          (manteniendo ? " manteniendo" : "") +
          (enviando ? " is-trabajando" : "") +
          (!listo && !deshabilitado ? " is-incomplete" : "")
        }
        style={{ "--mantener-ms": `${MANTENER_MS}ms` }}
        disabled={deshabilitado}
        aria-busy={enviando}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          empezar();
        }}
        onPointerUp={parar}
        onPointerLeave={parar}
        onPointerCancel={parar}
        onClick={alClick}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            empezar();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") parar();
        }}
        // Una pulsación larga en Android abre el menú contextual o selecciona
        // texto: aquí la pulsación larga ES el gesto.
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="mantener-relleno" aria-hidden="true" />
        <span className="mantener-texto">{texto}</span>
      </button>
      {/* El cambio a «Toca otra vez» se anuncia: un lector de pantalla no
          relee el nombre de un botón que ya tiene el foco. */}
      <span className="sr-only" aria-live="polite">
        {armado ? t("repesca.mantenOtraVez") : ""}
      </span>
    </>
  );
}
