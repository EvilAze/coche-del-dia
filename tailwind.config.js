/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Sistema único "menta": Archivo manda en display y cuerpo (antes
        // Bebas Neue / DM Sans), Space Mono para etiquetas técnicas. Coincide
        // con la pantalla de juego para que toda la web sea coherente.
        // Sistema «Prensa del motor» (reasignados en F5): display = Fraunces,
        // body = Libre Franklin, mono = Courier Prime. Archivo/Space Mono
        // retirados del bundle de fuentes (index.html).
        display: ["'Fraunces'", "Georgia", "serif"],
        body: ["'Libre Franklin'", "Arial", "sans-serif"],
        mono: ["'Courier Prime'", "monospace"],
        // Alias explícitos (usados por .prensa-*/.pm-* y disponibles como
        // utilidades font-serif/font-franklin/font-courier).
        serif: ["'Fraunces'", "Georgia", "serif"],
        franklin: ["'Libre Franklin'", "Arial", "sans-serif"],
        courier: ["'Courier Prime'", "monospace"],
      },
      colors: {
        // ── Sistema «Prensa del motor» — canales RGB temáticos ──
        //    Cada color es rgb(var(--x-rgb) / <alpha-value>): las ternas viven
        //    en index.css (:root día / :root[data-tema="noche"] noche), y el
        //    <alpha-value> deja que funcionen los modificadores de opacidad
        //    (bg-accent/15, border-accent/40, text-muted/70…). El día queda
        //    idéntico: las ternas de día son los mismos colores de antes.
        papel: {
          DEFAULT: "rgb(var(--bg-rgb) / <alpha-value>)",
          2: "rgb(var(--bg2-rgb) / <alpha-value>)",
          mat: "rgb(var(--surface-rgb) / <alpha-value>)",
        },
        tinta: {
          DEFAULT: "rgb(var(--tinta-rgb) / <alpha-value>)",
          2: "rgb(var(--tinta2-rgb) / <alpha-value>)",
        },
        rojo: "rgb(var(--rojo-rgb) / <alpha-value>)",
        "oro-viejo": "rgb(var(--gold-rgb) / <alpha-value>)",
        // Los dos hermanos del oro en el podio. Antes se pintaban con paleta
        // cruda de Tailwind (zinc-300 / amber-700), que no sigue al tema: en
        // modo día la plata quedaba invisible sobre el papel crema.
        plata: "rgb(var(--plata-rgb) / <alpha-value>)",
        bronce: "rgb(var(--bronce-rgb) / <alpha-value>)",

        bg: {
          primary: "rgb(var(--bg-rgb) / <alpha-value>)",
          secondary: "rgb(var(--bg2-rgb) / <alpha-value>)",
          tertiary: "rgb(var(--bg2-rgb) / <alpha-value>)",
        },
        border: {
          // border-border es un filete TENUE por defecto (alpha 0.22 fija, como
          // antes), por eso NO lleva <alpha-value>. Para tinta a otra opacidad
          // usa border-border-strong/NN (misma tinta base).
          DEFAULT: "rgb(var(--tinta-rgb) / 0.22)",
          strong: "rgb(var(--line-strong-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--rojo-rgb) / <alpha-value>)",
          dark: "rgb(var(--rojo-dark-rgb) / <alpha-value>)",
          glow: "transparent",
        },
        gold: {
          DEFAULT: "rgb(var(--gold-rgb) / <alpha-value>)",
          dark: "rgb(var(--gold-dark-rgb) / <alpha-value>)",
          ink: "rgb(var(--bg-rgb) / <alpha-value>)",
          glow: "transparent",
        },
        muted: "rgb(var(--tinta2-rgb) / <alpha-value>)",
        mint: {
          DEFAULT: "rgb(var(--rojo-rgb) / <alpha-value>)",
          foreground: "rgb(var(--bg-rgb) / <alpha-value>)",
        },
        card: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          foreground: "rgb(var(--tinta-rgb) / <alpha-value>)",
        },
        foreground: "rgb(var(--tinta-rgb) / <alpha-value>)",
        "muted-foreground": "rgb(var(--tinta2-rgb) / <alpha-value>)",
        destructive: "rgb(var(--rojo-rgb) / <alpha-value>)",
      },
      // Sombras del sistema Liquid Glass: elevación flotante + halo interior de
      // luz (inset top) que da el "canto" del cristal. Centralizadas para que
      // todas las tarjetas premium compartan la misma física de luz.
      boxShadow: {
        glass: "0 16px 40px -16px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
        "glass-lg": "0 30px 60px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.07)",
        "glow-accent": "0 0 28px -8px rgba(122,240,200,0.45)",
        "glow-gold": "0 0 28px -8px rgba(232,200,122,0.45)",
      },
      backdropBlur: {
        glass: "18px",
      },
      animation: {
        // Entradas (fade/slide): curva ease-out FUERTE en vez del `ease`
        // nativo de CSS, que es demasiado flojo y no tiene "punch". Arrancar
        // rápido y frenar al final hace que el contenido se sienta más
        // responsivo justo en el instante en que el ojo está mirando.
        // cubic-bezier(0.23,1,0.32,1) es el "strong ease-out" de referencia.
        "fade-in": "fadeIn 0.4s cubic-bezier(0.23,1,0.32,1) forwards",
        "slide-up": "slideUp 0.35s cubic-bezier(0.23,1,0.32,1) forwards",
        "zoom-out": "zoomOut 0.7s cubic-bezier(0.4,0,0.2,1) forwards",
        "shake": "shake 0.4s ease",
        "pop": "pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "hint-flash": "hintFlash 0.55s ease-out forwards",
        "reveal-win": "revealWin 1s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "toast-in": "toastIn 0.28s cubic-bezier(0.34,1.4,0.64,1) forwards",
        "shimmer": "shimmer 1.4s linear infinite",
        "flip-reveal": "flipReveal 0.7s cubic-bezier(0.23,1,0.32,1) forwards",
        // ── Prensa del motor: el movimiento es "de imprenta" — estampar
        //    (aparece asentándose), sellar (el sello cae con overshoot) y
        //    temblor (errata en el cupón). Sin glows ni rebotes largos.
        "estampar": "estampar 0.28s cubic-bezier(0.2,1,0.3,1) both",
        "sellar": "sellar 0.45s cubic-bezier(0.2,1.4,0.4,1) both",
        "temblor": "temblor 0.4s ease",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "translateY(0)" } },
        zoomOut: { from: { transform: "var(--zoom-from)" }, to: { transform: "var(--zoom-to)" } },
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%,60%": { transform: "translateX(-5px)" },
          "40%,80%": { transform: "translateX(5px)" },
        },
        pop: { from: { opacity: 0, transform: "scale(0.85)" }, to: { opacity: 1, transform: "scale(1)" } },
        hintFlash: {
          "0%":   { opacity: 0 },
          "25%":  { opacity: 1 },
          "100%": { opacity: 0 },
        },
        // Animación al ganar: parte del último zoom CSS activo (inyectado
        // por CarImage como --zoom-from, p.ej. 1.667 si ganó en el 2º
        // intento) y vuelve a scale=1, pasando por un pequeño overshoot.
        // El fallback 1.6 es el escenario medio (ganar en intento 3).
        revealWin: {
          "0%":   { transform: "scale(var(--zoom-from, 1.6))" },
          "65%":  { transform: "scale(1.04)" },
          "100%": { transform: "scale(1)" },
        },
        toastIn: {
          from: { opacity: 0, transform: "translateY(20px) scale(0.95)" },
          to:   { opacity: 1, transform: "translateY(0) scale(1)" },
        },
        // Barrido diagonal sobre el fondo neutro de la celda pending. Recorre
        // -150% → 150% para que el brillo entre y salga limpio sin "saltar".
        shimmer: {
          "0%":   { backgroundPosition: "-150% 0" },
          "100%": { backgroundPosition: "150% 0" },
        },
        // Flip X al revelar cada celda tras la respuesta del servidor: la carta
        // se voltea de canto (90deg) a plano. UN SOLO movimiento que decelera
        // limpio — antes el keyframe sobrepasaba a -15deg Y el easing era
        // bouncy (cubic-bezier con 1.4): dos overshoots apilados producían un
        // wobble "torpe" y, al ir el easing tan cargado al inicio, la carta
        // llegaba de golpe ("demasiado rápida"). Aquí el rebote desaparece; el
        // ease-out fuerte del token hace todo el trabajo de asentar la carta.
        flipReveal: {
          from: { opacity: 0, transform: "rotateX(90deg)" },
          to:   { opacity: 1, transform: "rotateX(0deg)" },
        },
        estampar: { from: { opacity: 0, transform: "scale(1.02)" } },
        sellar: { from: { opacity: 0, transform: "rotate(-7deg) scale(1.7)" } },
        temblor: {
          "20%,60%": { transform: "translateX(-4px)" },
          "40%,80%": { transform: "translateX(4px)" },
        },
      },
    },
  },
  plugins: [],
};
