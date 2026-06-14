# Diseño — Sistema de material "Cristal Líquido" unificado (UI premium)

**Fecha:** 2026-06-15
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación
**Área:** UI/UX — elevación premium del lenguaje glassmorphism existente

## Contexto

El sistema "Liquid Glass" **ya existe y es maduro** en el proyecto: utilidades
`.glass`/`.glass-strong`/`.modal-scrim`/`.modal-panel-glass` con fallback
`@supports`, tokens de tema (`--glass-fill`, `--glass-edge`, `--glass-blur`), el
fondo "aurora" (`.cdd-ambient`, mesh gradient con drift por GPU y off en
`reduced-motion`), y un sistema `.cdd-*` completo para la pantalla de juego.

Por tanto el encargo NO es "implementar glassmorphism" (hecho), sino **subir el
techo y unificar**: convertir el cristal disperso en un sistema de material
reutilizable y elevarlo a un acabado premium coherente.

## Problema

1. **Material disperso e inconsistente.** El `blur` aparece como `4 / 10 / 18 /
   22 / 24px` y `xl`; el `saturate` como `140 / 160 / 170 / 175%`. Cada `.cdd-*`
   y cada utilidad Tailwind re-declara su relleno, canto y sombra a mano.
2. **Superficies que deberían ser cristal son opacas.** `.cdd-end-card` usa
   `var(--bg)` (¡el pico celebratorio es una caja sólida!); `.cdd-tab`,
   `.cdd-stat`, `.cdd-grid`, `.cdd-next`, `.cdd-dist-card`, `.cdd-stage-frame`
   usan `var(--surface)`. Hay scrims artesanales (`bg-black/8x backdrop-blur-sm`)
   en SwapCarModal, el drawer de Garage, el lightbox de CarImage y
   RepescaDrawAnimation, en vez del `.modal-scrim` unificado.
3. **El acabado premium se queda corto.** El "canto" es una sola línea de 1px
   (`--glass-edge`), sin *rim especular*; y el foco de luz ambiente está anclado
   solo arriba, así que la mitad inferior (formulario, historial, pie) se lee
   plana.
4. **Anti-patrón de perf ya en producción.** `modal-scrim` + `modal-panel-glass`
   anidan dos `backdrop-filter` (y los scrims artesanales suman más capas).

## Objetivo

Consolidar el cristal en **UN** sistema de material reutilizable (tokens CSS +
clases componibles) y aplicarlo en Tier 1 + Tier 2, subiendo el listón premium
(rim especular, 2.º foco de luz, micro-interacciones de hover/focus/press) **sin
romper el layout afinado ni la perf móvil**, manteniendo menta = acción / oro =
premium y todas las reglas de `CLAUDE.md`.

## Decisiones tomadas (brainstorming)

| Decisión | Elección | Razón |
|---|---|---|
| Ambición | **Subir el techo** (más allá del listón actual) | El sistema existe; el valor está en elevarlo, no en reimplementarlo. |
| Maquinaria | **C · Refactor de material** | Consolidar el cristal en un sistema reutilizable y aplicarlo app-wide. Máxima coherencia y mejor cimiento; se descarta el hook JS reactivo (B). |
| Naturaleza de la convención | **Tokens CSS + clases componibles** (no un componente `<Glass>` JSX) | El cristal del proyecto es CSS-driven (`.cdd-*` + `@layer utilities`); centralizar en tokens/clases encaja con el codebase y con la regla "no TypeScript / CSS-first". Menos churn de JSX. |
| Estrategia de blur en paneles | **Scrim desenfoca; el panel es translúcido + rim, SIN blur propio** | Evita anidar `backdrop-filter` y de paso **arregla** el doble-blur que ya existe hoy (ganancia de perf). |
| Alcance | **Tier 1 + Tier 2; admin EXCLUIDO** | Cubrir todo lo de cara al usuario sin gastar riesgo/diff en una herramienta interna (`/admin-tools`). |

## Approaches descartados

- **A — Especular CSS puro sin unificar.** Daría el look premium pero dejando el
  material disperso; no salda la deuda de inconsistencia. (El refactor C incluye
  el especular, además de unificar.)
- **B — A + luz reactiva al puntero.** El "wow" de alta gama con un hook JS
  (desktop-only). Se pospone: primero consolidar el material (CSS puro). Se puede
  sumar después sobre 2–3 superficies hero sin tocar este sistema.
- **Componente React `<Glass>`.** No idiomático aquí; más churn de JSX y peor que
  centralizar en tokens/clases CSS.
- **Esparcir `bg-white/10` / `border-white/10`** (como sugería el brief inicial).
  Viola `CLAUDE.md`: la convención es usar los tokens del tema, no hex/arbitrary
  sueltos. Rompería el sistema en vez de elevarlo.
- **Dirección visual nueva / otra paleta.** Descartada en la 1.ª pregunta: nos
  quedamos dentro de "Platino Eléctrico".

## El modelo: dos ejes + elevación

Separar lo que hoy va mezclado en cada superficie:

