// src/components/HeaderQuecochees.jsx
// -----------------------------------------------------------------
// Ruta 3: Header Dinámico / Glassmorphism oscuro.
//
// Decisiones clave:
//  • Wordmark "QUECOCHE·ES": el middle-dot (·) separa físicamente
//    las dos Es, eliminando la lectura de "letra doblada/typo" y
//    revelando el tagline natural "qué coche es" cuando se lee.
//  • Cristal tintado: backdrop-filter blur que intensifica con
//    scroll. El header se siente "lente" sobre el contenido —
//    refuerza el concepto del juego (adivinar bajo desenfoque).
//  • Streak chip visible: la racha es información emocional, no
//    se entierra en menús. Sólo aparece cuando hay racha (>0).
//  • CSS modules para control tipográfico fino que Tailwind no
//    da gratis (gradiente metálico vertical, tracking quirúrgico).
// -----------------------------------------------------------------

import { useEffect, useState } from "react";
import styles from "./HeaderQuecochees.module.css";

export default function HeaderQuecochees({
  user,
  streak = 0,
  repescaAlert = false,
  currentLang = "es",
  onOpenProfile,
  onOpenLogin,
  onOpenGarage,
  onOpenRanking,
  onOpenHelp,
  onToggleLang,
}) {
  const [scrolled, setScrolled] = useState(false);

  // Listener de scroll con rAF para no machacar el main thread.
  // Threshold a 6px: cualquier scroll mínimo dispara el cambio de
  // densidad, sin sentir "histéresis" en gestos pequeños.
  useEffect(() => {
    let raf = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 6);
        raf = null;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const handleProfileClick = user ? onOpenProfile : onOpenLogin;

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ""}`}>
      <div className={styles.inner}>
        {/* IZQUIERDA: perfil + streak chip */}
        <div className={styles.left}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleProfileClick}
            aria-label={user ? "Perfil" : "Iniciar sesión"}
            title={user ? "Perfil" : "Iniciar sesión"}
          >
            <UserIcon />
          </button>

          {streak > 0 && (
            <div
              className={styles.streakChip}
              aria-label={`Racha actual: ${streak} días`}
              title={`Racha: ${streak}`}
            >
              <FlameIcon />
              <span>{streak}</span>
            </div>
          )}
        </div>

        {/* CENTRO: vacío intencionalmente. La marca vive en favicon,
            share card, OG image y splash — no en el header. El usuario
            recurrente no necesita que le recuerden dónde está cada
            sesión. La mirada se libera para el contenido (el coche
            borroso del día). */}

        {/* DERECHA: garaje · ranking · ayuda.
            Idioma vive en el menú de perfil — un chip "ES" persistente
            es ruido visual que las apps premium evitan. */}
        <div className={styles.right}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenGarage}
            aria-label="Garaje"
            title="Garaje"
          >
            <GarageIcon />
            {repescaAlert && <span className={styles.alertDot} aria-hidden="true" />}
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenRanking}
            aria-label="Ranking"
            title="Ranking"
          >
            <TrophyIcon />
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenHelp}
            aria-label="Ayuda"
            title="Ayuda"
          >
            <HelpIcon />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ===================== ICONOS INLINE =====================
   SVG minimal stroke-based. Heredan currentColor del botón
   para responder a estados hover/focus sin más lógica. */

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
         stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20c.8-3.7 4-6 7.5-6s6.7 2.3 7.5 6" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
         stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3s4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3 0 1.5.7 2 1.5 2C10 8 12 6 12 3z" />
      <path d="M8.5 14c0 2 1.5 4 3.5 4s3.5-2 3.5-4" opacity=".6" />
    </svg>
  );
}

function GarageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
         stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 10v10h14V10" />
      <path d="M8 20v-4h8v4" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
         stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4z" />
      <path d="M16 5h2.5a1.5 1.5 0 0 1 0 3H16" />
      <path d="M8 5H5.5a1.5 1.5 0 0 0 0 3H8" />
      <path d="M10 12v3M14 12v3" />
      <path d="M8 19h8" />
      <path d="M9 15h6l-.5 4h-5L9 15z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
         stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" />
    </svg>
  );
}
