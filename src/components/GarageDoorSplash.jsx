// src/components/GarageDoorSplash.jsx
// Splash de carga inicial: una puerta de garaje SECCIONAL (estilo
// industrial / americano) se sube animada, revelando el coche y el
// título de la app. Salida con zoom + blur para encadenar con el juego.
//
// Decisiones de diseño:
//   - PANELES claros: cada tabla horizontal tiene costuras verticales
//     que la dividen en 3 paneles. Es la firma visual de una puerta de
//     garaje seccional — sin esto se lee como un rectángulo cualquiera.
//   - RAÍLES laterales: dos barras verticales junto al marco transmiten
//     "esta puerta sube/baja por aquí". Quita ambigüedad de qué es.
//   - SUELO con líneas de aparcamiento amarillas, visibles solo cuando
//     la puerta empieza a subir.
//   - DURACIÓN MÍNIMA fija: el splash vive minVisibleMs (default 2400 ms)
//     aunque la app cargue instantáneamente. Si la app tarda más, el
//     splash espera hasta que esté lista. Sin este mínimo el efecto
//     visual se truncaba en conexiones rápidas.
//   - EXIT con zoom + blur: al desmontarse, el splash hace scale-up y
//     blur progresivo, dando la sensación de "entrar al garaje".

import { motion } from "framer-motion";

const DOOR_SLATS = 5;          // 5 tablas, cada una con 3 paneles
const PANELS_PER_SLAT = 3;

