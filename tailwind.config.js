/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Bebas Neue'", "cursive"],
        body: ["'DM Sans'", "sans-serif"],
      },
      colors: {
        bg: {
          primary: "#0a0a0b",
          secondary: "#111113",
          tertiary: "#1a1a1f",
        },
        border: {
          DEFAULT: "#2a2a32",
          strong: "#3a3a45",
        },
        accent: {
          DEFAULT: "#e8c87a",
          dark: "#c4a455",
          glow: "rgba(232,200,122,0.15)",
        },
        muted: "#9a9aab",
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
        revealWin: {
          "0%":   { transform: "scale(var(--zoom-from, 2.4))" },
          "65%":  { transform: "scale(1.06)" },
          "100%": { transform: "scale(1)" },
        },
        toastIn: {
          from: { opacity: 0, transform: "translateY(20px) scale(0.95)" },
          to:   { opacity: 1, transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
