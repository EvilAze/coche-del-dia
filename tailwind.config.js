/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
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
        // (`accent.glow` y `gold.glow` valían `transparent`: eran el hueco que
        // dejó el halo del tema menta, y nadie los usaba ya. Un token que pinta
        // nada solo sirve para que alguien lo reutilice creyendo que pinta algo.)
        accent: {
          DEFAULT: "rgb(var(--rojo-rgb) / <alpha-value>)",
          dark: "rgb(var(--rojo-dark-rgb) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--gold-rgb) / <alpha-value>)",
          dark: "rgb(var(--gold-dark-rgb) / <alpha-value>)",
          ink: "rgb(var(--bg-rgb) / <alpha-value>)",
        },
        muted: "rgb(var(--tinta2-rgb) / <alpha-value>)",
        // (Fuera el alias `mint`. Apuntaba a la terna del ROJO, así que pintaba
        // bien y mentía: quedaban cinco `text-mint` y un `hover:bg-mint` en el
        // perfil propio y el público pintando de rojo bajo el nombre del tema de
        // hace dos rediseños. Ya están todos escritos como lo que son.)
        card: {
          DEFAULT: "rgb(var(--surface-rgb) / <alpha-value>)",
          foreground: "rgb(var(--tinta-rgb) / <alpha-value>)",
        },
        foreground: "rgb(var(--tinta-rgb) / <alpha-value>)",
        "muted-foreground": "rgb(var(--tinta2-rgb) / <alpha-value>)",
        destructive: "rgb(var(--rojo-rgb) / <alpha-value>)",
      },
      // (Aquí vivían las sombras y el blur del sistema «Liquid Glass»: `glass`,
      // `glass-lg`, `glow-accent`, `glow-gold` y `backdropBlur.glass`. El material
      // de cristal se retiró en el rediseño plano y de él no quedaba ni un
      // consumidor, pero los tokens seguían en el tema — `glow-accent` todavía
      // guardaba el rgba(122,240,200) del acento MENTA, dos pieles atrás. En el
      // sistema actual lo que flota lleva `--sombra-flota` (index.css, una receta
      // por tema) y los halos están prohibidos: sobre papel no existen.)
      // Solo las que algún componente monta hoy. Con la piel «prensa» cayeron
      // `zoom-out`, `shake`, `pop`, `shimmer` y `flip-reveal` (celdas y
      // escenario se re-hicieron sin ellas) y `estampar`, que además duplicaba
      // el `estamparFila` de index.css — el que sí se usa. Una animación que no
      // monta nadie no engorda el CSS (Tailwind purga por contenido), pero sí
      // se ofrece a quien busque en el tema y crea que es la vigente.
      animation: {
        // Entradas (fade/slide): curva ease-out FUERTE en vez del `ease`
        // nativo de CSS, que es demasiado flojo y no tiene "punch". Arrancar
        // rápido y frenar al final hace que el contenido se sienta más
        // responsivo justo en el instante en que el ojo está mirando.
        // cubic-bezier(0.23,1,0.32,1) es el "strong ease-out" de referencia.
        "fade-in": "fadeIn 0.4s cubic-bezier(0.23,1,0.32,1) forwards",
        "slide-up": "slideUp 0.35s cubic-bezier(0.23,1,0.32,1) forwards",
        "hint-flash": "hintFlash 0.55s ease-out forwards",
        "reveal-win": "revealWin 1s cubic-bezier(0.34,1.56,0.64,1) forwards",
        "toast-in": "toastIn 0.28s cubic-bezier(0.34,1.4,0.64,1) forwards",
        // ── Prensa del motor: el movimiento es "de imprenta" — sellar (el
        //    sello cae con overshoot) y temblor (errata en el cupón). Sin
        //    glows ni rebotes largos.
        "sellar": "sellar 0.45s cubic-bezier(0.2,1.4,0.4,1) both",
        "temblor": "temblor 0.4s ease",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "translateY(0)" } },
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