- **Material** = relleno translúcido + `blur` + `saturate` (la refracción).
- **Luz** = canto (`edge`) + *rim especular* + sombra flotante + glow.
- **Elevación** = `control` ‹ `surface` ‹ `overlay` ‹ `hero`.

## Tokens (única fuente de verdad)

En `:root` y en los temas `.theme-platino` / `.theme-cobre`, absorbiendo los
`--glass-*` actuales. Valores de partida (se afinan en implementación):

**Material**
- `--mat-fill-1: rgba(255,255,255,.045)` — controles (actual `--glass-fill`).
- `--mat-fill-2: rgba(255,255,255,.06)` — surfaces / cards.
- `--mat-fill-3: rgba(255,255,255,.085)` — overlays / hero (~`--glass-fill-2`).
- `--mat-blur-1: 14px` — controles / chips.
- `--mat-blur-2: 22px` — overlays / modales.
- `--mat-sat: 170%` — un único valor de saturación.
- (En `.theme-cobre`, equivalentes cálidos `rgba(255,238,220,…)`, como ya hace.)

**Luz**
- `--edge: inset 0 1px 0 rgba(255,255,255,.07)` — canto suave (actual `--glass-edge`).
- `--spec: .55` — intensidad del rim especular (dial por superficie: hero ↑, control ↓ o 0).
- `--elev-1/-2/-3` — sombras flotantes por tier (hoy esparcidas como literales).
- `--glow-accent` / `--glow-gold` — espejo CSS de los `boxShadow` de Tailwind.

**Borde**: reutiliza `--line` / `--line-2`; se añade `--line-strong` para hero.

## La convención (clases componibles)

En `@layer components` (CSS plano, consumible tanto por `.cdd-*` como por markup
Tailwind):

- `.surface-1/-2/-3` → `fill + border + blur + edge + elev` del tier. Incluye el
  **fallback `@supports`** centralizado (sin `backdrop-filter` → relleno sólido
  del tema, legibilidad garantizada).
- `.spec` → **rim especular** vía `::before` con `mask` (borde-gradiente a 135°,
  brillante arriba-izquierda). Solo en cards / hero / overlays.
- `.lift` → hover/press estandarizado (`transition` + `:hover translateY(-2px)` +
  ramp de `--elev`/glow + `:active`), envuelto en `@media (hover:hover)` y anulado
  en `prefers-reduced-motion`.
- `.scrim` → fondo oscuro + blur único; unifica `modal-scrim` y reemplaza los
  `bg-black/8x backdrop-blur-sm` artesanales.

**Aplicación sin churn de JSX:** las reglas `.cdd-*` se reescriben para consumir
los tokens (mismo selector semántico, valores centralizados). Donde el elemento
ya usa `::before/::after` (p. ej. `.cdd-stage-frame::after` viñeta,
`.cdd-chip.is-pending::after` shimmer), el rim se omite a favor de un `--edge`
reforzado, para no pisar pseudo-elementos existentes.

## Modelo de rendimiento (la regla que sostiene "app-wide")

**Un solo `backdrop-filter` por linaje de apilamiento.**

- **Scrims desenfocan**; los paneles encima (`modal-panel-glass`,
  `.cdd-end-card`) usan relleno translúcido + `.spec` **pero sueltan su propio
  `backdrop-filter`**. Esto arregla el doble-blur actual (perf ↑).
- Overlays que **no** van sobre un scrim (listbox, decades, statuspill, iconbtn,
  combo) conservan su único `backdrop-filter`.
- **Caveat de apilamiento PRESERVADO:** el `backdrop-filter` de `.cdd-combo` /
  `.cdd-year` crea el *stacking context* del que depende el `z-index: 40` del
  `.cdd-listbox` (`src/index.css:613`). El refactor **no** se lo quita.
- **Objetivo explícito:** el conteo neto de capas de `backdrop-filter` tras el
  refactor debe ser **igual o menor** que hoy.

**Decisión para end-card / modales:** el scrim desenfoca la página; el panel es
translúcido + rim especular + glow interior (sin blur propio). Se lee como
cristal iluminado sin anidar blur; en el end-card, la foto del revelado aporta el
"color a través del cristal" en la banda superior.

## Foco de luz ambiente (2.º)

`.cdd-ambient`: añadir un 3.er radial bajo (~`60% 112%`, menta tenue) y un leve
oro a media altura, para que la mitad inferior (formulario / historial / pie)
tenga algo que refractar. Se mantiene el drift por `transform` (GPU) y el off en
`prefers-reduced-motion`.

## Migración por superficie (alcance: Tier 1 + Tier 2; admin fuera)

**Tier 1 — núcleo**
- Tokens + clases + fallback `@supports` (adición pura; sin cambio visual).
- Utilidades Tailwind → tokens: `.glass`, `.glass-strong`, `.glass-hover`,
  `.modal-scrim` → `.scrim`, `.modal-panel-glass` (suelta blur propio sobre scrim).
