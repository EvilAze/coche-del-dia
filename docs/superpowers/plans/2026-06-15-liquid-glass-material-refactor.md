# Refactor de material "Cristal Líquido" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar el cristal disperso de la app en un único sistema de material (tokens CSS + clases componibles) y elevarlo a un acabado premium (rim especular, 2.º foco de luz, micro-interacciones), aplicándolo en Tier 1 + Tier 2 (admin excluido).

**Architecture:** Casi todo vive en `src/index.css`. Se añaden tokens de material/luz a los temas (`.theme-platino` / `.theme-cobre`), un puñado de clases componibles (`.glass`, `.glass-panel`, `.scrim`, `.spec`, `.lift`) y se migran las superficies existentes a esos tokens. Regla de oro de rendimiento: **un solo `backdrop-filter` por linaje de apilamiento** (los scrims desenfocan; los paneles encima no). El refactor es **solo pintura**: no cambia ni una propiedad de layout (`width/height/padding/margin/position/flex/grid/aspect-ratio/container-type`).

**Tech Stack:** CSS (Tailwind 3 `@layer`, custom properties, `backdrop-filter`, `mask`), JSX (solo strings de clase en Tier 2). Sin TypeScript, sin dependencias nuevas.

**Verificación (importante):** esto es un refactor CSS *paint-only*; no hay unit tests de CSS. Cada tarea se verifica con (a) `npm run build` (valida el CSS y que Vite compila), (b) cuando aplica, un *grep invariante*, y (c) un **checkpoint visual que ejecuta el USUARIO en su `vercel dev`** (regla 12 de CLAUDE.md — no se levantan servidores de preview aquí). Las suites Vitest/seguridad se corren al final (no las afecta el CSS, pero CLAUDE.md las exige antes del PR).

**Rama:** `claude/liquid-glass-material` (ya creada desde `main`). Un único PR al terminar (regla 13).

**Estilo:** comentarios en español explicando el *porqué* (regla 10). UTF-8 correcto, sin no-ASCII en char-classes de regex (regla 14; n/a en CSS).

---

## Estructura de archivos

- **Modificar (núcleo):** `src/index.css` — tokens, clases componibles, fallback `@supports`, migración de todas las superficies `.cdd-*`, utilidades `.glass*`/`modal-*`, `.cdd-ambient`.
- **Modificar (Tier 2):** `src/components/CarImage.jsx`, `src/components/Toast.jsx`, `src/components/Garage.jsx`, `src/Repesca.jsx`, `src/components/ResultPanel.jsx`, `src/components/RepescaDrawAnimation.jsx`.
- **Sin tocar:** `tailwind.config.js` (los `boxShadow.glass*`/`backdropBlur.glass` siguen disponibles; el sistema nuevo es por custom properties), `src/admin/*` (fuera de alcance), todo lo de layout/lógica/i18n.

---

## Fase 0 — Línea base

### Task 0: Capturar el conteo de capas de blur (invariante de perf)

**Files:**
- Solo lectura.

- [ ] **Step 1: Contar `backdrop-filter` actuales**

Run:
```bash
grep -rcE "backdrop-filter|backdrop-blur" src/index.css src/components src/Repesca.jsx --include=*.css --include=*.jsx | awk -F: '{s+=$2} END{print "TOTAL backdrop layers:", s}'
```
Anota el número (p. ej. `TOTAL backdrop layers: N`). **Invariante:** al final del plan (Task 16) este total debe ser **≤ N**. El refactor no puede aumentar las capas de desenfoque.

---

## Fase 1 — Cimiento (tokens + clases). Sin cambio visual.

### Task 1: Añadir tokens de material y luz a los temas

**Files:**
- Modify: `src/index.css` (bloque `.theme-platino`, ~líneas 234-254, y `.theme-cobre`, ~255-271)

- [ ] **Step 1: Añadir los tokens nuevos a `.theme-platino`**

Dentro de `.theme-platino { … }`, justo después del bloque de "Cristal líquido" existente (`--glass-fill … --glass-blur`), añadir:

```css
  /* ── Sistema de material unificado (refactor Cristal Líquido) ──
     Dos ejes ortogonales que antes iban mezclados en cada superficie:
     MATERIAL (relleno translúcido + blur + saturación = la refracción) y
     LUZ (canto + rim especular + sombra flotante + glow = cómo le da la luz).
     Una sola escala para toda la app: adiós a blur 4/10/18/22/24 y saturate
     140/160/170/175 sueltos. */
  --mat-fill-1: rgba(255,255,255,.05);   /* controles / chips */
  --mat-fill-2: rgba(255,255,255,.065);  /* surfaces / cards */
  --mat-fill-3: rgba(255,255,255,.085);  /* overlays / hero  */
  --mat-blur-1: 14px;  /* controles / chips */
  --mat-blur-2: 22px;  /* overlays / modales */
  --mat-sat: 170%;     /* saturación única (recupera la viveza del acento
                          que el blur "apaga": da sensación de vidrio real) */
  --edge: inset 0 1px 0 rgba(255,255,255,.08);  /* canto de luz superior */
  --spec: .55;  /* intensidad del rim especular; dial por superficie (hero ↑) */
  --elev-1: 0 16px 40px -16px rgba(0,0,0,.55);
  --elev-2: 0 30px 60px -28px rgba(0,0,0,.78);
  --elev-3: 0 50px 90px -40px rgba(0,0,0,.9);
  --glow-accent: 0 0 28px -8px rgba(122,240,200,.45);
  --glow-gold: 0 0 28px -8px rgba(232,200,122,.45);
  --line-strong: rgba(255,255,255,.16);
```

- [ ] **Step 2: Añadir los equivalentes cálidos a `.theme-cobre`**

Dentro de `.theme-cobre { … }`, tras su bloque de cristal, añadir (alpha cálido sobre `rgba(255,238,220,…)` como ya hace el tema):

```css
  /* Material unificado, variante cálida del tema cobre. */
  --mat-fill-1: rgba(255,238,220,.055);
  --mat-fill-2: rgba(255,238,220,.075);
  --mat-fill-3: rgba(255,238,220,.095);
  --mat-blur-1: 14px;
  --mat-blur-2: 22px;
  --mat-sat: 170%;
  --edge: inset 0 1px 0 rgba(255,238,220,.09);
  --spec: .5;
  --elev-1: 0 16px 40px -16px rgba(0,0,0,.55);
  --elev-2: 0 30px 60px -28px rgba(0,0,0,.78);
  --elev-3: 0 50px 90px -40px rgba(0,0,0,.9);
  --glow-accent: 0 0 28px -8px rgba(122,240,200,.45);
  --glow-gold: 0 0 28px -8px rgba(232,200,122,.45);
  --line-strong: rgba(255,238,220,.16);
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build OK. No hay cambio visual (los tokens aún no tienen consumidores).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): tokens de material y luz unificados (Cristal Líquido)"
```

---

### Task 2: Añadir las clases componibles del sistema

**Files:**
- Modify: `src/index.css` (`@layer utilities`, tras el bloque del sistema "Liquid Glass" actual, ~línea 145)

- [ ] **Step 1: Añadir clases nuevas**

```css
  /* ── Clases componibles del material unificado ──
     `.glass`/`.glass-strong` (ya existen, se tokenizan en Task 3) son la
     superficie de cristal CON desenfoque para piezas SOBRE la página.
     `.glass-panel` es la variante SIN desenfoque para piezas SOBRE un scrim
     (modales, end-card y sus tiles): el scrim ya desenfocó la página, así que
     volver a desenfocar sería anidar backdrop-filter (mata el framerate móvil).
     Lee como cristal igual gracias al relleno translúcido + rim + sombra. */
  .glass-panel {
    background: var(--mat-fill-3);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-3), var(--edge);
  }
  @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
    .glass-panel { background: var(--surface); }
  }

  /* Rim especular: canto superior-izquierdo brillante que decae, simulando una
     fuente de luz cenital-lateral. Es lo que separa "caja translúcida" de
     "cristal premium". Va por ::before enmascarado (borde-gradiente), así que
     NO se puede usar en elementos que ya ocupen su ::before. Intensidad por
     --spec (dial por superficie). */
  .spec { position: relative; }
  .spec::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
    background: linear-gradient(135deg,
      rgba(255,255,255,var(--spec, .5)),
      rgba(255,255,255,calc(var(--spec, .5) * .12)) 32%,
      transparent 56%,
      rgba(255,255,255,calc(var(--spec, .5) * .28)));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    pointer-events: none;
  }

  /* Lift: micro-interacción de elevación al pasar el ratón / pulsar. Solo en
     dispositivos con hover real (en táctil no hay hover y el :active basta);
     anulado en reduced-motion. La sombra/glow la sube cada superficie en su
     propio :hover (esta clase solo mueve el plano). */
  @media (hover: hover) and (pointer: fine) {
    .lift { transition: transform .2s ease, box-shadow .2s ease; }
    .lift:hover { transform: translateY(-2px); }
    .lift:active { transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .lift { transition: none; }
    .lift:hover, .lift:active { transform: none; }
  }

  /* Scrim canónico: oscurece + desenfaga la página de fondo (capa ÚNICA de
     blur). `.modal-scrim` comparte la misma definición (los modales ya la
     usan); los scrims artesanales de Tier 2 migran a `.scrim`. */
  .scrim, .modal-scrim {
    background: rgba(4, 6, 9, 0.62);
    backdrop-filter: blur(10px) saturate(140%);
    -webkit-backdrop-filter: blur(10px) saturate(140%);
  }
  @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
    .scrim, .modal-scrim { background: rgba(4, 6, 9, 0.86); }
  }

  /* Honra prefers-reduced-transparency: quien pide menos transparencia recibe
     rellenos casi opacos en todo el material (legibilidad sobre estética). */
  @media (prefers-reduced-transparency: reduce) {
    .glass-panel { background: var(--surface); }
  }
```

