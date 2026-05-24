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
  title = "EL COCHE DEL DÍA",
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
            Ratio 5:3 (300x180) para encajar con un coche fotografiado
            de lado — más cinematográfico que el cuadrado, evita que el
            morro o la cola queden recortados por el object-cover. */}
        <div className="relative" style={{ width: 300, height: 180 }}>
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
            {/* Interior del garaje — visible cuando la puerta sube.
                La foto real del coche llena el fondo, con vignette
                radial + gradient inferior para integrarla con la
                paleta oscura/ámbar del splash sin choque visual. */}
            <div className="absolute inset-0 overflow-hidden">
              {/* Foto del coche (Nismo 400R). Se precarga eager para
                  que esté lista cuando la puerta termine de subir;
                  decoding async para no bloquear el main thread. */}
              <motion.img
                src="/splash-car.jpg"
                alt=""
                aria-hidden="true"
                draggable={false}
                loading="eager"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                initial={{ scale: 1.06, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.55, duration: 0.7, ease: "easeOut" }}
              />

              {/* Vignette radial: oscurece bordes para que el coche
                  emerja de la sombra del garaje y la foto no se sienta
                  "pegada" sobre el fondo del marco. */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 90% 70% at 50% 55%, transparent 35%, rgba(0,0,0,0.55) 80%, rgba(0,0,0,0.85) 100%)",
                }}
              />

              {/* Gradient inferior: funde el bottom de la foto con el
                  "suelo" del garaje y deja el coche "apoyado". Con el
                  marco más bajo (180px) basta con un 30% para no
                  tragarse las ruedas del R33. */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%]"
                style={{
                  background:
                    "linear-gradient(to top, rgba(5,5,7,0.9) 0%, rgba(5,5,7,0.45) 50%, transparent 100%)",
                }}
              />

              {/* Halo ámbar de faros — toque cálido sobre el coche,
                  mantiene la cohesión con la paleta del splash. */}
              <motion.div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 65% 45% at 50% 75%, rgba(255,191,0,0.22), transparent 60%)",
                  mixBlendMode: "screen",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.5 }}
              />
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
                delay: 0.2,
                duration: 1.0,
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

        {/* Título y subtítulo.
            Tracking y tamaño bajados respecto al "CARGUESSR" histórico
            para acomodar el wordmark más largo "EL COCHE DEL DÍA" sin
            que overflow en mobile (~360px de ancho útil). */}
        <motion.p
          className="mt-7 font-display text-[1.35rem] tracking-[0.22em] text-white text-center sm:text-[1.55rem] sm:tracking-[0.26em]"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.4, ease: "easeOut" }}
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
