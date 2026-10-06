// src/components/RepescaDrawAnimation.jsx
// EL SORTEO DE LA REPESCA (sistema «Asfalto»). Ocupa el hueco entre «el
// jugador acepta» y el salto a /repesca, ~2,5 s: lo justo para que el POST a
// /api/repesca/start termine sin añadir espera artificial.
//
// Flujo:
//   1. (0-450ms)   El mazo, boca abajo, sube al centro.
//   2. (450-1050)  Se abre en abanico.
//   3. (1050-1850) Se baraja: dos pasadas de cruce.
//   4. (1850-2100) Una carta se adelanta y las demás se apartan.
//   5. (2100-2500) Se voltea y enseña que es la tuya.
//
// LA CARTA. El dorso es el reverso de un número sin revelar: rayado, con las
// dos rayas rojas de la marca y «Nº ?». El anverso, en la tinta del sistema
// (el botón principal), dice «Tu coche» — o, si te ha tocado uno que ya viste
// al fallarlo, «Modo Veterano» en oro, que es la regla dura de la repesca. El
// número de edición no se enseña: el cliente no lo sabe hasta empezar, y
// tampoco debe (sería decir qué día fue coche del día).
//
// SE SIENTE, NO SOLO SE VE. Un toque al abrirse el abanico, dos al barajar y
// uno más firme al voltearse la carta: la mano nota el mazo moviéndose. Pocos
// y espaciados — la ventana por peso de haptics.js se comería una ráfaga.
//
// El velo es oscuro en los dos temas, así que el rótulo de estado va en claro
// fijo y no en tinta (que de día sería oscuro sobre oscuro).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { Icon, I } from "./configurator/icons";

// Nº de cartas en el mazo. 5 cabe sin saturar en móvil y es suficiente
// para que el barajado se lea claro.
const NUM_CARDS = 5;
// La carta que sale y se voltea: la del centro, cúspide natural del abanico.
const HERO_INDEX = Math.floor(NUM_CARDS / 2);

// La posición de abanico de cada carta, centrada en 0.
function fanPosition(i) {
  const offset = i - HERO_INDEX;
  return {
    x: offset * 30,
    rotate: offset * 8,
  };
}

export default function RepescaDrawAnimation({ veteran = false, pendientes = 0, onDismiss }) {
  const { t, tn } = useT();
  const [phase, setPhase] = useState("appear"); // appear → fan → shuffle → pick → flip → done

  useEffect(() => {
    const timers = [
      setTimeout(() => { setPhase("fan"); haptic.selection(); }, 450),
      setTimeout(() => { setPhase("shuffle"); haptic.impactLight(); }, 1050),
      setTimeout(() => haptic.impactLight(), 1450),
      setTimeout(() => setPhase("pick"), 1850),
      setTimeout(() => { setPhase("flip"); haptic.impactMedium(); }, 2100),
      setTimeout(() => setPhase("done"), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const revelada = phase === "flip" || phase === "done";

  return (
    <motion.div
      className="rep-sorteo scrim-flat fixed inset-0 z-[120] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onDismiss}
      role="dialog"
      aria-label={t("garage.drawAria")}
    >
      <div className="relative flex flex-col items-center" style={{ perspective: 1000 }}>
        {/* El mazo: todas las cartas, absolutas sobre el mismo punto. */}
        <div className="relative" style={{ width: 240, height: 290 }}>
          {Array.from({ length: NUM_CARDS }).map((_, i) => {
            const isHero = i === HERO_INDEX;
            const fan = fanPosition(i);
            let animate;
            if (phase === "appear") {
              animate = { x: 0, y: 0, rotate: 0, opacity: 1, scale: 1, rotateY: 0 };
            } else if (phase === "fan") {
              animate = { x: fan.x, y: 0, rotate: fan.rotate, opacity: 1, scale: 1, rotateY: 0 };
            } else if (phase === "shuffle") {
              animate = {
                x: [fan.x, -fan.x * 1.6, fan.x * 1.2, fan.x],
                rotate: [fan.rotate, -fan.rotate * 1.4, fan.rotate, fan.rotate],
                y: [0, -8, 2, 0],
                opacity: 1,
                rotateY: 0,
              };
            } else if (phase === "pick") {
              animate = isHero
                ? { x: 0, y: -18, rotate: 0, opacity: 1, scale: 1.1, rotateY: 0 }
                : { x: fan.x * 1.6, y: 22, rotate: fan.rotate * 1.4, opacity: 0, scale: 0.92, rotateY: 0 };
            } else {
              animate = isHero
                ? { x: 0, y: -18, rotate: 0, opacity: 1, scale: 1.1, rotateY: 180 }
                : { x: fan.x * 1.6, y: 22, rotate: fan.rotate * 1.4, opacity: 0, scale: 0.92, rotateY: 0 };
            }

            // El tempo sale del compás (regla 22): el barajado dura lo que el
            // revelado de la foto, el volteo lo que una escena, y el resto es
            // un muelle con algo de cuerpo.
            const transition =
              phase === "shuffle"
                ? { duration: 0.72, ease: [0.45, 0, 0.2, 1], times: [0, 0.35, 0.7, 1] }
                : phase === "flip"
                ? { duration: 0.46, ease: [0.16, 1, 0.3, 1] }
                : { type: "spring", stiffness: 300, damping: 26 };

            return (
              <motion.div
                key={i}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: 156,
                  height: 220,
                  marginLeft: -78,
                  marginTop: -110,
                  transformStyle: "preserve-3d",
                  zIndex: isHero && phase !== "appear" && phase !== "fan" && phase !== "shuffle" ? 20 : 10 + i,
                }}
                initial={{ x: 0, y: 28, rotate: 0, opacity: 0, scale: 0.94, rotateY: 0 }}
                animate={animate}
                transition={transition}
              >
                {/* EL DORSO: un número sin revelar. */}
                <div className="rep-carta rep-carta-dorso">
                  <span className="rep-rayas" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <span className="rep-num">Nº ?</span>
                </div>

                {/* EL ANVERSO: es tuyo. Arranca girado 180° y no se ve hasta
                    el volteo. */}
                <div className={"rep-carta rep-carta-cara" + (veteran ? " veterano" : "")}>
                  <span className="rep-cara-kicker">Coche del Día</span>
                  <span className="rep-cara-centro">
                    {veteran && <Icon d={I.galones} size={30} strokeWidth="2" />}
                    <b>{veteran ? t("garage.drawVeteran") : t("garage.drawYours")}</b>
                  </span>
                  <span className="rep-rayas" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* El rótulo de estado bajo el mazo. */}
        <div className="rep-estado" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.p
              key={revelada ? "revelada" : phase === "pick" ? "pick" : "barajando"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className={revelada ? "grande" : undefined}
            >
              {revelada
                ? t("garage.drawRevealed")
                : phase === "pick"
                ? t("garage.drawPicking")
                : pendientes > 0
                ? tn("garage.drawBarajando", pendientes)
                : t("garage.drawShuffling")}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