- [ ] **Step 2: Quitar la definición vieja y duplicada de `.modal-scrim`**

El bloque `.scrim, .modal-scrim` de arriba sustituye a la regla `.modal-scrim` actual (~líneas 115-119) y a su fallback `@supports` (dentro del bloque ~132-135). Borra esas dos definiciones viejas de `.modal-scrim` para no duplicar (la nueva es idéntica en valores).

- [ ] **Step 3: Verificar build + invariante**

Run: `npm run build`
Expected: OK.
Run: `grep -c "\.modal-scrim" src/index.css`
Expected: solo aparece en la definición compartida nueva (no quedan reglas duplicadas).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): clases componibles glass-panel/spec/lift/scrim"
```

---

## Fase 2 — Utilidades Tailwind glass → tokens

### Task 3: Tokenizar `.glass`, `.glass-strong`, `.glass-hover`

**Files:**
- Modify: `src/index.css` (~líneas 92-105 y 138-144)

- [ ] **Step 1: Reescribir `.glass` y `.glass-strong` con tokens**

Sustituir el cuerpo de `.glass` (mantén el comentario existente arriba):

```css
  .glass {
    background-color: var(--mat-fill-1);
    border: 1px solid var(--line);
    box-shadow: var(--edge);
    backdrop-filter: blur(var(--mat-blur-1)) saturate(var(--mat-sat));
    -webkit-backdrop-filter: blur(var(--mat-blur-1)) saturate(var(--mat-sat));
  }
  .glass-strong {
    background-color: var(--mat-fill-3);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-1), var(--edge);
    backdrop-filter: blur(var(--mat-blur-2)) saturate(var(--mat-sat));
    -webkit-backdrop-filter: blur(var(--mat-blur-2)) saturate(var(--mat-sat));
  }
```

El fallback `@supports` existente (~108-111) ya pone `.glass`/`.glass-strong` a fondo sólido — déjalo, sigue siendo correcto.

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario, `vercel dev`):** las superficies que usan `.glass`/`.glass-strong` deben verse igual o ligeramente más nítidas (blur 18→14 en controles). Sin roturas.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor(ui): .glass/.glass-strong consumen tokens de material"
```

---

### Task 4: `.modal-panel-glass` → panel sin blur propio (perf) + rim

**Files:**
- Modify: `src/index.css` (~líneas 124-131 y su `@supports` ~132-135)

- [ ] **Step 1: Reescribir `.modal-panel-glass`**

Los modales SIEMPRE van dentro de un `.modal-scrim` (ver `HowToPlayModal.jsx:36-37` y el resto). Por tanto el panel **suelta su `backdrop-filter`** (el scrim ya desenfocó) y gana rim especular:

```css
  /* Panel de modal: material translúcido SOBRE el scrim (sin blur propio: el
     scrim ya desenfocó la página → no anidamos backdrop-filter). Rim especular
     para el acabado premium. Solo material; cada modal conserva su layout. */
  .modal-panel-glass {
    position: relative;               /* ancla el ::before del rim (.spec) */
    background: color-mix(in oklab, var(--surface) 86%, transparent);
    border: 1px solid var(--line-strong);
    border-radius: 18px;
    box-shadow: var(--elev-3), var(--edge);
  }
  .modal-panel-glass::before {        /* rim especular (réplica de .spec) */
    content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
    background: linear-gradient(135deg,
      rgba(255,255,255,var(--spec)),
      rgba(255,255,255,calc(var(--spec) * .12)) 32%,
      transparent 56%,
      rgba(255,255,255,calc(var(--spec) * .28)));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    pointer-events: none;
  }
  @supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
    .modal-panel-glass { background: var(--surface); }
  }
```

