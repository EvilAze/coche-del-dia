// src/components/GarageDoorSplash.jsx
// Splash de carga inicial: una puerta de garaje se sube animada, dejando
// ver el coche y el título de la app dentro. Reemplaza el splash básico
// de "🚗 APARCANDO COCHE..." para dar un toque más premium.
//
// Comportamiento clave: la animación de subida arranca al montar pero no
// "bloquea" al usuario — la carga real de la app sigue por debajo, y este
// componente solo cubre la pantalla mientras está activo. No añadimos
// delay artificial: cuando isLoading pasa a false en App.jsx el splash se
// desmonta inmediatamente (vía AnimatePresence con fade-out suave).

import { motion } from "framer-motion";

// Nº de "tablas" horizontales de la puerta. Más → más detalle visual,
// pero también más nodos animados. 6 es buen equilibrio: lee como puerta
// de garaje sectorada sin saturar el render.
const DOOR_SLATS = 6;

export default function GarageDoorSplash({ title = "CARGUESSR", subtitle }) {
  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {/* Marco del garaje: ventana rectangular en el centro. Todo lo que
          ocurre dentro está "enmarcado" por estos bordes ámbar tenues que
          dan sensación de portal/garaje. */}
      <div className="relative flex flex-col items-center">
        <div
          className="
            relative overflow-hidden rounded-md
            border-2 border-accent/30
            bg-gradient-to-b from-[#0a0a0c] to-[#050507]
            shadow-[0_0_40px_rgba(255,191,0,0.15)]
          "
          style={{ width: 220, height: 160 }}
        >
          {/* Interior del garaje (lo que la puerta tapa al inicio):
              fondo radial sutil + el "coche" emoji + brillo de faro. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Halo de faros */}
            <motion.div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 70%, rgba(255,191,0,0.22), transparent 60%)",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6 }}
            />
            <motion.svg
              className="relative h-14 w-auto text-accent"
              viewBox="0 0 64 28"
              fill="currentColor"
              initial={{ y: 12, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ delay: 0.55, duration: 0.5, ease: "easeOut" }}
              aria-hidden="true"
            >
              {/* Silueta de coche genérica (vista lateral). Hecha a mano
                  para evitar dependencia de fonts de emoji color, que
                  fallan en algunos Chromium headless / Windows antiguos. */}
              <path d="M6 22 L4 18 Q4 14 8 14 L14 14 Q16 10 22 8 L40 8 Q46 10 50 14 L56 14 Q60 14 60 18 L58 22 L52 22 Q52 26 48 26 Q44 26 44 22 L20 22 Q20 26 16 26 Q12 26 12 22 Z" />
              {/* Ventanas */}
              <path d="M22 12 L26 9 L38 9 L42 12 L42 13 L22 13 Z" fill="#0a0a0c" opacity="0.85" />
              {/* Ruedas */}
              <circle cx="16" cy="22" r="3" fill="#0a0a0c" />
              <circle cx="48" cy="22" r="3" fill="#0a0a0c" />
            </motion.svg>
            {/* Suelo: línea de "asfalto" sutil */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-white/15" />
          </div>

          {/* La PUERTA: stack de tablas horizontales que se sube en bloque.
              Cada tabla es un div con un degradado para simular volumen.
              Animamos el contenedor entero con y: -100% (sube por encima
              del marco y desaparece visualmente gracias al overflow-hidden
              del marco). */}
          <motion.div
            className="absolute inset-0 flex flex-col"
            initial={{ y: 0 }}
            animate={{ y: "-100%" }}
            transition={{
              delay: 0.25,
              duration: 0.95,
              ease: [0.65, 0.05, 0.36, 1], // easeInOut custom: arranque suave + final con peso
            }}
          >
            {Array.from({ length: DOOR_SLATS }).map((_, i) => (
              <div
                key={i}
                className="
                  flex-1 border-b border-black/40
                  bg-gradient-to-b from-[#1a1a1f] via-[#101013] to-[#0a0a0c]
                "
              >
                {/* "Acanaladura" sutil de la tabla: línea horizontal de
                    luz especular muy tenue, centrada verticalmente. */}
                <div className="h-px bg-white/[0.04]" style={{ marginTop: "50%" }} />
              </div>
            ))}
          </motion.div>
        </div>

        {/* Título debajo del garaje. Aparece justo después de que la
            puerta termine de subir, para que el ojo del usuario haga
            el recorrido natural: puerta sube → ve coche → lee título. */}
        <motion.p
          className="mt-5 font-display text-xl tracking-[0.32em] text-white"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.15, duration: 0.4, ease: "easeOut" }}
        >
          {title}
        </motion.p>

        {subtitle && (
          <motion.p
            className="mt-1 text-[10px] uppercase tracking-[0.24em] text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.35, duration: 0.4 }}
          >
            {subtitle}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
