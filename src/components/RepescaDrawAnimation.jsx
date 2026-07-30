// src/components/RepescaDrawAnimation.jsx
// Overlay de "sorteo" de la repesca aleatoria. Sustituye el spinner básico
// que había entre "el usuario acepta" y "redirect a /repesca". La secuencia
// está pensada para durar ~2.3s — tiempo suficiente para que el POST a
// /api/repesca/start termine sin añadir delay artificial.
//
// Flujo:
//   1. (0-450ms)   Mazo de cromos boca abajo aparece en el centro.
//   2. (450-1050)  Se abren en abanico (translateX + rotate).
//   3. (1050-1850) Barajado: dos pasadas de cruce con stagger.
//   4. (1850-2200) Una carta se separa, se centra y se voltea con flip 3D.
//   5. (2200-2500) Pausa dramática + sello "TU COCHE" estampado.
//
// Materialidad: el cromo es un CUPÓN de periódico, no una tarjeta de juego.
// Reverso = papel tramado (el halftone de una foto sin revelar); anverso =
// impreso con cabecera de kiosco, sello de caucho y pie de doble filete. La
// versión anterior mezclaba dos temas en la misma carta (chasis de papel con
// halos ámbar y anillos redondos del rediseño neón anterior), que sobre el
// papel del tema actual leía como un parche pegado.
//
// El padre (Garage.jsx) llama `onAnimationComplete` y `onReady` cuando le
// hace falta — aquí solo cuenta una historia visual.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useT } from "../i18n";

// Nº de cartas en el mazo. 5 cabe sin saturar en móvil y es suficiente
// para que el barajado se lea claro.
const NUM_CARDS = 5;
// Carta destacada (la que "sale" y se voltea al final). La del centro queda
// natural visualmente al ser la cúspide del abanico.
const HERO_INDEX = Math.floor(NUM_CARDS / 2);

// Reparte cada carta en su posición de abanico final. Centrada en 0, se
// abren a ±60px y rotan ±18º. Pequeño cubrir natural.
function fanPosition(i) {
  const offset = i - HERO_INDEX;
  return {
    x: offset * 26,
    rotate: offset * 9,
  };
}