(El `@supports` viejo de `.modal-panel-glass` se reemplaza por este; borra el duplicado.)

> **Nota de apilamiento:** algunos modales ya tienen `overflow-hidden` en el panel; el `::before` con `inset:0` queda dentro del radio. Si algún panel recorta el rim de forma rara, ese modal puede usar `.spec` en un wrapper interno; no se espera necesario.

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** abrir VARIOS modales (Cómo se juega, Puntuación, Ranking, Mis stats, Garaje, Perfil, Nickname, Login). Cada uno: fondo de la página desenfocado (scrim), panel translúcido con **canto brillante arriba-izquierda** (rim). El texto se lee con contraste AA. En móvil el scroll del modal va fluido (ahora hay UNA capa de blur, no dos).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "perf(ui): modal-panel-glass sin blur anidado + rim especular"
```

---

## Fase 3 — `.cdd-*` controles y overlays → tokens

### Task 5: Controles del header (iconbtn, statuspill, helpchip)

**Files:**
- Modify: `src/index.css` (`.cdd-iconbtn` ~311-323, `.cdd-statuspill` ~330-352, `.cdd-helpchip` ~397-404)

- [ ] **Step 1: Migrar a los tokens de control**

En las tres reglas, sustituir las declaraciones de cristal por los tokens nuevos (mismo aspecto, valores unificados):
- `background: var(--glass-fill)` → `background: var(--mat-fill-1)`
- `box-shadow: var(--glass-edge)` → `box-shadow: var(--edge)`
- `backdrop-filter: blur(var(--glass-blur)) saturate(160%)` → `backdrop-filter: blur(var(--mat-blur-1)) saturate(var(--mat-sat))` (y su `-webkit-`)

En `.cdd-statuspill`, que parte de `blur(var(--glass-blur)) saturate(170%)`, usar igualmente `blur(var(--mat-blur-1)) saturate(var(--mat-sat))`.

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** la barra superior (botones de icono, píldora de racha/ranking, chip "cómo se juega" en primera visita) se ve coherente, cristal sobre el halo del fondo.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor(ui): controles del header sobre tokens de material"
```

---

### Task 6: Campos del formulario (combo, year, steppers, decade)

**Files:**
- Modify: `src/index.css` (`.cdd-combo, .cdd-year` ~605-612; `.cdd-year-steps button` ~662-665; `.cdd-decade` ~674-677)

- [ ] **Step 1: Migrar `.cdd-combo, .cdd-year`**

Sustituir:
- `background: var(--glass-fill)` → `background: var(--mat-fill-1)`
- `box-shadow: var(--glass-edge), 0 2px 10px -6px rgba(0,0,0,.6)` → `box-shadow: var(--edge), 0 2px 10px -6px rgba(0,0,0,.6)`
- `backdrop-filter: blur(var(--glass-blur)) saturate(160%)` → `backdrop-filter: blur(var(--mat-blur-1)) saturate(var(--mat-sat))` (+ `-webkit-`)

> ⚠️ **CRÍTICO — no quitar el `backdrop-filter` del combo/year.** Crea el *stacking context* del que depende el `z-index:40` que pone el listbox de MARCA por encima de MODELO/AÑO (ver comentario en `.cdd-combo.is-open`, ~613-621). Solo cambian los *valores*, no se elimina la propiedad.

- [ ] **Step 2: (Opcional) steppers y décadas a `--surface2`**

`.cdd-year-steps button` y `.cdd-decade` usan `var(--surface2)` opaco; son piezas pequeñas dentro de un campo ya de cristal — déjalas en `--surface2` (no merece añadir blur a botoncitos). Sin cambio.

