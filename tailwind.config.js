/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // EL HOVER NO EXISTE EN UN MÓVIL, PERO SE PEGA. Esta bandera hace que todas
  // las utilidades `hover:` compilen dentro de `@media (hover: hover)`, que es
  // lo mismo que las reglas de index.css hacen ya a mano. Sin ella, tocar un
  // elemento en Android aplica su estado de hover y lo deja PUESTO hasta que
  // tocas otra cosa: el botón del cupón se quedaba levantado con su sombra dura
  // después de cada intento, y la portada del Archivo, flotando. Es de esas
  // cosas que nadie sabe nombrar y todo el mundo nota — se lee como que la app
  // «se queda colgada» en el sitio donde acabas de tocar.
  //
  // (En Tailwind 4 esto es el comportamiento por defecto y la bandera
  // desaparece; aquí, en la 3, hay que pedirlo.)
  future: { hoverOnlyWhenSupported: true },
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
      // ── EL COMPÁS, del lado de Tailwind ──────────────────────────────────
      // Gemelos de los tokens `--ms-*` / `--curva-*` de index.css, para que el
      // JSX pueda escribir `duration-hoja ease-entra` en vez de inventarse un
      // `duration-[180ms]`. Apuntan A LAS MISMAS variables y no a copias de los
      // valores: dos listas de números que hay que acordarse de sincronizar es
      // exactamente el problema que el compás viene a resolver, y aquí ya pasó
      // una vez —esta misma sección describía una curva "strong ease-out" que
      // index.css no usaba en ninguna de sus cincuenta transiciones—.
      transitionDuration: {
        pulso: "var(--ms-pulso)",
        roce: "var(--ms-roce)",
        hoja: "var(--ms-hoja)",
        sello: "var(--ms-sello)",
        escena: "var(--ms-escena)",
        revelado: "var(--ms-revelado)",
      },
      transitionTimingFunction: {
        entra: "var(--curva-entra)",
        sale: "var(--curva-sale)",
        roce: "var(--curva-roce)",
        sello: "var(--curva-sello)",
        lente: "var(--curva-lente)",
      },
      // (Se fue `hint-flash` con su keyframe: era el lavado rojo al 35% sobre la
      // fotografía al desbloquear pista. Lo cuenta CarImage — resumen: tapaba
      // justo el trozo de coche que venía a anunciar, era el único efecto de
      // videojuego en un sistema que prohíbe los halos, y con
      // `prefers-reduced-motion` se quedaba PUESTO para siempre. El aviso lo da
      // ahora la foto abriéndose y el contador de pista re-estampándose.)
      animation: {
        // Entradas: `entra` es el ease-out fuerte del sistema. Arrancar rápido y
        // frenar al final hace que el contenido se sienta más responsivo justo
        // en el instante en que el ojo está mirando.
        "fade-in": "fadeIn var(--ms-escena) var(--curva-entra) forwards",
        "slide-up": "slideUp var(--ms-escena) var(--curva-entra) forwards",
        "reveal-win": "revealWin var(--ms-revelado) var(--curva-lente) forwards",
        "toast-in": "toastIn var(--ms-sello) var(--curva-sello) forwards",
        // ── Prensa del motor: el movimiento es "de imprenta" — sellar (el
        //    sello cae con overshoot) y temblor (errata en el cupón). Sin
        //    glows ni rebotes largos.
        "sellar": "sellar var(--ms-escena) var(--curva-sello) both",
        "temblor": "temblor var(--ms-escena) var(--curva-roce)",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: "translateY(12px)" }, to: { opacity: 1, transform: "translateY(0)" } },
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