- `.cdd-*` controles/overlays → tokens: `iconbtn`, `statuspill`, `helpchip`,
  `combo`, `year`, `listbox`, `decades`, `year-steps`, `decade`, `opt`.
- Acristalar opacas = **relleno translúcido + canto/`.spec`**, NO necesariamente
  `backdrop-filter`. Las que van **sobre el scrim** del end-card no llevan blur
  propio (regla de perf): `.cdd-end-card` (`var(--bg)` → `surface-3` sin blur +
  `.spec`) y sus tiles internos `.cdd-tab`, `.cdd-stat`, `.cdd-grid`,
  `.cdd-next`, `.cdd-dist-card`. El `.cdd-stage-frame` gana `.spec` + tokens de
  canto/elevación pero **tampoco** añade blur (la foto `object-cover` cubre el
  relleno; el desenfoque sería gasto inútil); conserva su glow de acento.
- Rim especular en hero: `stage-frame`, `end-card`, `modal-panel`, `submit`
  (su sheen ya existe; se armoniza con el token `--spec`).

**Tier 2 — secundarias de usuario**
- `HeaderSandwich` (sticky `bg-[#0d0c0a]/90 backdrop-blur-xl` → material + blur canónico).
- `CarImage`: lightbox scrim (`bg-black/90 backdrop-blur-sm` → `.scrim`) y badges.
- `Toast` (`bg-bg-tertiary/95 backdrop-blur-md` → material).
- `Autocomplete`, `GuessForm`, `GuessRow` (superficies `bg-bg-secondary/*`).
- `Repesca`: header (`backdrop-blur-xl`) + `ResultPanel` legacy (de
  `bg-bg-tertiary` opaco → material) + scrims (RepescaDrawAnimation).
- `Garage`: el drawer scrim (`bg-black/85`) se unifica; los sub-modales ya usan
  `modal-panel-glass` (heredan la mejora).

**Fuera (admin):** `src/admin/*` (SwapCarModal y paneles). SwapCarModal seguirá
heredando lo que toque de las utilidades compartidas, pero no se premiumiza.

## Accesibilidad

- Fallback sólido `@supports not (backdrop-filter)` centralizado por tier.
- `prefers-reduced-transparency: reduce` → rellenos casi opacos (nuevo).
- `prefers-reduced-motion` → `.lift` y drifts off (ya respetado en el resto).
- Contraste AA del texto sobre cristal preservado (no bajar la opacidad del texto).

## Guardarraíles (regresión)

- **SOLO PINTURA.** El refactor cambia `fill / border / box-shadow /
  backdrop-filter / ::before`. **Cero** cambios a `width / height / padding /
  margin / position / top / left / flex / grid / aspect-ratio / container-type` →
  el fold (100svh), el cuadrado por container-query y los fixes de stacking
  quedan intactos.
- Preservar el `backdrop-filter` de `combo` / `year` (stacking del listbox).
- **UTF-8** (regla 14): comentarios en español con tildes correctas; sin
  no-ASCII en char-classes de regex (n/a en CSS, ojo si se toca JS).
- Es CSS: no afecta a la identidad del coche, la imagen segura ni nada de
  seguridad.

## Despliegue (incremental; el usuario verifica en su `vercel dev` — regla 12)

Cada paso = un commit revisable; el usuario verifica visualmente entre pasos;
git permite bisecar una regresión:

1. Tokens + clases + fallback (sin cambio visual perceptible).
2. Utilidades Tailwind `.glass*` / `modal-*` → tokens (los modales se actualizan juntos).
3. `.cdd-*` controles/overlays → tokens (valores centralizados; comportamiento
   preservado; vigilar el stacking del combo).
4. Acristalar opacas + rim en hero + 2.º foco de luz (el salto visual premium).
5. Tier 2.

Un único PR `claude/liquid-glass-material` → `main` con todo (regla 13).

## Testing / verificación

- **Automático:** `npm test` (Vitest) + `test:security` / `test:rls` /
  `test:attacks` deben seguir verdes (sin relación con CSS, pero se corren antes
  del PR).
- **Visual (usuario, regla 12):** en `vercel dev`, recorrer juego (fold móvil +
  desktop), abrir el combo (stacking del listbox), ganar/perder (EndScreen
  acristalado), cada modal (howto, scoring, ranking, stats, garage, perfil,
  nickname, auth), lightbox de la foto, Repesca y Toast. Comprobar framerate en
  móvil de gama baja (no más capas de blur que antes) y
  `prefers-reduced-motion` / `prefers-reduced-transparency`.
- **Criterio de aceptación:** ninguna superficie opaca "huérfana" en Tier 1+2;
  rim especular coherente en hero; mitad inferior con vida; conteo de blur ≤ al
  actual; cero cambios de layout.

## Fuera de alcance

- **B (luz reactiva al puntero):** mejora futura sobre 2–3 hero, sin tocar este sistema.
- **`src/admin/*`:** herramienta interna.
- **Nueva paleta / dirección visual distinta a Platino.**
- **Cambios de layout/box-model, copy, lógica de juego, i18n.**
