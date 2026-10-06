// src/components/HowToPlayModal.jsx
// CÓMO SE JUEGA (sistema «Asfalto») — tres pasos que se ENSEÑAN, no se leen.
//
// Eran cinco reglas en lista: correctas, completas y nadie las leía. Las tres
// ideas que de verdad hay que entender antes de jugar son visuales, así que
// cada una va con su demostración en vez de con su frase:
//
//   1. CADA FALLO ABRE LA FOTO: una foto que se aleja de 3× a 1× con su lente y
//      el medidor de intentos gastándose en rojo, en bucle. Es la foto genérica
//      del arranque (splash-car.jpg), nunca la del día: la ayuda no puede
//      enseñar del coche de hoy más de lo que ve quien está jugando (regla 5).
//   2. CADA CAMPO, UNA PISTA: las cuatro respuestas que puede dar una celda, con
//      su icono y su palabra — el color nunca va solo.
//   3. UN COCHE CADA DÍA: la curva de puntos y la escalera de la racha, las
//      mismas piezas que «Cómo se puntúa» (Puntuacion.jsx).
//
// El movimiento es del compás: el paso entra deslizándose 14px desde el lado
// hacia el que se avanza, las celdas del segundo se entintan una tras otra y
// las barras del tercero crecen desde la izquierda. Los bucles del primero
// solo animan `transform` y `opacity` (regla 25), y con
// `prefers-reduced-motion` todo se queda quieto en su primer fotograma, que
// es coherente por sí solo (la lente a 3× con su «3,0×»).

import { useEffect, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { flagImagePath } from "../data/countries";
import Superficie from "./Superficie";
import { TablaPuntos, EscaleraRacha } from "./Puntuacion";
import { Icon, I } from "./configurator/icons";

const PASOS = 3;
// Las cinco lecturas de la lente, en el formato del chip del juego (CarImage).
const LENTES = ["3,0×", "2,5×", "2,0×", "1,5×", "1,0×"];

function DemoFoto() {
  const { t } = useT();
  return (
    <>
      <div className="htp-foto">
        <img className="htp-lente" src="/splash-car.jpg" alt={t("howto.p1Alt")} draggable={false} />
        <span className="cdd-visor" aria-hidden="true">
          <span className="esq arr-izq" />
          <span className="esq arr-der" />
          <span className="esq aba-izq" />
          <span className="esq aba-der" />
        </span>
        <span className="htp-chip" aria-hidden="true">
          {LENTES.map((l, i) => (
            <span key={l} className={`l${i + 1}`}>{l}</span>
          ))}
        </span>
      </div>
      <div className="htp-medidor" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n}>{n < 5 && <i className={`s${n}`} />}</span>
        ))}
      </div>
    </>
  );
}

function Ejemplo({ tono, icono, bandera, valor, mono = false, tachado = false, estado, texto, n }) {
  return (
    <div className={`htp-ej e${n}`}>
      <span className={`htp-celda ${tono}`}>
        {bandera ? (
          <img src={bandera} alt="" aria-hidden="true" className="bandera" />
        ) : (
          <Icon d={icono} size={16} strokeWidth="2.2" />
        )}
        <span className="htp-celda-texto">
          <b className={(mono ? "mono" : "") + (tachado ? " tachado" : "")}>{valor}</b>
          <span>{estado}</span>
        </span>
      </span>
      <span className="htp-ej-texto">{texto}</span>
    </div>
  );
}

export default function HowToPlayModal({ open, onClose }) {
  const { t } = useT();
  const [paso, setPaso] = useState(0);
  // Hacia dónde se movió el último cambio: el paso nuevo entra desde ese lado.
  const [atras, setAtras] = useState(false);
  useEscape(open, onClose);

  // Cada apertura empieza por el principio.
  useEffect(() => {
    if (open) {
      setPaso(0);
      setAtras(false);
    }
  }, [open]);

  function ir(n) {
    if (n === paso || n < 0 || n >= PASOS) return;
    haptic.selection();
    setAtras(n < paso);
    setPaso(n);
  }

  function siguiente() {
    if (paso === PASOS - 1) {
      haptic.impactLight();
      onClose?.();
      return;
    }
    ir(paso + 1);
  }

  // Las flechas del teclado también pasan de página.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "ArrowRight") ir(paso + 1);
      else if (e.key === "ArrowLeft") ir(paso - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Superficie
      open={open}
      onClose={onClose}
      label={t("howto.title")}
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-[85] flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-[85] flex items-end justify-center"
      panelWeb="modal-panel-flat w-full max-w-md max-h-full overflow-y-auto overscroll-contain p-5"
    >
      <div className="htp-cab">
        <span className="htp-kicker">
          {t("howto.title")} · {t("howto.paso", { n: paso + 1, total: PASOS })}
        </span>
        <button type="button" className="htp-saltar" onClick={onClose}>
          {t("howto.saltar")}
        </button>
      </div>

      <div className="htp-cuerpo" aria-live="polite">
        <div key={paso} className={"htp-paso" + (atras ? " atras" : "")}>
          {paso === 0 && (
            <>
              <h2 className="htp-titulo">{t("howto.p1Titulo")}</h2>
              <p className="htp-texto">{t("howto.p1Texto")}</p>
              <DemoFoto />
            </>
          )}
          {paso === 1 && (
            <>
              <h2 className="htp-titulo">{t("howto.p2Titulo")}</h2>
              <p className="htp-texto">{t("howto.p2Texto")}</p>
              <div className="htp-ejemplos">
                <Ejemplo
                  n={1}
                  tono="bien"
                  icono={I.check}
                  valor="Nissan"
                  estado={t("howto.ejCorrecta")}
                  texto={t("howto.ejCorrectaTexto")}
                />
                <Ejemplo
                  n={2}
                  tono="cerca"
                  bandera={flagImagePath("Japón")}
                  valor="Toyota"
                  estado={t("howto.ejPais")}
                  texto={t("howto.ejPaisTexto")}
                />
                <Ejemplo
                  n={3}
                  tono="mal"
                  icono={I.x}
                  valor="Supra"
                  tachado
                  estado={t("howto.ejNo")}
                  texto={t("howto.ejNoTexto")}
                />
                <Ejemplo
                  n={4}
                  tono="anio"
                  icono={I.arrowU}
                  valor="1989"
                  mono
                  estado={t("howto.ejAnio")}
                  texto={t("howto.ejAnioTexto")}
                />
              </div>
            </>
          )}
          {paso === 2 && (
            <>
              <h2 className="htp-titulo">{t("howto.p3Titulo")}</h2>
              <p className="htp-texto">{t("howto.p3Texto")}</p>
              <TablaPuntos animada />
              <EscaleraRacha />
            </>
          )}
        </div>
      </div>

      <div className="htp-pie">
        <div className="htp-puntos" role="group" aria-label={t("howto.pasosAria")}>
          {Array.from({ length: PASOS }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-current={i === paso ? "step" : undefined}
              aria-label={t("howto.paso", { n: i + 1, total: PASOS })}
              onClick={() => ir(i)}
            >
              <span className={i === paso ? "on" : undefined} />
            </button>
          ))}
        </div>
        <button type="button" className="pm-btn htp-siguiente" onClick={siguiente}>
          {paso === PASOS - 1 ? t("howto.aJugar") : t("howto.siguiente")}
          <Icon d={I.arrowR} size={18} strokeWidth="2.2" />
        </button>
      </div>
    </Superficie>
  );
}
