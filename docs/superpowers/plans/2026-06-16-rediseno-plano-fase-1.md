# Rediseño plano (v0) — Fase 1 · Plan de implementación

> **Para ejecutores agénticos:** SUB-SKILL REQUERIDA: usa
> `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`
> para ejecutar este plan tarea a tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Aplanar la pantalla de juego (subárbol `configurator/` + `CarImage`) al look v0,
retirando el liquid glass y creando primitivas planas reutilizables, **sin tocar la lógica**.

**Architecture:** Enfoque C (híbrido). Se añaden tokens/primitivas planas nuevas (aditivo, no
rompe nada) y se reescriben **en sitio** las propiedades de cristal de las reglas `.cdd-*`
(quitar `backdrop-filter`, glints, sheen, insets `--edge`; poner superficie sólida + borde 1px).
Los componentes conservan sus `className="cdd-*"`; el JSX solo cambia donde la estructura v0
difiere (sin HUD, dots, "último intento", formulario 2-col, chip de resultado).

**Tech Stack:** Vite 8, React 18 (JSX), Tailwind v3, CSS plano en `src/index.css`. Sin TypeScript.

**Verificación (adaptación a este repo):** no es un trabajo con tests unitarios nuevos (es
re-skin visual). La red de seguridad por tarea es **`npm run build` verde** + las suites
existentes **`npm run test:unit` / `test:security` / `test:attacks` / `test:rls`** que deben
seguir pasando porque la lógica no cambia. La **verificación visual** se hace en el **Preview de
Vercel** tras el push (regla 12: el usuario ya no usa `vercel dev` local; no se levantan
servidores locales).

**Rama:** `claude/flat-redesign-phase-1` (ya creada desde `origin/main` @ `b0911a1`).

---

## Receta plana (referencia DRY — la usan todas las tareas)

Tokens del tema (`.theme-platino`, ya existen): `--bg #0d1014` · `--surface #14181e` ·
`--surface2 #1b212a` · `--line rgba(255,255,255,.09)` · `--line-strong rgba(255,255,255,.26)` ·
`--accent #7af0c8` · `--accent-ink #05131d` · `--gold #e8c87a` · `--gold-ink #1a1306` ·
`--bad #e26060` · `--warn #eab44e` · `--cdd-text #eef2f6` · `--cdd-muted #8b95a3`.

**Qué se ELIMINA de cada superficie de la pantalla de juego:**
- `backdrop-filter` / `-webkit-backdrop-filter` (todo blur).
- Gradientes de glint cromático (`radial-gradient(... rgba(150,255,235...))`) y sheen
  (`linear-gradient(180deg, rgba(255,255,255,.07)...)`).
- Insets de canto `var(--edge)` y rims `::before`/`::after` especulares.
- Sombras-glow de acento (`0 0 70px ... var(--accent)`) y elevaciones exageradas `--elev-3`.

**Qué se PONE (recetas):**
- **`surface-flat`**: `background: var(--surface); border: 1px solid var(--line); border-radius: 16px;`
  (sombra opcional muy sutil `box-shadow: 0 1px 2px rgba(0,0,0,.3);`).
- **`well-flat`** (inputs): `background: var(--surface2); border: 1px solid var(--line);
  border-radius: 12px;` foco → `border-color: var(--accent); box-shadow: 0 0 0 3px
  color-mix(in oklab, var(--accent) 22%, transparent);`.
- **`btn-mint`**: `background: var(--accent); color: var(--accent-ink);` sin gradiente ni gloss;
  `:active { transform: scale(.98); }`.
- **`btn-ghost`**: `background: transparent; border: 1px solid color-mix(in oklab, var(--accent)
  55%, var(--line)); color: var(--accent);`.
- **Tonos de celda de intento (v0)**: good → tinte `color-mix(in oklab, var(--accent) 14%,
  var(--surface))` + texto/icono acento; near → tinte `color-mix(in oklab, var(--warn) 14%,
  var(--surface))` + borde discontinuo ámbar + bandera; off → `var(--surface2)` + borde
  `color-mix(in oklab, var(--bad) 28%, var(--line))` + icono `--bad`.

---

## Task 1: Tokens + primitivas planas (aditivo, para fases 2-5)