export default function RepescaDrawAnimation({ veteran = false, onDismiss }) {
  const { t } = useT();
  // Fase actual de la animación. Lo usamos para mostrar el texto correcto
  // y para disparar el flip de la carta hero al llegar a "flip".
  const [phase, setPhase] = useState("appear"); // appear → fan → shuffle → pick → flip → done

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("fan"), 450),
      setTimeout(() => setPhase("shuffle"), 1050),
      setTimeout(() => setPhase("pick"), 1850),
      setTimeout(() => setPhase("flip"), 2100),
      setTimeout(() => setPhase("done"), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Nota sobre el velo: la clase `scrim` a secas se quedó sin definición al
  // retirar el sistema Liquid Glass (index.css lo documenta), así que el
  // overlay llevaba desde entonces SIN velo — el sorteo flotaba sobre la
  // página a plena luz. `scrim-flat` es el tinte plano que usan hoy los modales.
  return (
    <motion.div
      className="
        scrim-flat
        fixed inset-0 z-[120] flex items-center justify-center
      "
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onClick={onDismiss}
      role="dialog"
      aria-label={t("garage.drawAria")}
    >
      <div
        className="relative flex flex-col items-center"
        style={{ perspective: 1200 }}
      >
        {/* Contenedor del mazo — todas las cartas se posicionan absolutas
            sobre este punto central. */}
        <div className="relative" style={{ width: 220, height: 280 }}>
          {Array.from({ length: NUM_CARDS }).map((_, i) => {
            const isHero = i === HERO_INDEX;
            const fan = fanPosition(i);
            // Mapeo de variantes por fase. Cada carta sabe a dónde tiene
            // que estar en cada momento; framer-motion interpola entre
            // estados al cambiar `animate`.
            let animate;
            if (phase === "appear") {
              animate = { x: 0, y: 0, rotate: 0, opacity: 1, scale: 1, rotateY: 0 };
            } else if (phase === "fan") {
              animate = { x: fan.x, y: 0, rotate: fan.rotate, opacity: 1, scale: 1, rotateY: 0 };
            } else if (phase === "shuffle") {
              // Barajado: alternancia rápida entre dos posiciones lejanas
              // del orden original. Usamos keyframes en x/rotate.
              animate = {
                x: [fan.x, -fan.x * 1.2, fan.x],
                rotate: [fan.rotate, -fan.rotate, fan.rotate],
                y: [0, -10, 0],
                opacity: 1,
                rotateY: 0,
              };
            } else if (phase === "pick") {
              // La hero card se separa y centra. El resto se aparta y baja
              // opacidad para llevar el foco a la elegida.
              animate = isHero
                ? { x: 0, y: -30, rotate: 0, opacity: 1, scale: 1.08, rotateY: 0 }
                : { x: fan.x * 1.8, y: 30, rotate: fan.rotate * 1.5, opacity: 0.25, scale: 0.9, rotateY: 0 };
            } else if (phase === "flip" || phase === "done") {
              animate = isHero
                ? { x: 0, y: -30, rotate: 0, opacity: 1, scale: 1.08, rotateY: 180 }
                : { x: fan.x * 1.8, y: 30, rotate: fan.rotate * 1.5, opacity: 0.18, scale: 0.9, rotateY: 0 };
            }

            const transition =
              phase === "shuffle"
                ? { duration: 0.8, ease: "easeInOut", times: [0, 0.5, 1] }
                : phase === "flip"
                ? { duration: 0.5, ease: "easeOut" }
                : { type: "spring", stiffness: 280, damping: 22 };

            return (
              <motion.div
                key={i}
                className="absolute left-1/2 top-1/2"
                style={{
                  width: 130,
                  height: 180,
                  marginLeft: -65,
                  marginTop: -90,
                  transformStyle: "preserve-3d",
                  zIndex: isHero && (phase === "pick" || phase === "flip" || phase === "done") ? 20 : 10 + i,
                }}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.6, rotateY: 0 }}
                animate={animate}
                transition={transition}
              >
                {/* CARA TRASERA del cromo: cupón boca abajo. Papel con TRAMA
                    de puntos (el halftone de una foto de periódico sin revelar)
                    e interrogante en Fraunces. Antes era un degradado casi negro
                    con rayas ámbar — colores de dos temas atrás que sobre el
                    papel del tema actual leían como un parche pegado. */}
                <div
                  className="
                    absolute inset-0 rounded-none border border-tinta
                    bg-papel-2
                    shadow-[shadow:var(--sombra-flota)]
                    flex items-center justify-center
                    overflow-hidden
                  "
                  style={{ backfaceVisibility: "hidden" }}
                >
                  {/* Trama de puntos: el gris de imprenta. Un punto de tinta
                      cada 6px — a tamaño de cromo se lee como textura, no como
                      lunares. */}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        "radial-gradient(rgb(var(--tinta-rgb) / 0.30) 1px, transparent 1px)",
                      backgroundSize: "6px 6px",
                    }}
                  />
                  <span className="relative font-display text-5xl font-black text-tinta/45">
                    ?
                  </span>
                  <div className="absolute bottom-3 left-0 right-0 text-center font-mono text-[8px] uppercase tracking-[0.24em] text-tinta-2">
                    Coche del Día
                  </div>
                </div>

                {/* CARA FRONTAL: el cupón de sorteo, ya adjudicado. La
                    rotateY:180 inicial la mantiene oculta hasta el flip.
                    Aquí NO hay icono: antes había una silueta de coche de
                    librería dentro de un anillo con halo ámbar, y las dos
                    cosas sobraban — el halo era de la paleta anterior (sobre
                    papel se ensuciaba) y la silueta repetía en dibujo lo que
                    el texto ya dice. Lo que queda es un impreso: cabecera,
                    sello estampado y pie. */}
                <div
                  className={`
                    absolute inset-0 rounded-none border
                    flex flex-col overflow-hidden bg-papel
                    ${veteran ? "border-oro-viejo" : "border-tinta"}
                  `}
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                  }}
                >
                  {/* Barrido al revelarse. Sobre papel un destello BLANCO es
                      invisible (el papel ya es casi blanco), así que la luz se
                      invierte: lo que cruza la carta es una sombra de tinta,
                      como la de una hoja al pasar por el rodillo. */}
                  <motion.div
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{
                      background:
                        "linear-gradient(105deg, transparent 35%, rgb(var(--tinta-rgb) / 0.10) 50%, transparent 65%)",
                    }}
                    initial={{ x: "-130%" }}
                    animate={
                      isHero && (phase === "flip" || phase === "done")
                        ? { x: "130%" }
                        : { x: "-130%" }
                    }
                    transition={{ duration: 0.7, ease: "easeOut", delay: 0.12 }}
                  />

                  {/* Cabecera de kiosco: mismo patrón que las portadas de El
                      Archivo (rótulo a la izquierda, referencia en rojo a la
                      derecha). Es lo que hace que el cromo lea como un impreso
                      numerado y no como una tarjeta genérica. */}
                  <div
                    className={`
                      flex items-center justify-between gap-1.5 border-b px-2 py-1
                      font-mono text-[7.5px] uppercase tracking-[0.14em] text-tinta-2
                      ${veteran ? "border-oro-viejo/40" : "border-border"}
                    `}
                  >
                    <span>{t("garage.drawCoupon")}</span>
                    <span className={veteran ? "text-oro-viejo" : "text-rojo"}>
                      N.º&nbsp;{HERO_INDEX + 1}
                    </span>
                  </div>

                  {/* El sello: estampado con overshoot al revelarse (entra
                      grande y torcido y se asienta), que es exactamente el
                      gesto de sellar a mano. Sustituye al icono como pieza
                      central de la carta. */}
                  <div className="flex flex-1 items-center justify-center px-2">
                    <motion.span
                      className={`pm-sello ${veteran ? "pm-sello--oro" : ""}`}
                      initial={{ scale: 1.7, rotate: -14, opacity: 0 }}
                      animate={
                        isHero && (phase === "flip" || phase === "done")
                          ? { scale: 1, rotate: -7, opacity: 0.88 }
                          : { scale: 1.7, rotate: -14, opacity: 0 }
                      }
                      transition={{
                        type: "spring",
                        stiffness: 320,
                        damping: 14,
                        delay: 0.22,
                      }}
                    >
                      {veteran ? t("garage.drawVeteran") : t("garage.drawYours")}
                    </motion.span>
                  </div>

                  {/* Pie: doble filete + cabecera de la publicación. Cierra el
                      impreso por abajo, igual que el folio de la portada. */}
                  <div className="arch-filete mx-2 mb-2 pt-1.5 text-center font-mono text-[7.5px] uppercase tracking-[0.2em] text-tinta-2">
                    Coche del Día
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Etiqueta de estado bajo el mazo: cambia según la fase. Va sobre una
            FAJA de papel y no suelta sobre el velo: el velo es tinta oscura en
            los dos temas, así que un `text-tinta` (oscuro en modo día) quedaba
            literalmente invisible de día. Sobre su propia tira de papel el
            rótulo es legible en ambos temas y además lee como el pie de una
            foto de prensa. */}
        <div className="mt-4 h-7 text-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase}
              className="
                inline-block border border-tinta bg-papel px-3 py-1
                font-mono text-[10px] uppercase tracking-[0.24em] text-tinta
              "
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
            >
              {phase === "shuffle" || phase === "fan" || phase === "appear"
                ? t("garage.drawShuffling")
                : phase === "pick"
                ? t("garage.drawPicking")
                : t("garage.drawRevealed")}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

