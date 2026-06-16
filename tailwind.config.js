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
        "fade-in": "fadeIn 0.4s ease forwards",
        "slide-up": "slideUp 0.35s ease forwards",
        "zoom-out": "zoomOut 0.7s cubic-bezier(0.4,0,0.2,1) forwards",
        "shake": "shake 0.4s ease",
        "pop": "pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "hint-flash": "hintFlash 0.55s ease-out forwards",
        "reveal-win": "revealWin 1s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "toast-in": "toastIn 0.28s cubic-bezier(0.34,1.4,0.64,1) forwards",
        "shimmer": "shimmer 1.4s linear infinite",
        "flip-reveal": "flipReveal 0.55s cubic-bezier(0.34,1.4,0.64,1) forwards",
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
        // Flip Y al revelar cada celda tras la respuesta del servidor. El
        // overshoot (-15deg → 0) le da un toque táctil de "carta volteándose".
        flipReveal: {
          "0%":   { opacity: 0, transform: "rotateX(90deg)" },
          "55%":  { opacity: 1, transform: "rotateX(-15deg)" },
          "100%": { opacity: 1, transform: "rotateX(0)" },
        },
      },
    },
  },
  plugins: [],
};
