# Feedback de intentos: 3 estados claros + filas en una línea — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el feedback de cada intento del juego diario distinga a la primera acierto / mismo país / fallo (doble codificación color + icono, fallo en rojo) y que cada chip quepa en una sola línea sin recortar texto.

**Architecture:** Una fórmula pura de auto-ajuste de tamaño (`lib/fitText.js`) la envuelve un hook con `ResizeObserver` (`hooks/useFitText.js`) que usa el `Chip` de `AttemptList.jsx`. El color/iconos del fallo se resuelven en CSS reutilizando el rojo de los pips (`#e26060`) como token `--bad`. Solo se toca el juego diario (`configurator/`); Repesca legacy queda intacta.

**Tech Stack:** React 18 (JSX), Vite, Tailwind + CSS propio (`src/index.css`), Vitest, i18n propio (`useT`), iconos SVG de `configurator/icons.jsx`.

**Spec:** `docs/superpowers/specs/2026-06-12-feedback-chips-3-estados-y-una-linea-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---------|-----------------|--------|
| `src/lib/fitText.js` | Fórmula pura: medidas → tamaño de fuente (clamp). Sin DOM. | Crear |
| `src/lib/fitText.test.js` | Test unitario de la fórmula (vitest). | Crear |
| `src/hooks/useFitText.js` | Hook: mide el span y aplica el tamaño; recalcula con `ResizeObserver`. | Crear |
| `src/i18n/locales/es.json` | Claves `srCorrect`/`srWrong` (estado para lectores de pantalla). | Modificar |
| `src/i18n/locales/en.json` | Ídem en inglés. | Modificar |
| `src/index.css` | Tokens `--bad*`; `.tone-off` rojo; `.cdd-chip-text` una línea; colores de marca. | Modificar |
| `src/components/configurator/AttemptList.jsx` | Iconos ✓/✕, mapeo de tonos, `useFitText`, sr-only de estado. | Modificar |

**No tocar:** `Combo.jsx`, `YearField.jsx`, `GuessForm.jsx` (configurator), `Header.jsx`, `StageHud.jsx`, `Repesca.jsx`, ni `components/GuessLog.jsx`/`GuessRow.jsx` (legacy en uso por Repesca).

---

## Task 1: Fórmula pura de auto-ajuste (`lib/fitText.js`)

**Files:**
- Create: `src/lib/fitText.js`
- Test: `src/lib/fitText.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `src/lib/fitText.test.js`:

```js
import { describe, it, expect } from "vitest";
import { fitFontSize } from "./fitText";

describe("fitFontSize", () => {
  it("deja el tamaño base cuando el texto ya cabe", () => {
    expect(fitFontSize({ scrollWidth: 80, clientWidth: 100, base: 12.5, min: 10 })).toBe(12.5);
  });

  it("no encoge por debajo del suelo (min) aunque el desborde sea grande", () => {
    // 100/300 → ideal muy por debajo de min → se acota a min.
    expect(fitFontSize({ scrollWidth: 300, clientWidth: 100, base: 12.5, min: 10 })).toBe(10);
  });

  it("interpola entre min y base para un desborde moderado", () => {
    // 12 * (110/120) * 0.97 = 10.67 → floor 0.1 → 10.6
    expect(fitFontSize({ scrollWidth: 120, clientWidth: 110, base: 12, min: 9 })).toBe(10.6);
  });

  it("devuelve el base si las medidas no son válidas (primer paint)", () => {
    expect(fitFontSize({ scrollWidth: 200, clientWidth: 0, base: 12.5, min: 10 })).toBe(12.5);
    expect(fitFontSize({ scrollWidth: 0, clientWidth: 100, base: 12.5, min: 10 })).toBe(12.5);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npx vitest run src/lib/fitText.test.js`
Expected: FAIL — `fitFontSize` no existe / no se puede importar desde `./fitText`.

- [ ] **Step 3: Implementación mínima**

Create `src/lib/fitText.js`:

```js
// src/lib/fitText.js
// Cálculo PURO del tamaño de fuente para que un texto de UNA línea quepa en su
// contenedor (shrink-to-fit). Sin DOM: recibe medidas ya tomadas. Lo alimenta el
// hook useFitText con el scrollWidth/clientWidth reales del span de texto.
//
// O(1), sin bucle de "baja 0.5px y vuelve a medir": una regla de tres sobre el
// ancho natural del texto da el tamaño exacto al que ocuparía justo el ancho
// disponible. El factor de seguridad deja un pelo de holgura para que ningún
// glifo se recorte por redondeos sub-pixel.

const SAFETY = 0.97;

export function fitFontSize({ scrollWidth, clientWidth, base, min }) {
  // Primer paint antes del layout (medidas a 0): no encogemos.
  if (!(clientWidth > 0) || !(scrollWidth > 0)) return base;
  // Ya cabe al tamaño base.
  if (scrollWidth <= clientWidth) return base;
  // Tamaño al que el texto mediría justo el ancho disponible.
  const ideal = base * (clientWidth / scrollWidth) * SAFETY;
  // Acotado a [min, base] y redondeado a 0.1px hacia abajo (estable, nunca por
  // encima del ideal calculado).
  const clamped = Math.max(min, Math.min(base, ideal));
  return Math.floor(clamped * 10) / 10;
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npx vitest run src/lib/fitText.test.js`
Expected: PASS — 4 tests verdes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fitText.js src/lib/fitText.test.js
git commit -m "feat(fit): fórmula pura de shrink-to-fit para texto de una línea"
```

---

## Task 2: Hook de auto-ajuste (`hooks/useFitText.js`)

**Files:**
- Create: `src/hooks/useFitText.js`

No lleva test unitario (depende de DOM + `ResizeObserver`); se valida visualmente con el resto en la verificación final.

- [ ] **Step 1: Crear el hook**

Create `src/hooks/useFitText.js`:

```js
// src/hooks/useFitText.js
// Auto-ajuste del tamaño de fuente para texto de UNA línea (shrink-to-fit).
// Devuelve un ref para el <span> de texto: mide su ancho natural (scrollWidth con
// white-space:nowrap) frente al disponible (clientWidth) y, si no cabe, le baja
// el tamaño con la fórmula pura de lib/fitText. El tamaño "base" se LEE del CSS
// (no se pasa), así el historial usa su 12.5px y la 'fila viva' su tamaño propio
// sin tocar el hook. Recalcula al cambiar el valor o el ancho del contenedor
// (ResizeObserver: rotación, resize, salto móvil↔desktop del grid).

import { useLayoutEffect, useRef } from "react";
import { fitFontSize } from "../lib/fitText";

export function useFitText(value, { min = 10 } = {}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // Quitamos el override para medir al tamaño que dicta el CSS (= base).
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize) || 12.5;
      const next = fitFontSize({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        base,
        min,
      });
      // Solo fijamos inline si hay que encoger; si cabe, deja mandar al CSS.
      if (next < base) el.style.fontSize = next + "px";
    };

    measure();

    // El ancho lo manda el chip (padre del span). Observar su tamaño NO crea
    // bucle de ResizeObserver: cambiar el font-size del hijo no altera el tamaño
    // del chip (es celda de grid con ancho fijo + min-height), solo el texto.
    const parent = el.parentElement;
    if (typeof ResizeObserver === "undefined" || !parent) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [value, min]);

  return ref;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useFitText.js
git commit -m "feat(fit): hook useFitText (ResizeObserver) que aplica el shrink-to-fit"
```

---

## Task 3: Claves i18n del estado para lectores de pantalla

**Files:**
- Modify: `src/i18n/locales/es.json:109`
- Modify: `src/i18n/locales/en.json:109`

- [ ] **Step 1: Añadir claves en español**

En `src/i18n/locales/es.json`, dentro del bloque `"cdd"`, sustituir la línea de `sameCountry` por estas tres (añade dos claves justo debajo):

Buscar:
```json
    "sameCountry": "MISMO PAÍS",
```
Reemplazar por:
```json
    "sameCountry": "MISMO PAÍS",
    "srCorrect": "correcto",
    "srWrong": "incorrecto",
```

- [ ] **Step 2: Añadir claves en inglés**

En `src/i18n/locales/en.json`, dentro del bloque `"cdd"`:

Buscar:
```json
    "sameCountry": "SAME COUNTRY",
```
Reemplazar por:
```json
    "sameCountry": "SAME COUNTRY",
    "srCorrect": "correct",
    "srWrong": "wrong",
```

- [ ] **Step 3: Verificar que ambos JSON siguen siendo válidos**

Run: `node -e "require('./src/i18n/locales/es.json'); require('./src/i18n/locales/en.json'); console.log('JSON OK')"`
Expected: imprime `JSON OK` (sin errores de parseo por comas).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "i18n(cdd): claves srCorrect/srWrong para el estado del chip (a11y)"
```