export default function GarageDoorSplash({
  title = "CARGUESSR",
  subtitle,
}) {
  // La duración mínima la enforce el padre (App.jsx) — este componente
  // solo se preocupa por su animación interna y por el `exit` que
  // AnimatePresence aplica al desmontarlo (zoom-in + blur "entras al
  // garaje"). Mantenerlo así evita dobles fuentes de verdad sobre
  // timing y simplifica el test del splash en aislamiento.
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary overflow-hidden"
      initial={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 1.4, filter: "blur(12px)" }}
      transition={{ duration: 0.4, ease: [0.55, 0, 0.78, 0.32] }}
    >
      <div className="relative flex flex-col items-center">
        {/* === Conjunto puerta + raíles ===================================
            Width pensado para móvil estrecho (260px) — escala bien en
            desktop también. Height proporcional. */}
        <div className="relative" style={{ width: 260, height: 200 }}>
          {/* Raíl izquierdo */}
          <div
            className="absolute top-0 bottom-0 left-[-10px] w-[6px] rounded
                       bg-gradient-to-b from-[#2a2a30] via-[#1a1a1f] to-[#2a2a30]
                       shadow-[inset_-1px_0_0_rgba(255,255,255,0.06),inset_1px_0_0_rgba(0,0,0,0.5)]"
            aria-hidden="true"
          />
          {/* Raíl derecho */}
          <div
            className="absolute top-0 bottom-0 right-[-10px] w-[6px] rounded
                       bg-gradient-to-b from-[#2a2a30] via-[#1a1a1f] to-[#2a2a30]
                       shadow-[inset_-1px_0_0_rgba(255,255,255,0.06),inset_1px_0_0_rgba(0,0,0,0.5)]"
            aria-hidden="true"
          />

          {/* MARCO INTERIOR (lo que la puerta tapa al inicio) */}
          <div
            className="
              relative h-full w-full overflow-hidden rounded-sm
              border-2 border-accent/40
              bg-gradient-to-b from-[#08080a] via-[#0a0a0c] to-[#050507]
              shadow-[0_0_50px_rgba(255,191,0,0.18)]
            "
          >
            {/* Interior del garaje — visible cuando la puerta sube */}
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-6">
              {/* Suelo de garaje con dos líneas amarillas de aparcamiento */}
              <div className="absolute bottom-0 left-0 right-0 h-[34%]">
                <div className="absolute inset-x-0 top-0 h-px bg-white/15" />
                <motion.div
                  className="absolute left-[20%] top-2 bottom-2 w-[3px] rounded-sm bg-yellow-500/55"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.35 }}
                />
                <motion.div
                  className="absolute right-[20%] top-2 bottom-2 w-[3px] rounded-sm bg-yellow-500/55"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.35 }}
                />
              </div>

              {/* Halo de faros */}
              <motion.div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 70% 50% at 50% 75%, rgba(255,191,0,0.28), transparent 65%)",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45, duration: 0.4 }}
              />

              {/* Coche (silueta SVG, no emoji — fonts de emoji no son
                  fiables entre navegadores/SO) */}
              <motion.svg
                className="relative mb-2 h-16 w-auto text-accent drop-shadow-[0_4px_10px_rgba(255,191,0,0.35)]"
                viewBox="0 0 64 28"
                fill="currentColor"
                initial={{ y: 14, opacity: 0, scale: 0.92 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                transition={{ delay: 0.55, duration: 0.4, ease: "easeOut" }}
                aria-hidden="true"
              >
                <path d="M6 22 L4 18 Q4 14 8 14 L14 14 Q16 10 22 8 L40 8 Q46 10 50 14 L56 14 Q60 14 60 18 L58 22 L52 22 Q52 26 48 26 Q44 26 44 22 L20 22 Q20 26 16 26 Q12 26 12 22 Z" />
                <path d="M22 12 L26 9 L38 9 L42 12 L42 13 L22 13 Z" fill="#0a0a0c" opacity="0.85" />
                <circle cx="16" cy="22" r="3" fill="#0a0a0c" />
                <circle cx="48" cy="22" r="3" fill="#0a0a0c" />
              </motion.svg>
            </div>

            {/* === LA PUERTA SECCIONAL ===========================
                Stack vertical de tablas. Cada tabla es una row con 3
                paneles separados por costuras verticales. La row entera
                se sube como bloque con y: -100% al cabo de 0.35s. */}
            <motion.div
              className="absolute inset-0 flex flex-col"
              initial={{ y: 0 }}
              animate={{ y: "-100%" }}
              transition={{
                delay: 0.15,
                duration: 0.7,
                ease: [0.65, 0.05, 0.36, 1],
              }}
            >
              {Array.from({ length: DOOR_SLATS }).map((_, slatIdx) => (
                <div
                  key={slatIdx}
                  className="
                    flex flex-1 border-b border-black/70
                    bg-gradient-to-b from-[#26262c] via-[#15151a] to-[#0c0c10]
                  "
                >
                  {Array.from({ length: PANELS_PER_SLAT }).map((_, panelIdx) => (
                    <div
                      key={panelIdx}
                      className="
                        relative flex-1
                        border-l border-r border-black/60
                      "
                    >
                      {/* Subtle highlight in the upper portion of each
                          panel — luz especular tenue, refuerza la
                          textura tridimensional. */}
                      <div className="absolute inset-x-2 top-0 h-px bg-white/[0.08]" />
                      <div className="absolute inset-x-3 top-1 h-px bg-white/[0.04]" />
                    </div>
                  ))}
                </div>
              ))}
              {/* Asa estilo "barra" en la última tabla — toque inferior
                  que ayuda a leer "esto es una puerta que se abre". */}
              <div className="absolute bottom-1 left-1/2 h-[3px] w-12 -translate-x-1/2 rounded-full bg-accent/40 shadow-[0_0_4px_rgba(255,191,0,0.3)]" />
            </motion.div>
          </div>

          {/* Soporte superior del riel — pequeña pieza que une los dos
              raíles por arriba, completa la silueta de portal. */}
          <div
            className="absolute -top-[6px] left-[-10px] right-[-10px] h-[6px]
                       rounded-t bg-gradient-to-b from-[#1a1a1f] to-[#0a0a0c]"
            aria-hidden="true"
          />
        </div>

        {/* Título y subtítulo */}
        <motion.p
          className="mt-7 font-display text-2xl tracking-[0.32em] text-white"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.35, ease: "easeOut" }}
        >
          {title}
        </motion.p>
        {subtitle && (
          <motion.p
            className="mt-1.5 text-[10px] uppercase tracking-[0.28em] text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.3 }}
          >
            {subtitle}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