**Files:**
- Modify: `src/index.css` (añadir un bloque nuevo dentro de `@layer utilities`, tras `.glass-panel` ~línea 199)

Se añaden clases NUEVAS (no se borra ni se toca el cristal existente; los modales lo usan hasta
sus fases). Sirven de design system para las siguientes fases.

- [ ] **Step 1: Añadir las primitivas planas**

En `src/index.css`, justo después del bloque `.glass-panel { ... }` y su `@supports` (~línea 199),
insertar:

```css
  /* ─────────────────────────────────────────────────────────────────────
     Sistema PLANO (rediseño v0) — primitivas reutilizables (Fases 1-5)
     ---------------------------------------------------------------------
     Sustituyen al material "liquid glass" en superficies aplanadas. Sólido +
     borde 1px, sin blur ni glints. Se introducen en la Fase 1 (pantalla de
     juego) y las heredan los modales/páginas en fases posteriores. */
  .surface-flat {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 16px;
  }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 0; cursor: pointer; font-family: var(--font-display);
    font-weight: 700; letter-spacing: .04em;
    border-radius: 12px; transition: background-color .18s, transform .12s, border-color .18s;
  }
  .btn:active:not(:disabled) { transform: scale(.98); }
  .btn--mint { background: var(--accent); color: var(--accent-ink); }
  .btn--mint:hover:not(:disabled) { background: color-mix(in oklab, var(--accent) 90%, #fff); }
  .btn--ghost {
    background: transparent; color: var(--accent);
    border: 1px solid color-mix(in oklab, var(--accent) 55%, var(--line));
  }
  .btn--ghost:hover:not(:disabled) { background: color-mix(in oklab, var(--accent) 10%, transparent); }
  .btn--icon {
    width: 36px; height: 36px; border-radius: 10px; background: transparent;
    color: var(--cdd-muted);
  }
  .btn--icon:hover { background: color-mix(in oklab, var(--cdd-text) 8%, transparent); color: var(--cdd-text); }
  .input-flat {
    width: 100%; background: var(--surface2); color: var(--cdd-text);
    border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 14px; font-family: var(--font-body); font-size: 15px;
    outline: 0; transition: border-color .18s, box-shadow .18s;
  }
  .input-flat::placeholder { color: var(--cdd-muted); }
  .input-flat:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent); }
  /* Chrome de modal PLANO (drop-in para .modal-panel-glass en fases 2-4). NO se
     aplica a ningún modal en la Fase 1; se define aquí para herencia. */
  .modal-panel-flat {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: 18px;
    box-shadow: 0 24px 60px -28px rgba(0,0,0,.85);
  }
  .scrim-flat { background: rgba(4, 6, 9, 0.72); }
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK ("✓ built in …"), sin errores de PostCSS/CSS.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): primitivas planas (btn/input/surface/modal-flat) — base Fase 1"
```

---

## Task 2: Fondo + cabecera planos

**Files:**
- Modify: `src/index.css` (`.cdd-app` ~369, `.cdd-ambient` ~378, `.cdd-header` ~400-413,
  `.cdd-iconbtn` ~425, `.cdd-statuspill` ~442-475)

JSX intacto (el `<div className="cdd-ambient" />` se queda; solo lo ocultamos por CSS).

- [ ] **Step 1: Fondo sólido (desactivar aurora)**

Reemplazar la regla `.cdd-ambient { ... }` (~378-385) por:

```css
/* Fondo plano (rediseño v0): se retira la aurora animada; el fondo es sólido. */
.cdd-ambient { display: none; }
```

Y en `.cdd-app` (~369-374) cambiar `background: var(--bg2);` por `background: var(--bg);`.

- [ ] **Step 2: Cabecera plana (sin blur ni glints)**

Reemplazar el bloque de fondo/sombra de `.cdd-header` (~407-412) — las líneas
`background: color-mix(...); border: ...; box-shadow: var(--edge)...; backdrop-filter...;` — por:

```css
  margin-bottom: 14px; padding: 9px 12px; border-radius: 14px;
  background: var(--bg);
  border: 0; border-bottom: 1px solid var(--line);
  box-shadow: none;
```

(Se conserva `position: sticky; top: 0; z-index: 40;` y `display/align/justify`.)

