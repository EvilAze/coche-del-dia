/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Sistema único "menta": Archivo manda en display y cuerpo (antes
        // Bebas Neue / DM Sans), Space Mono para etiquetas técnicas. Coincide
        // con la pantalla de juego para que toda la web sea coherente.
        display: ["'Archivo'", "sans-serif"],
        body: ["'Archivo'", "sans-serif"],
        mono: ["'Space Mono'", "monospace"],
        // ── Sistema «Prensa del motor» (F1+): familias nuevas en convivencia.
        //    display/body/mono se reasignan en F5, cuando ya no quede ninguna
        //    pantalla en el sistema antiguo.
        serif: ["'Fraunces'", "Georgia", "serif"],
        franklin: ["'Libre Franklin'", "Arial", "sans-serif"],
        courier: ["'Courier Prime'", "monospace"],
      },
      colors: {
        // Paleta fría "Platino menta": fondos grafito, acento menta #7af0c8.
        bg: {
          primary: "#0d1014",
          secondary: "#14181e",
          tertiary: "#1b212a",
        },
        border: {
          DEFAULT: "#252b34",
          strong: "#333b46",
        },
        accent: {
          DEFAULT: "#7af0c8",
          dark: "#5bd3ab",
          glow: "rgba(122,240,200,0.15)",
        },
        // Oro premium: acento metálico RESERVADO a momentos de alta gama
        // (rachas, victoria, podio, logros). No compite con la menta (acción):
        // la menta es "haz clic / acertaste", el oro es "esto es valioso".
        // Reconcilia la marca cobre/oro histórica como capa de lujo, no como base.
        gold: {
          DEFAULT: "#e8c87a",
          dark: "#caa856",
          ink: "#1a1306", // tinta oscura para texto sobre relleno oro (contraste AA)
          glow: "rgba(232,200,122,0.15)",
        },
        // Gris frío neutral (antes cálido #a39d97): integra con la menta.
        muted: "#8b95a3",
        // ── Sistema «Prensa del motor» (F1+). Los tokens antiguos conviven
        //    hasta F5: retirarlos ahora dejaría sin estilo las pantallas aún
        //    no portadas. El grep de limpieza es criterio de cierre de F5. ──
        papel: { DEFAULT: "#f3eee1", 2: "#e9e2cf", mat: "#fbf7ec" },
        tinta: { DEFAULT: "#1b1712", 2: "#6e6553" },
        rojo: "#b3271b",
        // Oro premium re-pigmentado para papel: SOLO texto/filetes, nunca
        // relleno (el #e8c87a actual es ilegible sobre claro).
        "oro-viejo": "#7a5c10",
        // ── Tokens v0 (shadcn) para calcar el diseño de Vercel v0 al pie ──
        // Permiten usar las clases EXACTAS del v0 (bg-mint, text-mint-foreground,
        // bg-card, text-foreground, text-muted-foreground, text-destructive).
        mint: { DEFAULT: "#7af0c8", foreground: "#05131d" },
        card: { DEFAULT: "#14181e", foreground: "#eef2f6" },
        foreground: "#eef2f6",
        "muted-foreground": "#8b95a3",
        destructive: "#e26060",
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
