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
//   5. (2200-2500) Pausa dramática + texto "TU COCHE".
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

  return (
    <motion.div
      className="
        scrim
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
                {/* CARA TRASERA del cromo (mystery): fondo oscuro con
                    silueta de coche + logo "?" central. */}
                <div
                  className="
                    absolute inset-0 rounded-xl border border-accent/40
                    bg-gradient-to-br from-[#16161a] to-[#08080a]
                    shadow-[0_8px_24px_rgba(0,0,0,0.6)]
                    flex items-center justify-center
                    overflow-hidden
                  "
                  style={{ backfaceVisibility: "hidden" }}
                >
                  {/* Patrón sutil de "cromos de garaje" */}
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(255,191,0,0.08) 0 2px, transparent 2px 16px)",
                    }}
                  />
                  <span className="font-display text-5xl text-accent/70">?</span>
                  <div className="absolute bottom-3 left-0 right-0 text-center text-[8px] uppercase tracking-[0.24em] text-accent/40">
                    Coche del Día
                  </div>
                </div>

                {/* CARA FRONTAL del cromo: reveal premium. La rotateY:180
                    inicial la mantiene oculta hasta que el flip la gira.
                    Componentes: glow radial + barrido de luz al voltear +
                    icono SVG en anillo (no emoji — renderiza consistente
                    cross-OS y se ve "diseñado", no pegado) + tipografía
                    display con tracking. */}
                <div
                  className={`
                    absolute inset-0 rounded-xl border-2
                    flex flex-col items-center justify-center gap-3
                    overflow-hidden
                    ${
                      veteran
                        ? "border-amber-400/70 bg-gradient-to-br from-amber-950/80 to-[#1a0f00] shadow-[0_0_28px_rgba(251,191,36,0.35)]"
                        : "border-accent/70 bg-gradient-to-br from-[#1f1f24] to-[#0d1014] shadow-[0_0_28px_rgba(255,191,0,0.25)]"
                    }
                  `}
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                  }}
                >
                  {/* Glow radial detrás del icono */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: veteran
                        ? "radial-gradient(circle at 50% 42%, rgba(251,191,36,0.22), transparent 62%)"
                        : "radial-gradient(circle at 50% 42%, rgba(255,191,0,0.2), transparent 62%)",
                    }}
                  />

                  {/* Barrido de luz: cruza la carta una vez al revelarse.
                      Solo se dispara en la hero (las demás no se voltean). */}
                  <motion.div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.22) 50%, transparent 65%)",
                    }}
                    initial={{ x: "-130%" }}
                    animate={
                      isHero && (phase === "flip" || phase === "done")
                        ? { x: "130%" }
                        : { x: "-130%" }
                    }
                    transition={{ duration: 0.7, ease: "easeOut", delay: 0.12 }}
                  />

                  {/* Icono en anillo con glow */}
                  <div
                    className={`
                      relative flex h-14 w-14 items-center justify-center rounded-full border
                      ${
                        veteran
                          ? "border-amber-300/60 bg-amber-500/15 shadow-[0_0_18px_rgba(251,191,36,0.45)]"
                          : "border-accent/60 bg-accent/15 shadow-[0_0_18px_rgba(255,191,0,0.4)]"
                      }
                    `}
                  >
                    <CarGlyph
                      className={`h-7 w-7 ${veteran ? "text-amber-200" : "text-accent"}`}
                    />
                  </div>

                  {/* Label */}
                  <p
                    className={`
                      relative text-center font-display text-sm uppercase tracking-[0.22em]
                      ${veteran ? "text-amber-100" : "text-tinta"}
                    `}
                  >
                    {veteran ? t("garage.drawVeteran") : t("garage.drawYours")}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Etiqueta de estado bajo el mazo: cambia según la fase. */}
        <div className="mt-4 h-6 text-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase}
              className="text-[11px] uppercase tracking-[0.28em] text-tinta"
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

// Silueta de coche (perfil lateral, estilo Lucide "car"). SVG en vez de
// emoji 🚗: renderiza idéntico en iOS / Android / Windows y se integra con
// el sistema de iconos del resto de la app (stroke currentColor, hereda el
// color del contenedor). El emoji se veía distinto en cada dispositivo y
// "pegado" sobre la carta.
function CarGlyph({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}