- [ ] **Step 3: Iconos y píldora — quitar glow de oro innecesario, mantener color**

`.cdd-iconbtn` ya es glyph-libre y plano; añadir hover-bg sutil estilo v0. Sustituir
`.cdd-iconbtn:hover { color: var(--cdd-text); }` (~434) por:

```css
.cdd-iconbtn:hover { color: var(--cdd-text); background: color-mix(in oklab, var(--cdd-text) 8%, transparent); border-radius: 10px; }
```

La píldora (`.cdd-statuspill`) ya es glyph-libre y plana (sin caja). Mantener tal cual: racha en
oro (`--gold`), puesto en menta. Quitar SOLO el `text-shadow` del glow de racha para un look más
seco (línea ~457): cambiar
`.cdd-statuspill .seg-streak b { color: var(--gold); text-shadow: 0 0 12px var(--gold-glow); }`
por
`.cdd-statuspill .seg-streak b { color: var(--gold); }`.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): fondo y cabecera planos (sin aurora ni cristal sticky)"
```

---

## Task 3: Escenario/foto plano + retirar HUD de cámara

**Files:**
- Modify: `src/components/configurator/ZoomStage.jsx` (quitar `hud`)
- Modify: `src/index.css` (`.cdd-stage-frame` ~523-556, `.cdd-hud*`/`.cdd-grain` ~568-575)

Decisión ①: foto limpia, sin crosshair ni grano. `StageHud.jsx` NO se borra (lo usa el admin);
solo se deja de montar en el juego.

- [ ] **Step 1: Dejar de montar el HUD en el juego**

En `src/components/configurator/ZoomStage.jsx`, eliminar la prop `hud` del `<CarImage>` y el
import de `StageHud`:

```jsx
// quitar: import StageHud from "./StageHud";
// y en el JSX, quitar la línea: hud={<StageHud revealed={revealed} />}
```

Resultado del `<CarImage>` (sin `hud`):

```jsx
      <CarImage
        configurator
        bottomBar={progress}
        src={car?.img ?? null}
        blurData={car?.blurData ?? null}
        zoom={zoom}
        hintIndex={hintIndex}
        totalHints={totalHints}
        status={status}
        showHintLabel={false}
        blurred={blurred}
        overlay={overlay}
        onRevealLoad={onRevealLoad}
      />
```

- [ ] **Step 2: Marco del escenario plano**

Reemplazar `.cdd-stage-frame { ... }` (~523-531) por:

```css
.cdd-stage-frame {
  position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden;
  border-radius: 18px; border: 1px solid var(--line-strong);
  background: var(--surface);
}
```

Eliminar por completo las reglas `.cdd-stage-frame::before { ... }` (~535-549, fringe cromático) y
`.cdd-stage-frame::after { ... }` (~552-556, viñeta) **— excepto** que la viñeta inferior protege
el contraste de la barra de progreso; sustituir el `::after` por una versión sin glass:

```css
/* Viñeta inferior sutil para que la barra de progreso lea sobre carrocerías claras. */
.cdd-stage-frame::after {
  content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(to top, rgba(0,0,0,.4) 0%, transparent 24%);
}
```

- [ ] **Step 3: Neutralizar HUD/grano (por si CarImage los referenciara)**

Como el HUD ya no se monta, las reglas `.cdd-hud`, `.cdd-hud-tl` y `.cdd-grain` (~568-575) quedan
sin uso en el juego. No se borran (las usa la sala de pruebas del admin vía StageHud). Sin cambios.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK. (El import eliminado de StageHud no deja referencias colgando.)

- [ ] **Step 5: Commit**

```bash
git add src/components/configurator/ZoomStage.jsx src/index.css
git commit -m "feat(ui): escenario plano + foto limpia sin HUD de cámara"
```

---

## Task 4: Barra de progreso → dots v0 (con urgencia)

**Files:**
- Modify: `src/components/configurator/AttemptProgress.jsx` (marcar el segmento "actual")
- Modify: `src/index.css` (`.cdd-progress*` ~585-596)

Decisión: dots estilo v0 conservando la urgencia (actual menta; ámbar a falta de 2; rojo
pulsante en el último).

- [ ] **Step 1: Marcar usado / actual / restante en el JSX**

En `src/components/configurator/AttemptProgress.jsx`, sustituir el `.map` de segmentos (~29-31) por
uno que distinga el segmento actual (`i === attempts`):

```jsx
        {Array.from({ length: maxAttempts }, (_, i) => {
          const cls =
            i < attempts ? "cdd-progress-seg spent"
            : i === attempts ? "cdd-progress-seg current"
            : "cdd-progress-seg";
          return <span key={i} className={cls} />;
        })}