---

## Task 4: CSS — tokens de fallo, tono rojo y texto en una línea

**Files:**
- Modify: `src/index.css` (tokens en `.theme-platino` ~238 y `.theme-cobre` ~255; `.cdd-chip-text` ~523; `.tone-*` ~527-533)

- [ ] **Step 1: Añadir tokens `--bad*` en el tema Platino**

En `src/index.css`, buscar (dentro de `.theme-platino`):
```css
  --accent-ink: #05131d; --good-ink: #05131d;
```
Reemplazar por:
```css
  --accent-ink: #05131d; --good-ink: #05131d;
  /* Fallo: rojo sobrio reutilizado del pip gastado (#e26060). Tinte oscuro para
     el chip, versión clara para el ✕/flecha (contraste sobre el chip rojo). */
  --bad: #e26060; --bad-ink: #f0a39c; --bad-sub: #d98b83;
```

- [ ] **Step 2: Añadir tokens `--bad*` en el tema Cobre**

En `src/index.css`, buscar (dentro de `.theme-cobre`):
```css
  --accent-ink: #1a0d04; --good-ink: #1a0d04;
```
Reemplazar por:
```css
  --accent-ink: #1a0d04; --good-ink: #1a0d04;
  /* Mismo rojo de fallo que Platino (coherente con el pip gastado). */
  --bad: #e26060; --bad-ink: #f0a39c; --bad-sub: #d98b83;
```

- [ ] **Step 3: `.cdd-chip-text` a una sola línea (quitar el line-clamp de 2)**

En `src/index.css`, buscar:
```css
.cdd-chip-text { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.18; overflow-wrap: anywhere; }
```
Reemplazar por:
```css
/* Una sola línea: el nombre largo lo encoge useFitText (no parte en 2). flex:1
   para que clientWidth sea el ancho disponible que mide el hook. */
.cdd-chip-text { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; line-height: 1.18; }
```

- [ ] **Step 4: Color del ✓ en el acierto y bandera reforzada en "mismo país"**

En `src/index.css`, buscar:
```css
.tone-good .cdd-chip-sub { color: var(--accent-ink); opacity: .7; }
```
Reemplazar por:
```css
.tone-good .cdd-chip-sub { color: var(--accent-ink); opacity: .7; }
.tone-good .cdd-chip-mark { color: var(--accent-ink); }
```

Y buscar:
```css
.tone-near .cdd-chip-sub { color: var(--accent); }
```
Reemplazar por:
```css
.tone-near .cdd-chip-sub { color: var(--accent); }
/* Refuerzo del estado "mismo país": la bandera manda un punto más que en el
   resto de chips (es el icono que explica el "casi"). */
.tone-near .cdd-flag { width: 20px; height: 13px; }
```

- [ ] **Step 5: `.tone-off` de gris apagado a rojo sobrio con texto blanco**

En `src/index.css`, buscar:
```css
.tone-off { background: linear-gradient(180deg, var(--surface2), var(--surface)); color: var(--cdd-muted);
  border: 1px solid var(--line); box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
```
Reemplazar por:
```css
/* Fallo: rojo apagado + texto BLANCO (no muted). El paso de cdd-muted a cdd-text
   es lo que convierte el chip de "casilla inactiva" en "esto está mal". */
.tone-off { background: color-mix(in oklab, var(--bad) 15%, var(--surface)); color: var(--cdd-text);
  border: 1px solid color-mix(in oklab, var(--bad) 50%, var(--line)); }
.tone-off .cdd-chip-mark { color: var(--bad-ink); }
.tone-off .cdd-chip-sub { color: var(--bad-sub); }
```

- [ ] **Step 6: Commit**

```bash
git add src/index.css
git commit -m "style(chips): fallo en rojo (token --bad), ✓ en acierto, chip en una línea"
```

---

## Task 5: `AttemptList.jsx` — iconos ✓/✕, tonos y auto-ajuste

**Files:**
- Modify: `src/components/configurator/AttemptList.jsx` (reescritura completa del archivo)

- [ ] **Step 1: Reemplazar el contenido completo de `AttemptList.jsx`**

Sustituir TODO el archivo `src/components/configurator/AttemptList.jsx` por:

```jsx
// src/components/configurator/AttemptList.jsx
// Intentos como filas de chips (marca / modelo / año). Mapea el feedback REAL del
// servidor (status correct/partial/wrong + dirección de año) al lenguaje de tonos
// del diseño: good (acierto) / near (mismo país) / off (fallo, rojo).
//   · marca:  correct→good+✓ · partial (misma nacionalidad)→near+bandera · wrong→off+✕
//   · modelo: correct→good+✓ · wrong→off+✕
//   · año:    correct→good+✓ (±tol) · wrong→off(rojo) + flecha ↑/↓ + MÁS NUEVO/ANTIGUO
// Doble codificación color+icono (accesible). El nombre va a UNA línea con
// auto-ajuste (useFitText): los nombres largos encogen en vez de partir en dos.
// Incluye la fila "pendiente" (shimmer neutro) y el flip-reveal por celda.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";

// Stagger del flip por celda (efecto "carta volteándose").
const FLIP_STAGGER_MS = 130;

// Icono de estado para marca/modelo: ✓ acierto, ✕ fallo. (partial usa bandera,
// no icono; por eso devuelve null en cualquier otro status.)
function statusMark(status) {
  if (status === "correct") return <Icon d={I.check} size={14} />;
  if (status === "wrong") return <Icon d={I.x} size={13} />;
  return null;
}

function Chip({ tone, pending, children, sub, flag, mark, srStatus, fitKey, flip, delay }) {
  // Auto-ajuste del nombre a una sola línea: el ref va al span de texto y el hook
  // lo encoge solo si no cabe (lee el tamaño base del CSS).
  const textRef = useFitText(fitKey);
  return (
    <div
      className={"cdd-chip " + (pending ? "is-pending" : "tone-" + tone) + (flip ? " flip" : "")}
      style={flip ? { animationDelay: delay } : undefined}
    >
      <span className="cdd-chip-main">
        <span className="cdd-chip-text" ref={textRef}>{children}</span>
        {flag && <img className="cdd-flag" src={flag} alt="" draggable={false} />}
        {mark && <span className="cdd-chip-mark">{mark}</span>}
        {/* Estado para lectores de pantalla: el valor visible ya se lee; aquí solo
            añadimos la palabra de estado cuando no hay subtexto que la dé. */}
        {srStatus && <span className="sr-only">{srStatus}</span>}
      </span>
      {sub && <span className="cdd-chip-sub">{sub}</span>}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento
// dentro del fold (feedback visible sin scroll).
export function AttemptRow({ g, index, tolerance, pending, fresh }) {
  const { t } = useT();
  // Delay del flip por celda cuando la fila es la recién revelada.
  const d = (i) => (fresh ? i * FLIP_STAGGER_MS + "ms" : undefined);

  if (pending) {
    return (
      <div className="cdd-attempt">
        <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
        <div className="cdd-attempt-chips">
          <Chip pending fitKey={g.marca?.val}>{g.marca?.val || "—"}</Chip>
          <Chip pending fitKey={g.modelo?.val}>{g.modelo?.val || "—"}</Chip>
          <Chip pending fitKey={String(g.anio?.val ?? "")}>{g.anio?.val || "—"}</Chip>
        </div>
      </div>
    );
  }

  // marca
  const mSt = g.marca?.status;
  const marcaTone = mSt === "correct" ? "good" : mSt === "partial" ? "near" : "off";
  const marcaFlag = mSt === "partial" && g.marca?.pais ? flagImagePath(g.marca.pais) : null;
  const marcaSub = mSt === "partial" ? t("cdd.sameCountry") : null;
  // partial → bandera (no icono). correct → ✓, wrong → ✕.
  const marcaMark = mSt === "partial" ? null : statusMark(mSt);
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "wrong" ? t("cdd.srWrong") : null;

  // modelo — binario: o aciertas o fallas.
  const moSt = g.modelo?.status;
  const modeloTone = moSt === "correct" ? "good" : "off";
  const modeloMark = statusMark(moSt);
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");

  // año
  const aSt = g.anio?.status;
  let anioTone = "off", anioSub = null, anioMark = null, anioSr = null;
  if (aSt === "correct") {
    anioTone = "good";
    anioSub = "±" + tolerance;
    anioMark = <Icon d={I.check} size={14} />;
    anioSr = t("cdd.srCorrect");
  } else {
    const dir = g.anio?.direction; // 'up' = el real es mayor (más nuevo)
    anioSub = dir === "up" ? t("cdd.yearNewer") : dir === "down" ? t("cdd.yearOlder") : null;
    anioMark = dir ? <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={14} /> : null;
    // El subtexto (MÁS NUEVO/ANTIGUO) ya lo lee el lector de pantalla; no lo
    // duplicamos en un sr-only aparte.
  }

  return (
    <div className="cdd-attempt">
      <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
      <div className="cdd-attempt-chips">
        <Chip tone={marcaTone} sub={marcaSub} flag={marcaFlag} mark={marcaMark} srStatus={marcaSr} fitKey={g.marca?.val} flip={fresh} delay={d(0)}>{g.marca?.val}</Chip>
        <Chip tone={modeloTone} mark={modeloMark} srStatus={modeloSr} fitKey={g.modelo?.val} flip={fresh} delay={d(1)}>{g.modelo?.val}</Chip>
        <Chip tone={anioTone} sub={anioSub} mark={anioMark} srStatus={anioSr} fitKey={String(g.anio?.val ?? "")} flip={fresh} delay={d(2)}>{g.anio?.val}</Chip>
      </div>
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  if (!guesses.length && !pendingGuess) return null;
  // Más RECIENTE primero: el historial vive bajo el formulario, así el intento
  // recién hecho (o el pendiente) queda pegado al botón. Conservamos el número
  // real de intento (i+1). El recién validado (justRevealedIndex) hace flip-reveal.
  return (
    <div className="cdd-attempts">
      {pendingGuess && (
        <AttemptRow key="pending" g={pendingGuess} index={guesses.length} tolerance={tolerance} pending />
      )}
      {guesses
        .map((g, i) => ({ g, i }))
        .reverse()
        .map(({ g, i }) => (
          <AttemptRow key={i} g={g} index={i} tolerance={tolerance} fresh={i === justRevealedIndex} />
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Verificar que la app compila (build)**

Run: `npm run build`
Expected: build de Vite termina sin errores (`✓ built in …`). Captura errores de import/sintaxis (p.ej. ruta mala de `useFitText` o JSX roto).

- [ ] **Step 3: Commit**

```bash
git add src/components/configurator/AttemptList.jsx
git commit -m "feat(chips): ✓/✕ por estado, fallo en rojo y nombre en una línea (useFitText)"
```

---

## Task 6: Verificación final

**Files:** ninguno (solo comprobaciones).

- [ ] **Step 1: Suite unitaria completa**

Run: `npm run test:unit`
Expected: PASS — incluye `fitText.test.js` y los tests existentes sin regresiones.

- [ ] **Step 2: Build de producción**

Run: `npm run build`
Expected: `✓ built` sin errores ni warnings nuevos.

- [ ] **Step 3: Checklist de verificación VISUAL (la hace el usuario en su `vercel dev`)**

> Regla #12 de CLAUDE.md: el usuario verifica en su propio `vercel dev`; NO levantar servidores de preview aquí. Entregar esta checklist al usuario:

- [ ] Intento con marca/modelo/año fallidos → chips **rojos** con **✕** (marca/modelo) y **flecha ↑/↓ + MÁS NUEVO/ANTIGUO** (año); texto **blanco** legible.
- [ ] Intento con **mismo país** → chip de marca con tinte menta + borde punteado + **bandera** (algo mayor) + "MISMO PAÍS".
- [ ] Intento **ganador** → chips **menta** con **✓**.
- [ ] Nombres largos ("Mercedes-Benz", "190E Evolution II", "Chevrolet", "Integra Type R") → **una sola línea**, encogidos pero legibles; filas de altura uniforme.
- [ ] La "fila viva" sobre el formulario y la fila **pending** (shimmer) se ven correctas.
- [ ] Móvil ≤360px y desktop; `prefers-reduced-motion` (el flip-reveal se respeta).
- [ ] Repesca (otro flujo) **no ha cambiado** (sigue con su estilo propio).

- [ ] **Step 4: Aviso de "listo para mergear"**

Cuando la checklist visual del usuario esté OK, avisar explícitamente que el cambio está **listo para mergear** (regla #13: un único PR `claude/…` → `main` por tarea). En este repo el flujo es: el usuario crea/usa su rama, los commits quedan en local y él hace merge/push desde VS Code.

---

## Notas para quien ejecute

- **No** levantar `vercel dev`/preview ni `npm run dev` (reglas #1 y #12). La verificación de runtime la hace el usuario.
- **No** tocar Repesca ni los componentes legacy `components/GuessLog.jsx`/`GuessRow.jsx` (siguen en uso).
- Comentarios en español explicando el *porqué* (regla #10), UTF-8 limpio (regla #14).
- Commits en local; sin push (el usuario mergea).