- [ ] **Step 3: Verificar build + visual (usuario) — el test de apilamiento**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** **abrir el desplegable de MARCA y comprobar que se dibuja POR ENCIMA de los campos MODELO y AÑO** (no por debajo). Enfocar AÑO y ver el overlay de décadas. Este es el test de regresión clave de esta tarea.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "refactor(ui): campos del formulario sobre tokens (stacking preservado)"
```

---

### Task 7: Overlays flotantes (listbox, decades)

**Files:**
- Modify: `src/index.css` (`.cdd-listbox` ~639-647; `.cdd-decades` ~668-673)

- [ ] **Step 1: Migrar a blur de overlay**

En `.cdd-listbox` y `.cdd-decades`, sustituir:
- `box-shadow: …, var(--glass-edge)` → `box-shadow: …, var(--edge)`
- `backdrop-filter: blur(22px) saturate(170%)` → `backdrop-filter: blur(var(--mat-blur-2)) saturate(var(--mat-sat))` (+ `-webkit-`)

El `background: color-mix(in oklab, var(--surface) 78%, transparent)` se mantiene (es un overlay reforzado; legible sobre lo que tape).

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** opciones del desplegable y décadas legibles, cristal reforzado.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "refactor(ui): overlays flotantes sobre tokens de material"
```

---

## Fase 4 — Acristalar opacas + rim hero + 2.º foco (el salto premium)

### Task 8: Segundo foco de luz ambiente

**Files:**
- Modify: `src/index.css` (`.cdd-ambient` ~282-286)

- [ ] **Step 1: Añadir un 3.er radial bajo**

En `.cdd-ambient`, añadir un tercer `radial-gradient` al `background` (menta tenue anclado abajo) para que la mitad inferior tenga algo que refractar:

```css
.cdd-ambient { position: fixed; inset: -8%; pointer-events: none; z-index: 0; opacity: .8;
  background:
    radial-gradient(820px 480px at 20% -6%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%),
    radial-gradient(680px 440px at 84% 4%, color-mix(in oklab, var(--gold) 16%, transparent), transparent 72%),
    /* 2.º foco: halo de menta bajo para dar vida a formulario/historial/pie
       (antes la luz colgaba solo arriba y la mitad inferior se leía plana). */
    radial-gradient(720px 460px at 62% 112%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 68%);
  animation: cddAurora 28s ease-in-out infinite alternate; }
```

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** al hacer scroll hacia el formulario/historial/pie se nota un halo de menta muy sutil abajo (no debe distraer ni reducir contraste del texto). En `prefers-reduced-motion` el drift sigue apagado.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): segundo foco de luz ambiente (mitad inferior)"
```

---

### Task 9: Rim especular en el escenario (stage-frame)

**Files:**
- Modify: `src/index.css` (`.cdd-stage-frame` ~422-431)

- [ ] **Step 1: Tokenizar la elevación y añadir rim (sin blur)**

El marco ya flota (sombra + glow). No lleva `backdrop-filter` (la foto `object-cover` lo cubre) y **no se le añade**. Solo se tokeniza el glow y se añade un `::before` de rim. Como `.cdd-stage-frame` ya usa `::after` (viñeta), el rim va en `::before` (libre):

```css
.cdd-stage-frame::before {
  content: ""; position: absolute; inset: 0; z-index: 6; pointer-events: none;
  border-radius: inherit; padding: 1px;
  /* Rim especular del cristal del escenario (un punto más fuerte: es hero). */
  background: linear-gradient(135deg,
    rgba(255,255,255,calc(var(--spec) * 1.15)),
    rgba(255,255,255,calc(var(--spec) * .14)) 30%,
    transparent 54%,
    rgba(255,255,255,calc(var(--spec) * .3)));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
```

> El `z-index:6` deja el rim entre la foto y el HUD/grain (que están en z 6-7); ajusta a `z-index:5` si choca con la viñeta `::after`. Verifica visualmente.

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** el marco de la foto luce un canto de luz arriba-izquierda; la foto y el HUD (crosshair, barra de progreso) se ven intactos; la viñeta inferior sigue oscureciendo las carrocerías claras.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): rim especular en el escenario del juego"
```

---

### Task 10: Acristalar el EndScreen (card + tiles), sin blur sobre el scrim

**Files:**
- Modify: `src/index.css` (`.cdd-end-card` ~729-731; `.cdd-tab` ~773-775; `.cdd-stat` ~780; `.cdd-grid` ~810-811; `.cdd-next` ~814-815; `.cdd-dist-card` ~787)

- [ ] **Step 1: `.cdd-end-card` → material translúcido + rim (sin blur)**

El card va sobre `.cdd-end-scrim` (que ya desenfoca vía `@supports`, ~727-728). Por tanto: translúcido + rim, **sin** `backdrop-filter`. Sustituir el cuerpo de `.cdd-end-card` (conservando width/max-width/overflow/animation — solo cambia pintura):

```css
.cdd-end-card { position: relative; width: 100%; max-width: 460px; max-height: 100%; overflow-y: auto; overscroll-behavior: contain;
  background: color-mix(in oklab, var(--surface) 84%, transparent);
  border: 1px solid var(--line-strong); border-radius: 20px;
  box-shadow: var(--elev-3), var(--edge); animation: cddRise .5s cubic-bezier(.16,1,.3,1); }
.cdd-end-card::before {        /* rim especular del pico celebratorio */
  content: ""; position: absolute; inset: 0; z-index: 1; border-radius: inherit; padding: 1px;
  background: linear-gradient(135deg,
    rgba(255,255,255,var(--spec)),
    rgba(255,255,255,calc(var(--spec) * .12)) 32%,
    transparent 56%,
    rgba(255,255,255,calc(var(--spec) * .28)));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; }
@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .cdd-end-card { background: var(--bg); }
}
```

> El `.cdd-reveal` (banda de la foto, ~737) tiene `border-radius: 20px 20px 0 0` y va arriba; el rim del card lo respeta porque usa `inset:0` sobre el radio del card. Verifica que la banda de foto no tape el canto superior de forma fea (si lo hace, baja el rim a `z-index:1` ya está, o dale al `.cdd-reveal` un `position:relative; z-index:2`).

- [ ] **Step 2: Tiles internos → material translúcido (sin blur, van sobre el scrim)**

Cambiar `background: var(--surface)` → `background: var(--mat-fill-2)` y añadir `box-shadow: var(--edge)` en: `.cdd-tab`, `.cdd-stat`, `.cdd-grid`, `.cdd-next`, `.cdd-dist-card`. **No** añadir `backdrop-filter` (están sobre el card, que está sobre el scrim). Mantener su `border: 1px solid var(--line)`.

Ejemplo para `.cdd-stat`:
```css
.cdd-stat { background: var(--mat-fill-2); border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; box-shadow: var(--edge); }
```

- [ ] **Step 3: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** terminar una partida (ganar y perder). El modal de fin se ve como **cristal iluminado** (no caja opaca): card translúcido con rim, tiles (FICHA/COMPARTIR, stats, cuadrícula, cuenta atrás, distribución) con material coherente. El verdicto de victoria sigue en **oro**, las acciones en menta. Texto AA. En móvil, scroll fluido (sin blur anidado: scrim desenfoca, card no).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): EndScreen acristalado (material + rim, sin blur anidado)"
```

---

## Fase 5 — Tier 2 (secundarias de usuario)

### Task 11: CarImage — scrim del lightbox + badges

**Files:**
- Modify: `src/components/CarImage.jsx` (lightbox ~455; badges ~375, 406, 499)

- [ ] **Step 1: Lightbox → `.scrim`**

Línea ~455: el contenedor del lightbox usa `bg-black/90 backdrop-blur-sm`. Sustituir esas dos utilidades por la clase `scrim` (mantener el resto: `fixed inset-0 z-[120] flex items-center justify-center p-4 animate-fade-in`):

```jsx
className="scrim fixed inset-0 z-[120] flex items-center justify-center p-4 animate-fade-in"
```

- [ ] **Step 2: Badges → material de control**

Los badges/botones flotantes sobre la foto (`bg-black/70`, `bg-black/40`, `bg-black/50` + `backdrop-blur-sm`, líneas ~375, 406, 499) se dejan como están salvo unificar el blur: no son cristal de la página sino chips sobre la imagen; **mantener** `backdrop-blur-sm` (capa única sobre la foto, no anidada). Sin cambios obligatorios; opcional armonizar a `bg-black/60`.

- [ ] **Step 3: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** tocar la foto para abrir el lightbox → fondo desenfocado coherente con los modales; cerrar; badges legibles.

- [ ] **Step 4: Commit**

```bash
git add src/components/CarImage.jsx
git commit -m "refactor(ui): lightbox de CarImage usa el scrim unificado"
```

---

### Task 12: Toast → material

**Files:**
- Modify: `src/components/Toast.jsx` (~línea 42)

- [ ] **Step 1: Migrar el contenedor del toast**

Un toast aparece sobre contenido **arbitrario**, así que **debe seguir siendo opaco** (legibilidad) — NO se vuelve translúcido. Solo se tokeniza el desenfoque y se añade el canto de luz premium. Mantener `bg-bg-tertiary/95`, cambiar `backdrop-blur-md` → `backdrop-blur-glass` (token de 18px de `tailwind.config.js`) y añadir el canto:

```jsx
rounded-xl border ${style.border} bg-bg-tertiary/95 backdrop-blur-glass shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]
```

- [ ] **Step 2: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** disparar un toast (p. ej. copiar resultado, o un error de validación) → píldora de cristal legible, coherente con el sistema.

- [ ] **Step 3: Commit**

```bash
git add src/components/Toast.jsx
git commit -m "refactor(ui): Toast sobre material glass-strong"
```

---

### Task 13: Garage — scrim del drawer + badges

**Files:**
- Modify: `src/components/Garage.jsx` (drawer ~444; badges ~747, 1019, 1031; overlays ~797, 926)

- [ ] **Step 1: Drawer → `.scrim`**

Línea ~444: `bg-black/85 backdrop-blur-sm` (contenedor del drawer) → `scrim` (mantener `fixed inset-0 z-[85] flex items-stretch justify-center`):

```jsx
className="scrim fixed inset-0 z-[85] flex items-stretch justify-center"
```

- [ ] **Step 2: Overlays internos de cromo (líneas ~797, 926)**

`<div className="absolute inset-0 backdrop-blur-sm" />` son veladuras sobre cromos bloqueados; son capa única sobre su tarjeta — **dejar** como están (no son scrims de página). Sin cambios.

- [ ] **Step 3: Badges (~747, 1019, 1031)**

Chips `bg-accent/2x … backdrop-blur-sm` sobre tarjetas: capa única, mantener. Sin cambios obligatorios.

- [ ] **Step 4: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** abrir el Garaje (drawer) → fondo desenfocado coherente; los sub-modales del garaje (ya en `modal-panel-glass`) muestran el rim nuevo; cromos y badges legibles.

- [ ] **Step 5: Commit**

```bash
git add src/components/Garage.jsx
git commit -m "refactor(ui): drawer del Garaje usa el scrim unificado"
```

---

### Task 14: Repesca — header, ResultPanel legacy y scrim de la animación

**Files:**
- Modify: `src/Repesca.jsx` (header ~418; superficies `bg-bg-*` ~381-416)
- Modify: `src/components/ResultPanel.jsx` (~291, 392, 481, 491)
- Modify: `src/components/RepescaDrawAnimation.jsx` (~59)

- [ ] **Step 1: Header de Repesca**

`src/Repesca.jsx` ~418: `border-b border-white/10 bg-[#0d0c0a]/90 backdrop-blur-xl`. Un header sticky tapa contenido que scrollea por debajo → **debe seguir opaco** (NO `.glass` translúcido). Solo se quita el hex suelto (regla: tokens, no hex) y se tokeniza el blur:
```jsx
className="border-b border-border bg-bg-primary/90 backdrop-blur-glass"
```
(`#0d0c0a` era un gris cálido fuera de paleta; `bg-bg-primary/90` lo unifica con Platino manteniendo la opacidad.)

- [ ] **Step 2: ResultPanel legacy → material**

`src/components/ResultPanel.jsx`: el contenedor raíz (~291) usa `bg-bg-tertiary` opaco. Es una **card en el flujo de la página** (no va sobre un scrim) → usar `glass` (cristal con su capa única de blur, refracta el fondo de Repesca). Las sub-cajas `bg-bg-secondary/40|50|60` (~392, 481, 491) → dejar como tintes sutiles internos. Prioridad: que el contenedor raíz deje de ser una losa opaca.

```jsx
// ~291
<div className="rounded-xl border border-border glass p-6 text-center animate-fade-in">
```

- [ ] **Step 3: Scrim de RepescaDrawAnimation**

`src/components/RepescaDrawAnimation.jsx` ~59: `bg-black/85 backdrop-blur-sm` → `scrim` (mantener el resto de clases de layout).

- [ ] **Step 4: Verificar build + visual (usuario)**

Run: `npm run build` → OK.
🔍 **Checkpoint visual (usuario):** entrar al flujo de **Repesca**: header de cristal coherente, animación de sorteo con scrim unificado, panel de resultado ya no opaco. (Si no tienes repesca disponible hoy, basta con que `npm run build` pase; marca para revisar cuando haya repesca.)

- [ ] **Step 5: Commit**

```bash
git add src/Repesca.jsx src/components/ResultPanel.jsx src/components/RepescaDrawAnimation.jsx
git commit -m "refactor(ui): Repesca (header, ResultPanel, animación) sobre material"
```

---

## Fase 6 — Cierre

### Task 15: Limpieza de tokens muertos

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: ¿Quedan consumidores de los `--glass-*` viejos?**

Run:
```bash
grep -nE "var\(--glass-(fill|fill-2|edge|blur)\)" src/index.css
```
- Si NO hay resultados: borrar las definiciones `--glass-fill/-2/-edge/-blur` de `.theme-platino` y `.theme-cobre` (ya unificadas en `--mat-*`/`--edge`).
- Si quedan: migrarlos al token equivalente y volver a correr el grep.

- [ ] **Step 2: Verificar build**

Run: `npm run build` → OK.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "chore(ui): eliminar tokens --glass-* sustituidos por --mat-*"
```

---

### Task 16: Verificación final y PR

**Files:**
- Solo verificación.

- [ ] **Step 1: Invariante de perf (capas de blur ≤ línea base)**

Run el mismo conteo de Task 0:
```bash
grep -rcE "backdrop-filter|backdrop-blur" src/index.css src/components src/Repesca.jsx --include=*.css --include=*.jsx | awk -F: '{s+=$2} END{print "TOTAL backdrop layers:", s}'
```
Expected: total **≤** el de Task 0. Si subió, localizar la capa extra y reconvertirla (panel sobre scrim no debe llevar blur).

- [ ] **Step 2: Suites automáticas (regla CLAUDE.md)**

Run:
```bash
npm run build
npm test
npm run test:security && npm run test:rls && npm run test:attacks
```
Expected: build OK; Vitest verde; suites de seguridad verdes (el CSS no las afecta — es confirmación).

- [ ] **Step 3: Repaso visual integral (usuario, `vercel dev`)**

🔍 Recorrer: juego (fold móvil + desktop), abrir combo (stacking del listbox), ganar/perder (EndScreen), todos los modales, lightbox de la foto, Garaje, Toast, Repesca. Comprobar `prefers-reduced-motion` y `prefers-reduced-transparency` (DevTools → Rendering → Emulate CSS media). Criterio: cero superficies opacas huérfanas en Tier 1+2, rim coherente en hero, mitad inferior con vida, sin regresiones de layout.

- [ ] **Step 4: Abrir el PR (un solo botón de merge — regla 13)**

```bash
git push -u origin claude/liquid-glass-material
gh pr create --base main --head claude/liquid-glass-material \
  --title "feat(ui): sistema de material Cristal Líquido unificado (UI premium)" \
  --body "Refactor de material (opción C del brainstorming). Spec: docs/superpowers/specs/2026-06-15-liquid-glass-material-refactor-design.md. Plan: docs/superpowers/plans/2026-06-15-liquid-glass-material-refactor.md.

Resumen: cristal disperso → sistema unificado de tokens + clases (.glass/.glass-panel/.scrim/.spec/.lift); rim especular en hero; 2.º foco de luz ambiente; EndScreen y opacas acristaladas; menos capas de backdrop-filter (perf). Solo pintura: cero cambios de layout. Admin fuera de alcance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Avisar al usuario: **listo para mergear**.

---

## Notas de auto-revisión (spec ↔ plan)

- **Cobertura del spec:** tokens (Task 1) · clases componibles (Task 2) · perf "un blur por linaje" (Tasks 2,4,10) · stacking del combo preservado (Task 6) · rim especular hero (Tasks 4,9,10) · 2.º foco (Task 8) · acristalar opacas (Task 10) · Tier 2 (Tasks 11-14) · a11y fallback/reduced-transparency/reduced-motion (Tasks 2,8) · guardarraíl paint-only (todo el plan) · invariante de blur (Tasks 0,16). ✔
- **Fuera de alcance respetado:** sin admin, sin luz reactiva (B), sin cambios de layout/paleta/i18n. ✔
- **Nombres consistentes:** `--mat-fill-1/2/3`, `--mat-blur-1/2`, `--mat-sat`, `--edge`, `--spec`, `--elev-1/2/3`, `--glow-accent/-gold`, `--line-strong`; clases `.glass`, `.glass-strong`, `.glass-panel`, `.scrim`, `.spec`, `.lift`. ✔