```

- [ ] **Step 2: Estilo de dots plano**

Reemplazar las reglas de progreso (~585-596) por:

```css
.cdd-progress { display: flex; }
.cdd-progress-track { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; }
/* Dots v0: restante = punto pequeño apagado; usado = barra sólida; actual = barra menta. */
.cdd-progress-seg { width: 6px; height: 6px; border-radius: 999px; background: rgba(255,255,255,.28); transition: all .3s; }
.cdd-progress-seg.spent { width: 22px; background: rgba(255,255,255,.6); }
.cdd-progress-seg.current { width: 22px; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
/* Urgencia: a falta de 2 el actual vira a ámbar; en el último, rojo pulsante. */
.cdd-progress.tone-warn .cdd-progress-seg.current { background: var(--warn); box-shadow: 0 0 8px var(--warn); }
.cdd-progress.tone-danger .cdd-progress-seg.current { background: var(--bad); box-shadow: 0 0 8px var(--bad);
  animation: cddPulse 1.1s ease-in-out infinite; }
@keyframes cddPulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src/components/configurator/AttemptProgress.jsx src/index.css
git commit -m "feat(ui): progreso de intentos como dots v0 (conserva urgencia)"
```

---

## Task 5: Celdas de intento planas (estilo v0)

**Files:**
- Modify: `src/index.css` (`.cdd-chip` y tonos ~664-706)

Decisión: celdas planas tinte-por-estado del v0, conservando semántica `partial`+bandera, flecha
de año y fit-text (sin cambios de JSX en `AttemptList.jsx`).

- [ ] **Step 1: Aplanar el chip y los tonos**

Reemplazar las reglas `.cdd-chip { ... }` base (~664-665) y los tonos `.tone-good/.tone-near/
.tone-off` (~681-697) por:

```css
.cdd-chip { display: flex; flex-direction: column; gap: 2px; justify-content: center; align-items: flex-start;
  padding: 6px 12px; border-radius: 10px; min-height: 40px; font-size: 13px; font-weight: 600; line-height: 1.15; min-width: 0;
  border: 1px solid var(--line); background: var(--surface2); }
/* Acierto: tinte menta plano + texto/icono acento (v0). */
.tone-good { background: color-mix(in oklab, var(--accent) 14%, var(--surface)); color: var(--cdd-text);
  border-color: color-mix(in oklab, var(--accent) 38%, var(--line)); box-shadow: none; }
.tone-good .cdd-chip-sub { color: var(--accent); opacity: .8; }
.tone-good .cdd-chip-mark { color: var(--accent); }
/* Mismo país (partial): tinte ámbar + borde discontinuo + bandera. */
.tone-near { background: color-mix(in oklab, var(--warn) 12%, var(--surface)); color: var(--cdd-text);
  border: 1px dashed color-mix(in oklab, var(--warn) 50%, var(--line)); }
.tone-near .cdd-chip-sub { color: var(--warn); }
.tone-near .cdd-flag { width: 20px; height: 13px; }
/* Fallo: superficie neutra + borde/icono rojo discreto (v0). */
.tone-off { background: var(--surface2); color: var(--cdd-text);
  border: 1px solid color-mix(in oklab, var(--bad) 28%, var(--line)); }
.tone-off .cdd-chip-mark { color: var(--bad-ink); }
.tone-off .cdd-chip-sub { color: var(--bad-sub); }
```

(El `.cdd-chip.is-pending` shimmer ~699-702 y `.cdd-chip.flip` ~705-706 se conservan sin cambios:
ya son neutros/planos.)

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): celdas de intento planas tinte-por-estado (v0)"
```

---

## Task 6: Etiqueta "ÚLTIMO INTENTO" sobre la fila viva

**Files:**
- Modify: `src/components/configurator/Configurator.jsx` (~177-193, bloque `cdd-live-attempt`)
- Modify: `src/index.css` (añadir `.cdd-live-kicker`)

Decisión: kicker "ÚLTIMO INTENTO" estilo v0 encima de la fila viva (entre foto y formulario).

- [ ] **Step 1: Añadir el kicker en el JSX**

En `Configurator.jsx`, dentro del bloque `{dataReady && !ended && (pendingGuess || guesses.length
> 0) && ( ... )}` (~177), añadir el kicker como primer hijo del `<div className="cdd-live-attempt">`:

```jsx
                <div className="cdd-live-attempt" aria-live="polite">
                  <span className="cdd-live-kicker cdd-mono">{t("cdd.lastAttempt") || "Último intento"}</span>
                  {pendingGuess ? (
                    <AttemptRow g={pendingGuess} tolerance={tolerance} pending />
                  ) : (
                    <AttemptRow
                      g={guesses[guesses.length - 1]}
                      tolerance={tolerance}
                      fresh={justRevealedIndex === guesses.length - 1}
                    />
                  )}
                </div>
```

> Nota i18n: la clave `cdd.lastAttempt` **no existe todavía** (verificado en `es.json`). Añadirla
> bajo el namespace `cdd` en ambos locales: `"lastAttempt": "Último intento"` (es) /
> `"lastAttempt": "Last guess"` (en). El fallback `|| "Último intento"` del JSX evita romper
> mientras tanto.

- [ ] **Step 2: Estilo del kicker**

En `src/index.css`, junto a `.cdd-live-attempt` (~641), añadir:

```css
.cdd-live-kicker { display: block; margin-bottom: 6px; font-size: 10px; letter-spacing: .14em;
  color: var(--cdd-muted); }
```

- [ ] **Step 3: Verificar build + i18n**

Run: `npm run build`
Expected: build OK.
Comprobar que la clave `cdd.lastAttempt` resuelve en ambos idiomas (o que el fallback aplica).

- [ ] **Step 4: Commit**

```bash
git add src/components/configurator/Configurator.jsx src/index.css src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "feat(ui): kicker 'Último intento' sobre la fila viva (v0)"
```

---

## Task 7: Formulario plano + Marca/Modelo en 2 columnas

**Files:**
- Modify: `src/components/configurator/GuessForm.jsx` (envolver Marca+Modelo en grid 2-col)
- Modify: `src/index.css` (`.cdd-form` ~717-727, `.cdd-combo/.cdd-year` ~737-756,
  `.cdd-input` ~757-758, `.cdd-listbox` ~772-780, `.cdd-decades` ~803-808, `.cdd-submit` ~814-848)

Decisión ③: Marca y Modelo lado a lado; Año a ancho completo; ADIVINAR pleno. Inputs planos.

- [ ] **Step 1: Panel del formulario plano**

Reemplazar el bloque glass de `.cdd-form` (~717-727) por:

```css
.cdd-form { display: flex; flex-direction: column; gap: 14px;
  padding: 16px; border-radius: 18px;
  background: var(--surface); border: 1px solid var(--line); box-shadow: none; }
```

- [ ] **Step 2: Pozos (combo/año) planos**

Reemplazar `.cdd-combo, .cdd-year { ... }` (~737-745) y el foco (~746-754) por:

```css
.cdd-combo, .cdd-year { position: relative; display: flex; align-items: center;
  background: var(--surface2); border: 1px solid var(--line); border-radius: 12px; transition: .18s; }
.cdd-combo.is-open, .cdd-combo:focus-within, .cdd-year:focus-within {
  border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent);
  z-index: 40; }
```

(Se conservan `.cdd-combo.is-disabled` y `.cdd-combo.is-invalid` ~755-756.)

- [ ] **Step 3: Listbox y décadas planos (sin blur)**

En `.cdd-listbox` (~772-780) quitar `backdrop-filter`/`-webkit-backdrop-filter` y el `var(--edge)`,
dejando fondo sólido:

```css
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: 12px;
  box-shadow: 0 24px 50px -22px rgba(0,0,0,.85);
```

En `.cdd-decades` (~803-808) igual — quitar blur y `--edge`:

```css
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 18px 40px -18px rgba(0,0,0,.8);
```

- [ ] **Step 4: Botón ADIVINAR plano (menta sólida)**

Reemplazar `.cdd-submit { ... }` (~814-821) por una versión plana (sin gradiente/gloss):

```css
.cdd-submit { width: 100%; height: 56px; border: 0; border-radius: 12px; cursor: pointer;
  background: var(--accent); color: var(--accent-ink); font-family: var(--font-display);
  font-weight: 800; font-size: 14px; letter-spacing: .14em; text-transform: uppercase;
  display: flex; align-items: center; justify-content: center; gap: 9px; transition: .18s;
  box-shadow: none; }
.cdd-submit:hover:not(:disabled):not(.is-incomplete) { background: color-mix(in oklab, var(--accent) 90%, #fff); }
.cdd-submit:active:not(:disabled):not(.is-incomplete) { transform: scale(.98); }
```

(Se conservan `.cdd-submit:disabled` ~829, `.cdd-submit.is-incomplete` ~835-841 y
`.cdd-submit--ghost` ~845-848 — ya son planos/sin gloss.)

- [ ] **Step 5: Layout 2 columnas Marca/Modelo en el JSX**

En `GuessForm.jsx`, envolver los dos `<Combo>` (Marca y Modelo, ~213-236) en un grid 2-col y dejar
`<YearField>` + botón a ancho completo. Insertar un wrapper:

```jsx
        <div className="cdd-form-row2">
          <Combo
            label={t("cdd.labelMarca")}
            value={marca}
            onChange={(v) => { setMarca(v); if (!MARCAS.includes(v)) setModelo(""); }}
            onCommit={() => focusSoon(modeloRef)}
            options={availableMarcas}
            placeholder={t("cdd.comboPlaceholder")}
            disabled={formDisabled}
            invalid={marcaInvalida}
            optionFlag={(m) => (marcaPais[m] ? flagImagePath(marcaPais[m]) : null)}
            enterKeyHint="next"
          />
          <Combo
            label={t("cdd.labelModelo")}
            value={modelo}
            onChange={setModelo}
            onCommit={() => focusSoon(anioRef)}
            inputRef={modeloRef}
            options={modelOptions}
            placeholder={marcaValida ? t("cdd.comboPlaceholder") : t("cdd.comboModeloDisabled")}
            disabled={formDisabled || !marcaValida}
            invalid={modeloInvalido}
            enterKeyHint="next"
          />
        </div>
```

(El `<YearField>` y el `<button className="cdd-submit">` quedan FUERA del wrapper, a ancho completo,
como están.)

- [ ] **Step 6: CSS del grid 2-col**

En `src/index.css`, junto a `.cdd-form` (~717), añadir:

```css
.cdd-form-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
```

> Nota: cada `.cdd-combo` crea su propio stacking context (`z-index: 40` al abrir), así que el
> listbox de Marca (columna izda, `left:0; right:0` del combo) se dibuja sobre su columna sin
> tapar Modelo de forma rota. El listbox queda más estrecho (mitad de ancho) — aceptado en la
> decisión ③.

- [ ] **Step 7: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 8: Verificar que la lógica anti-cheat sigue intacta (tests)**

Run: `npm run test:unit`
Expected: PASS (no se tocó lógica; el JSX solo reordena el marcado).

- [ ] **Step 9: Commit**

```bash
git add src/components/configurator/GuessForm.jsx src/index.css
git commit -m "feat(ui): formulario plano + Marca/Modelo en 2 columnas (v0)"
```

---

## Task 8: EndScreen plano (hero + chip oro, contenido rico)

**Files:**
- Modify: `src/index.css` (`.cdd-end-card` ~870-887, `.cdd-reveal*` ~893-905, `.cdd-verdict*`
  ~896-900, tiles `.cdd-tab/.cdd-stat/.cdd-dist*/.cdd-percentile/.cdd-grid/.cdd-next` ~928-976)

Decisión ②: se conserva TODO el contenido (tabs, distribución, percentil, cromo, countdown,
CTA login); solo se aplana el cristal y se mantiene el hero + chip de victoria en oro (ya
existentes). Sin cambios de JSX (la estructura ya es v0-like).

- [ ] **Step 1: Tarjeta del EndScreen plana**

Reemplazar el bloque glass de `.cdd-end-card` (~870-884) por:

```css
.cdd-end-card { position: relative; width: 100%; max-width: 460px; max-height: 100%; overflow-y: auto; overscroll-behavior: contain;
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: 18px;
  box-shadow: 0 30px 70px -28px rgba(0,0,0,.9);
  animation: cddRise .5s cubic-bezier(.16,1,.3,1); }
```

(El `@supports` de fallback ~885-887 puede quedarse; ya no hay blur que degradar, pero no estorba.
Opcional: eliminarlo.)

- [ ] **Step 2: Hero/reveal sólido**

`.cdd-reveal` (~893): cambiar `background: var(--surface);` se mantiene; el degradado
`.cdd-reveal-grad` (~894) ya funde a `var(--bg)` — cambiarlo a `var(--surface)` para casar con la
tarjeta plana:

```css
.cdd-reveal .cdd-reveal-grad { position: absolute; inset: 0; background: linear-gradient(to top, var(--surface) 4%, transparent 60%); z-index: 2; }
```

- [ ] **Step 3: Chip de veredicto estilo v0 (oro en victoria)**

`.cdd-verdict.win` (~899) ya es oro — mantener. Ajustar el chip a la píldora v0 (punto + texto):
reemplazar `.cdd-verdict { ... }` (~896) por:

```css
.cdd-verdict { font-size: 10px; align-self: flex-start; padding: 5px 10px; border-radius: 999px;
  display: inline-flex; align-items: center; gap: 6px; letter-spacing: .08em; }
```

(`.cdd-verdict.win` y `.cdd-verdict.lose` se conservan; el oro de victoria es la marca premium.)

- [ ] **Step 4: Tiles internos planos (quitar `--edge` + `--mat-fill`)**

En estas reglas, sustituir `background: var(--mat-fill-2);` por `background: var(--surface2);` y
quitar `box-shadow: var(--edge);`:
`.cdd-tab` (~929-930), `.cdd-stat` (~936), `.cdd-dist-card` (~943), `.cdd-grid` (~966-967),
`.cdd-next` (~970-971). Ejemplo para `.cdd-stat`:

```css
.cdd-stat { background: var(--surface2); border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; }
```

Aplicar el mismo patrón (fondo `--surface2`, sin `--edge`) a `.cdd-tab`, `.cdd-dist-card`,
`.cdd-grid` y `.cdd-next`. `.cdd-percentile` (~957-960) y `.cdd-unlock` (~913-917) ya son tintes
planos — sin cambios.

- [ ] **Step 5: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 6: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): EndScreen plano (hero + chip oro) conservando datos ricos"
```

---

## Task 9: Footer, PhotoPeek y verificación de desktop

**Files:**
- Modify: `src/index.css` (`.cdd-peek` ~607-611; revisar `.cdd-helpchip` ~498-505; desktop ~1066-1076)

Decisión ④: desktop dos columnas se conserva (solo re-skin de superficies, ya cubierto por las
tareas anteriores que aplanan los componentes compartidos).

- [ ] **Step 1: PhotoPeek plano**

`.cdd-peek` (~607-611): ya es bastante plano; quitar solo la sombra exagerada. Sustituir su
`box-shadow` por:

```css
  box-shadow: 0 12px 30px -14px rgba(0,0,0,.8);
```

- [ ] **Step 2: Chip de ayuda de onboarding plano (si se usa)**

`.cdd-helpchip` (~498-505) usa `--mat-fill-1` + blur + `--edge`. Aplanarlo:

```css
.cdd-helpchip { position: relative; display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 999px;
  background: var(--surface2); border: 1px solid var(--line); box-shadow: none;
  color: var(--cdd-muted); font-family: var(--font-body); font-size: 12.5px;
  cursor: pointer; transition: .18s; }
```

(`.cdd-helpchip:hover`/`.pulse` ~505-508 se conservan; usan acento, no cristal.)

- [ ] **Step 3: Verificar desktop (visual, en Preview)**

No hay cambios de layout en desktop (`@media min-width:1000px` ~1066-1076 solo define grid y
tamaños). Las superficies ya se aplanaron en tareas previas. Se verifica visualmente en el Preview
de Vercel tras el push (Task 10).

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): PhotoPeek y help-chip planos (cierre de superficies de juego)"
```

---

## Task 10: Verificación completa, push y PR

**Files:** ninguno (solo verificación + git).

- [ ] **Step 1: Build de producción**

Run: `npm run build`
Expected: "✓ built in …" sin errores ni warnings nuevos.

- [ ] **Step 2: Suite unitaria**

Run: `npm run test:unit`
Expected: todos los tests PASS (la lógica no cambió).

- [ ] **Step 3: Suites de seguridad/RLS**

Run: `npm run test:security && npm run test:attacks && npm run test:rls`
Expected: PASS (no se tocó server/RLS/anti-leak). Si alguna requiere envs y no están disponibles
en el entorno local, anotarlo y dejar que corran en CI/Preview.

- [ ] **Step 4: Comprobaciones de reglas críticas (manual, grep)**

Run: `grep -n "u0300-u036f\|\\\\u0300" src/components/configurator/Combo.jsx`
Expected: la regex de diacríticos sigue escapada (`[̀-ͯ]`) — regla 14 (sin mojibake).
Confirmar también que `CarImage.jsx`/`middleware.js` no se tocaron (regla 6, srcset coherente):
Run: `git diff --name-only origin/main...HEAD | grep -E "CarImage|middleware" || echo "(intactos)"`
Expected: `(intactos)`.

- [ ] **Step 5: Push de la rama**

```bash
git push -u origin claude/flat-redesign-phase-1
```

- [ ] **Step 6: Abrir el PR (un solo botón de merge — regla 13)**

```bash
gh pr create --base main --head claude/flat-redesign-phase-1 \
  --title "feat(ui): rediseño plano v0 — Fase 1 (pantalla de juego)" \
  --body "$(cat <<'EOF'
Aplana la pantalla de juego al look v0 (fuera liquid glass), creando las primitivas planas
(`.btn`/`.input`/`.surface`/`.modal-panel-flat`) que heredarán las fases 2-5. Sin cambios de
lógica (anti-cheat, zoom por-coche, anti-leak regla 5, i18n, a11y intactos).

Decisiones: foto sin HUD · EndScreen rico con estilo plano · Marca/Modelo en 2 columnas · desktop
en dos columnas. Modales/Repesca/Privacidad siguen con cristal hasta sus fases.

Spec: `docs/superpowers/specs/2026-06-16-rediseno-plano-v0-fase-1-design.md`
Plan: `docs/superpowers/plans/2026-06-16-rediseno-plano-fase-1.md`

Verificado: `npm run build` + `test:unit` + `test:security/attacks/rls` verdes.
Revisión visual: Preview de Vercel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Verificación visual en el Preview de Vercel**

Tras el push, Vercel despliega un Preview automático. Revisar en esa URL (móvil + desktop):
partida completa (jugar → fallo → mismo país → acierto/derrota → EndScreen), estados de error del
formulario (tap con campos incompletos → shake + toast), derrota anónima (foto difuminada),
historial de intentos, countdown del EndScreen. Avisar al usuario: **"Fase 1 lista para mergear"**.

---

## Self-review (cobertura del spec)

- Sistema de diseño plano (tokens + primitivas) → **Task 1** ✅
- Header con todos los accesos, plano → **Task 2** ✅
- Escenario/CarImage plano + sin HUD (decisión ①) → **Task 3** ✅
- AttemptProgress dots con urgencia → **Task 4** ✅
- AttemptList celdas planas con semántica preservada → **Task 5** ✅
- "Último intento" etiquetado (decisión v0) → **Task 6** ✅
- GuessForm plano + 2-col (decisión ③) + Combo/YearField → **Task 7** ✅
- EndScreen rico + plano + hero/oro (decisión ②) → **Task 8** ✅
- Footer/PhotoPeek/desktop 2-col (decisión ④) → **Task 9** ✅
- Build + tests + reglas críticas + PR → **Task 10** ✅
- Modales/`--mat-*`/`.glass*` NO se borran (fuera de alcance) → respetado en todas las tareas ✅
