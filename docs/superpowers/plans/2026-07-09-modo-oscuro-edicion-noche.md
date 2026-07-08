# Modo oscuro «Edición de noche» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir un modo oscuro «Edición de noche» (grafito cálido) que conserva el lenguaje editorial de periódico, con un toggle de un toque en el header, que sigue la preferencia del sistema y recuerda la elección manual.

**Architecture:** Unificar el color sobre una única fuente de verdad: CSS custom properties en `:root` (día) sobreescritas en `:root[data-tema="noche"]` (noche). El CSS del juego (`.cdd-*/.prensa-*/.pm-*`) deja de usar literales hardcodeados y pasa a `var(--token)`; `tailwind.config.js` apunta sus colores a esas mismas variables (con fallback hex de día = cero regresión), de modo que juego y modales cambian de tema a la vez. Un módulo `src/lib/theme.js` resuelve/persiste el tema y un snippet inline en `index.html` lo aplica antes del primer paint (anti-FOUC).

**Tech Stack:** React 18 (JSX), Vite, Tailwind CSS 3, CSS custom properties, Vitest (entorno **node**), localStorage, `matchMedia`.

---

## File Structure

- `src/lib/theme.js` **(nuevo)** — controlador de tema: funciones puras (`resolveTheme`, `nextTheme`), efectos (`applyTheme`, `setTheme`, `toggleTheme`), hook `useTheme`, listener del sistema.
- `src/lib/theme.test.js` **(nuevo)** — tests unitarios de la lógica pura (node).
- `index.html` **(modificar)** — snippet inline anti-FOUC + `theme-color` inicial.
- `src/index.css` **(modificar)** — bloque `.prensa` (quitar valores de color), añadir `:root` (día) + `:root[data-tema="noche"]` (noche), tokenizar literales, alinear topbar al centro, estilo del toggle.
- `tailwind.config.js` **(modificar)** — colores → `var(--token, #hexDía)`.
- `src/components/configurator/Header.jsx` **(modificar)** — botón toggle + glifos luna/sol + `useTheme`.
- `src/components/configurator/Configurator.jsx` **(modificar)** — `--accent` inline → `var(--rojo)`.
- `src/i18n/locales/es.json`, `src/i18n/locales/en.json` **(modificar)** — `aria-label` del toggle.

**Orden crítico (Tarea 4):** rewrite del bloque `.prensa` (quita las *definiciones* de token con literales) → `sed` de literales *en reglas* → añadir bloques `:root`. Invertir el orden crearía auto-referencias (`--bg: var(--bg)`).

---

## Task 1: Controlador de tema `src/lib/theme.js` (lógica pura, TDD)

**Files:**
- Create: `src/lib/theme.js`
- Test: `src/lib/theme.test.js`

- [ ] **Step 1: Escribir el test que falla**

Create `src/lib/theme.test.js`:

```js
// src/lib/theme.test.js
import { describe, it, expect } from "vitest";
import { resolveTheme, nextTheme } from "./theme";

describe("resolveTheme", () => {
  it("respeta el override manual 'noche' aunque el sistema sea claro", () => {
    expect(resolveTheme("noche", false)).toBe("noche");
  });
  it("respeta el override manual 'dia' aunque el sistema sea oscuro", () => {
    expect(resolveTheme("dia", true)).toBe("dia");
  });
  it("sin override, sigue al sistema oscuro", () => {
    expect(resolveTheme(null, true)).toBe("noche");
  });
  it("sin override, sigue al sistema claro", () => {
    expect(resolveTheme(null, false)).toBe("dia");
  });
  it("valor basura en storage → cae al sistema", () => {
    expect(resolveTheme("xyz", true)).toBe("noche");
  });
});

describe("nextTheme", () => {
  it("dia → noche", () => expect(nextTheme("dia")).toBe("noche"));
  it("noche → dia", () => expect(nextTheme("noche")).toBe("dia"));
});
```

- [ ] **Step 2: Ejecutar el test y verlo fallar**

Run: `npx vitest run src/lib/theme.test.js`
Expected: FAIL — "Failed to resolve import './theme'" / módulo inexistente.

- [ ] **Step 3: Implementar `src/lib/theme.js`**

Create `src/lib/theme.js`:

```js
// src/lib/theme.js
// Controlador del tema visual «Edición de día / de noche». Fuente de verdad
// del color son las CSS variables en :root / :root[data-tema="noche"] (index.css);
// este módulo solo decide QUÉ tema aplicar y lo refleja en el <html>.
//
// Arranque (resuelto también inline en index.html para evitar el flash):
//   1) override manual en localStorage ('dia'|'noche') si existe;
//   2) si no, la preferencia del SO (prefers-color-scheme).
// Al pulsar el toggle se persiste el override, que a partir de ahí manda sobre
// el sistema. Mientras NO haya override, seguimos los cambios del sistema.

import { useEffect, useState } from "react";

const STORAGE_KEY = "cdd-tema";
// Debe coincidir con --bg de cada tema (index.css) y con el <meta theme-color>.
const THEME_COLOR = { dia: "#f3eee1", noche: "#17130d" };
const listeners = new Set();

// ── Lógica pura (testeable en node, sin DOM) ──
export function resolveTheme(stored, prefersDark) {
  if (stored === "dia" || stored === "noche") return stored;
  return prefersDark ? "noche" : "dia";
}
export function nextTheme(tema) {
  return tema === "noche" ? "dia" : "noche";
}

// ── Lecturas del entorno (protegidas: el módulo se importa también en node) ──
function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function systemPrefersDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// Estado inicial: si el inline de index.html ya fijó data-tema, lo respetamos;
// si no (SSR/tests), lo resolvemos.
let current =
  typeof document !== "undefined" && document.documentElement.dataset.tema
    ? document.documentElement.dataset.tema
    : resolveTheme(readStored(), systemPrefersDark());

export function getTheme() {
  return current;
}

export function applyTheme(tema) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.tema = tema;
  el.style.colorScheme = tema === "noche" ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[tema]);
}

export function setTheme(tema) {
  if (tema !== "dia" && tema !== "noche") return;
  current = tema;
  try {
    localStorage.setItem(STORAGE_KEY, tema);
  } catch {
    // ignore (modo privado / iframe)
  }
  applyTheme(tema);
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(nextTheme(current));
}

// Seguir el sistema SOLO mientras no haya override manual guardado.
if (typeof window !== "undefined" && window.matchMedia) {
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (readStored() == null) setTheme(e.matches ? "noche" : "dia");
      });
  } catch {
    // ignore
  }
}

// Hook reactivo: cualquier componente que use useTheme() se re-renderiza al
// cambiar el tema (mismo patrón que useT() en i18n).
export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { tema: current, toggle: toggleTheme, setTheme };
}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

Run: `npx vitest run src/lib/theme.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.js src/lib/theme.test.js
git commit -m "feat(tema): controlador de tema día/noche con lógica pura testeada"
```

---

## Task 2: Anti-FOUC en `index.html`

**Files:**
- Modify: `index.html:8` (tras el `<meta name="theme-color">`)

- [ ] **Step 1: Insertar el snippet inline**

En `index.html`, localiza la línea:

```html
    <meta name="theme-color" content="#f3eee1" />
```

Y añade **justo debajo** (antes de los `<link rel="preconnect">`):

```html
    <!--
      Anti-FOUC del tema: fija data-tema en <html> ANTES del primer paint, para
      que la página no cargue en papel y salte a grafito (o viceversa). Misma
      lógica que src/lib/theme.js (override en localStorage → si no, el sistema).
      Silencioso: cualquier fallo deja el día por defecto.
    -->
    <script>
      (function () {
        try {
          var k = localStorage.getItem("cdd-tema");
          var noche =
            k === "noche" ||
            (k == null &&
              window.matchMedia("(prefers-color-scheme: dark)").matches);
          var el = document.documentElement;
          el.dataset.tema = noche ? "noche" : "dia";
          el.style.colorScheme = noche ? "dark" : "light";
          var m = document.querySelector('meta[name="theme-color"]');
          if (m) m.setAttribute("content", noche ? "#17130d" : "#f3eee1");
        } catch (e) {}
      })();
    </script>
```

- [ ] **Step 2: Verificar que el build no rompe**

Run: `npx vitest run`
Expected: PASS (sin cambios en tests; sanity de que nada se importó mal).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(tema): aplica el tema antes del primer paint (anti-FOUC)"
```

---

## Task 3: Tailwind → variables de tema

**Files:**
- Modify: `tailwind.config.js` (bloque `theme.extend.colors`)

Cada color de la paleta apunta a `var(--token, #hexDía)`. El **fallback hex de
día garantiza que el modo día queda idéntico** aunque la variable no existiera.

- [ ] **Step 1: Reemplazar el bloque `colors`**

En `tailwind.config.js`, sustituye el objeto `colors: { ... }` completo por:

```js
      colors: {
        // ── Sistema «Prensa del motor» — apuntan a las CSS vars de tema
        //    (index.css :root / :root[data-tema="noche"]). El fallback hex es
        //    el valor de DÍA: si la variable no estuviera, el día no cambia. ──
        papel: {
          DEFAULT: "var(--bg, #f3eee1)",
          2: "var(--bg2, #e9e2cf)",
          mat: "var(--surface, #fbf7ec)",
        },
        tinta: { DEFAULT: "var(--cdd-text, #1b1712)", 2: "var(--cdd-muted, #6e6553)" },
        rojo: "var(--rojo, #b3271b)",
        "oro-viejo": "var(--gold, #7a5c10)",

        bg: {
          primary: "var(--bg, #f3eee1)",
          secondary: "var(--bg2, #e9e2cf)",
          tertiary: "var(--bg2, #e9e2cf)",
        },
        border: {
          DEFAULT: "var(--line, rgba(27,23,18,0.25))",
          strong: "var(--line-strong, #1b1712)",
        },
        accent: {
          DEFAULT: "var(--rojo, #b3271b)",
          dark: "var(--rojo-dark, #8f1f16)",
          glow: "transparent",
        },
        gold: {
          DEFAULT: "var(--gold, #7a5c10)",
          dark: "var(--gold-dark, #5f470c)",
          ink: "var(--gold-ink, #f3eee1)",
          glow: "transparent",
        },
        muted: "var(--cdd-muted, #6e6553)",
        mint: { DEFAULT: "var(--rojo, #b3271b)", foreground: "var(--bg, #f3eee1)" },
        card: { DEFAULT: "var(--surface, #fbf7ec)", foreground: "var(--cdd-text, #1b1712)" },
        foreground: "var(--cdd-text, #1b1712)",
        "muted-foreground": "var(--cdd-muted, #6e6553)",
        destructive: "var(--rojo, #b3271b)",
      },
```

- [ ] **Step 2: Verificar tests (sanity)**

Run: `npx vitest run`
Expected: PASS. (El build real de Tailwind se valida en el Preview de Vercel; localmente `npm run build` falla por `@capacitor/core`, ajeno a esto.)

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.js
git commit -m "refactor(tema): tokens de Tailwind apuntan a las CSS vars de tema"
```

---

## Task 4: CSS — tokens de tema y tokenización de literales

**Files:**
- Modify: `src/index.css` (bloque `.prensa` ~966-984; base `@layer`; literales)

**⚠️ Respeta el orden de los steps (evita auto-referencias en las variables).**

- [ ] **Step 1: Rewrite del bloque `.prensa` (quitar valores de color)**

En `src/index.css`, reemplaza el bloque `.prensa { ... }` (empieza en la línea
con `.prensa {` sobre la línea `--bg: #f3eee1;`) por:

```css
.prensa {
  /* Los tokens de COLOR viven ahora en :root (día) y :root[data-tema="noche"]
     (noche) — más abajo en este archivo. .prensa ya NO los fija localmente,
     para que el modo oscuro pueda sobreescribirlos por herencia. Aquí solo
     quedan la tipografía editorial y el lienzo (que consumen los tokens). */
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Libre Franklin', Arial, sans-serif;
  --font-mono: 'Courier Prime', monospace;
  --ambient: none;
  background: var(--bg); color: var(--cdd-text);
  font-family: var(--font-body);
}
```

(Esto elimina las definiciones `--bg/--surface/--cdd-text/--line*/--gold/--rojo(--warn)/--accent-ink/...` de `.prensa`; se recrean en `:root` en el Step 3.)

- [ ] **Step 2: Tokenizar los literales de la paleta prensa (sed)**

Ejecuta desde la raíz del repo (GNU sed, in-place). Convierte los literales de
las **reglas** a `var(--token)`. Seguro: estos hex no aparecen en los bloques de
admin `.theme-platino`/`.theme-cobre`, y las definiciones de token con estos
literales ya se quitaron en el Step 1.

```bash
sed -i \
  -e 's/#b3271b/var(--rojo)/g' \
  -e 's/#1b1712/var(--cdd-text)/g' \
  -e 's/#f3eee1/var(--bg)/g' \
  -e 's/#6e6553/var(--cdd-muted)/g' \
  -e 's/#7a5c10/var(--gold)/g' \
  -e 's/#fbf7ec/var(--surface)/g' \
  -e 's/#e9e2cf/var(--bg2)/g' \
  src/index.css
```

- [ ] **Step 3: Añadir los bloques de tema `:root` (día) y noche**

Inserta, **justo después** del cierre del bloque `@layer base { ... }** (la línea
`}` que cierra `@layer base`, antes de `@layer utilities`), este bloque nuevo.
Se añade DESPUÉS del sed, así sus literales sobreviven (no se auto-referencian):

```css
/* ═══════════════════════════════════════════════════════════════════════
   PALETA EDITORIAL — fuente de verdad única del color.
   Día en :root; noche en :root[data-tema="noche"] (lo fija el inline de
   index.html + src/lib/theme.js). La consume TODO: el CSS del juego
   (.cdd-*/.prensa-*/.pm-* vía var(--...)) y Tailwind (tailwind.config.js
   apunta sus colores a estas mismas variables). Los temas de admin
   (.theme-platino/.theme-cobre) siguen fijando sus tokens localmente y NO
   se tematizan.
   ═══════════════════════════════════════════════════════════════════════ */
:root {
  color-scheme: light;
  --bg: #f3eee1; --bg2: #e9e2cf; --surface: #fbf7ec; --surface2: #e9e2cf;
  --line: rgba(27, 23, 18, .25); --line-2: rgba(27, 23, 18, .15);
  --line-strong: #1b1712;
  --cdd-text: #1b1712; --cdd-muted: #6e6553; --faint: rgba(110, 101, 83, .62);
  --rojo: #b3271b; --rojo-dark: #8f1f16;
  --gold: #7a5c10; --gold-dark: #5f470c; --gold-ink: #f3eee1; --gold-glow: transparent;
  --accent-ink: #f3eee1; --good-ink: #f3eee1;
  --bad: #6e6553; --bad-ink: #6e6553; --bad-sub: #6e6553;
  --warn: #b3271b;
}
/* «Edición de noche» — grafito cálido. Rojo y oro subidos para leer sobre
   fondo oscuro (contraste AA); filete fuerte en un beige apagado, no blanco
   puro, para que las dobles rayas del folio no deslumbren. */
:root[data-tema="noche"] {
  color-scheme: dark;
  --bg: #17130d; --bg2: #211b12; --surface: #1e1a13; --surface2: #211b12;
  --line: rgba(236, 225, 207, .14); --line-2: rgba(236, 225, 207, .07);
  --line-strong: #b9ad97;
  --cdd-text: #ece1cf; --cdd-muted: #9a8d76; --faint: rgba(154, 141, 118, .55);
  --rojo: #e0574a; --rojo-dark: #c24437;
  --gold: #d9b877; --gold-dark: #b9975a; --gold-ink: #17130d; --gold-glow: transparent;
  --accent-ink: #17130d; --good-ink: #17130d;
  --bad: #9a8d76; --bad-ink: #9a8d76; --bad-sub: #9a8d76;
  --warn: #e0574a;
}
```

- [ ] **Step 4: Auditar que no quedan literales de paleta sueltos**

Run:
```bash
grep -nE "#(b3271b|1b1712|f3eee1|6e6553|7a5c10|fbf7ec|e9e2cf)" src/index.css
```
Expected: **solo** líneas dentro de los dos bloques `:root` recién añadidos (las
definiciones de token). Cualquier otra ocurrencia es un literal que se escapó:
reemplázalo por el `var(--token)` correspondiente (mismo mapeo que el sed).

También revisa los tintes rgba de tinta que queden en reglas (poco frecuentes):
```bash
grep -nE "rgba\(27, ?23, ?18|rgba\(179, ?39, ?27|rgba\(110, ?101, ?83" src/index.css
```
Para cada ocurrencia **fuera de los bloques `:root`**: `rgba(27,23,18,.25)`→`var(--line)`, `rgba(27,23,18,.15)`→`var(--line-2)`, `rgba(110,101,83,.62)`→`var(--faint)`. Deja `rgba(27,23,18,.45)` y `rgba(179,39,27,.08)` como están (tintes sutiles; en grafito solo pierden efecto, sin romper) — anótalos para revisión en Preview.

- [ ] **Step 5: Ejecutar tests (sanity de que el CSS no reventó el import)**

Run: `npx vitest run`
Expected: PASS (los tests no cargan CSS, pero confirma que nada más se rompió).

- [ ] **Step 6: Commit**

```bash
git add src/index.css
git commit -m "refactor(tema): paleta como CSS vars en :root + override noche + tokeniza literales"
```

---

## Task 5: CSS — alinear la topbar al centro y estilo del toggle

**Files:**
- Modify: `src/index.css` (reglas `.prensa-topbar`)

Con un glifo en la barra, la alineación por línea base lo dejaba flotando alto
(validado en brainstorming). Se pasa a centro óptico y se estila el botón.

- [ ] **Step 1: Cambiar `align-items: baseline` → `center` en la topbar**

En `src/index.css`, en la regla `.prensa-topbar {` cambia:
```css
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
```
por:
```css
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
```

En la regla `.prensa-topbar > span {` cambia:
```css
.prensa-topbar > span { display: inline-flex; align-items: baseline; }
```
por:
```css
.prensa-topbar > span { display: inline-flex; align-items: center; }
```

En la regla `.prensa-topbar button, .prensa-topbar a {` cambia la línea:
```css
  display: inline-flex; align-items: baseline; gap: 0;
```
por:
```css
  display: inline-flex; align-items: center; gap: 0;
```

- [ ] **Step 2: Añadir el estilo del botón toggle**

Justo después de la regla `.prensa-topbar .cta { color: #b3271b; }` (que tras el
sed del Task 4 será `.prensa-topbar .cta { color: var(--rojo); }`), añade:

```css
/* Toggle de tema: glifo de línea (mismo peso que los iconos del juego),
   tinta apagada → rojo al pulsar, como el resto de enlaces de la barra. */
.prensa-topbar .prensa-tema { color: var(--cdd-muted); }
.prensa-topbar .prensa-tema:hover { color: var(--rojo); }
.prensa-topbar .prensa-tema svg { display: block; width: 15px; height: 15px; }
```

- [ ] **Step 3: Ejecutar tests (sanity)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style(tema): topbar al centro óptico y estilo del toggle"
```

---

## Task 6: i18n — aria-labels del toggle

**Files:**
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/en.json`

- [ ] **Step 1: Añadir claves en `es.json`**

En `src/i18n/locales/es.json`, dentro del objeto `"cdd": { ... }` (junto a claves
como `"yearNewer"`, `"srCorrect"`), añade:

```json
    "themeToNight": "Cambiar a edición de noche",
    "themeToDay": "Volver a edición de día",
```

- [ ] **Step 2: Añadir claves en `en.json`**

En `src/i18n/locales/en.json`, dentro del objeto `"cdd": { ... }`, añade:

```json
    "themeToNight": "Switch to night edition",
    "themeToDay": "Back to day edition",
```

- [ ] **Step 3: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/es.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "i18n(tema): aria-labels del toggle día/noche (es/en)"
```

---

## Task 7: Header — botón toggle

**Files:**
- Modify: `src/components/configurator/Header.jsx`
- Modify: `src/components/configurator/Configurator.jsx:109`

- [ ] **Step 1: Importar `useTheme` y `useT` en Header.jsx**

En `src/components/configurator/Header.jsx`, en el bloque de imports (junto a
`import { useT } from "../../i18n";` y `import { haptic } from "../../lib/haptics";`),
añade:

```jsx
import { useTheme } from "../../lib/theme";
```

- [ ] **Step 2: Añadir los glifos luna/sol**

En `src/components/configurator/Header.jsx`, antes de `export default function Header(`,
añade dos componentes de glifo:

```jsx
// Glifos del toggle de tema (mismo trazo 1.6 y caja 24 que los iconos del
// juego). Luna en día (invita a la noche); sol en noche (vuelve al día).
function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  );
}
```

- [ ] **Step 3: Consumir el hook dentro del componente**

En `src/components/configurator/Header.jsx`, localiza la línea dentro de la
función Header:

```jsx
  const { t, dateLocale } = useT();
```

Y añade justo debajo:

```jsx
  const { tema, toggle } = useTheme();
```

- [ ] **Step 4: Insertar el botón tras «Perfil»**

En `src/components/configurator/Header.jsx`, localiza el cierre del botón de
perfil dentro del grupo derecho:

```jsx
          <button
            type="button"
            aria-label={t("cdd.profileAria")}
            onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
          >
            {user ? t("prensa.perfil") : t("prensa.entrar")}
          </button>
        </span>
```

Y reemplázalo por (añade separador + botón toggle antes de `</span>`):

```jsx
          <button
            type="button"
            aria-label={t("cdd.profileAria")}
            onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
          >
            {user ? t("prensa.perfil") : t("prensa.entrar")}
          </button>
          <span className="sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="prensa-tema"
            aria-pressed={tema === "noche"}
            aria-label={tema === "noche" ? t("cdd.themeToDay") : t("cdd.themeToNight")}
            onClick={() => { haptic.impactLight(); toggle(); }}
          >
            {tema === "noche" ? <SunGlyph /> : <MoonGlyph />}
          </button>
        </span>
```

- [ ] **Step 5: Hacer `--accent` sensible al tema en Configurator.jsx**

En `src/components/configurator/Configurator.jsx`, localiza:

```jsx
    <div className="cdd-app prensa" style={{ "--accent": DEFAULT_ACCENT }}>
```

Y cámbialo por (para que el rojo del focus-ring y piezas .cdd-* siga al tema):

```jsx
    <div className="cdd-app prensa" style={{ "--accent": "var(--rojo)" }}>
```

(Deja la constante `DEFAULT_ACCENT` como está: puede seguir usándose como
`accent` prop por defecto en la firma del componente.)

- [ ] **Step 6: Ejecutar tests (sanity)**

Run: `npx vitest run`
Expected: PASS (129+ tests; no hay test de Header, confirma que nada se rompió).

- [ ] **Step 7: Commit**

```bash
git add src/components/configurator/Header.jsx src/components/configurator/Configurator.jsx
git commit -m "feat(tema): toggle día/noche en el header (glifo luna/sol)"
```

---

## Task 8: Verificación integral (Preview de Vercel)

**Files:** ninguno (verificación).

- [ ] **Step 1: Suite completa local**

Run: `npx vitest run`
Expected: PASS (todas). Si alguna falla, arréglala antes de seguir.

- [ ] **Step 2: Push y abrir Preview**

```bash
git push -u origin HEAD
```
Vercel genera un Preview de la rama. Abre la URL en el móvil.

- [ ] **Step 3: Checklist manual en el Preview**

- [ ] **Día idéntico:** con el sistema en claro (o tras pulsar a día), la home se
  ve exactamente como antes (papel crema). Sin regresiones de color en juego ni
  modales (Ranking, Perfil, Garaje, Logros, Cómo se juega).
- [ ] **Toggle:** el glifo luna aparece tras «Perfil», bien centrado con las
  versalitas y a ras del margen derecho. Un toque cambia a noche (glifo pasa a
  sol) y viceversa. Área táctil cómoda.
- [ ] **Noche coherente:** grafito cálido en juego Y modales; el rojo de rotativa
  y el oro se leen sobre el fondo oscuro (contraste AA); las dobles rayas del
  folio y los filetes no deslumbran.
- [ ] **Sin FOUC:** recarga estando en noche → carga directamente en grafito, sin
  fogonazo blanco.
- [ ] **Chrome del navegador:** la barra superior del navegador móvil
  (`theme-color`) acompaña (grafito en noche, papel en día).
- [ ] **Memoria + sistema:** primera visita sin elección sigue al SO; tras pulsar
  el toggle, recarga → mantiene lo elegido.
- [ ] **Foco visible:** el subrayado rojo de foco de los inputs sigue visible en
  noche (año y combos).

- [ ] **Step 4: Ajustes finos (si el Preview lo pide)**

Si algún filete se ve demasiado brillante en noche o algún tinte rgba residual
molesta (los `rgba(27,23,18,.45)` / `rgba(179,39,27,.08)` que se dejaron), ajusta
esas reglas puntuales en `src/index.css` (p.ej. borde a `var(--line-strong)`),
commitea y vuelve a revisar.

- [ ] **Step 5: Cierre**

Cuando el checklist pase, sigue **superpowers:finishing-a-development-branch**
para abrir el PR `claude/modo-oscuro-edicion-noche` → `main` (un único botón de
Merge). Avisa de que está listo para mergear.

---

## Notas de verificación / cobertura del spec

- **Paleta grafito cálido:** Task 4 (`:root[data-tema="noche"]`).
- **Arranque sistema + memoria:** Task 1 (`resolveTheme`, listener) + Task 2 (inline).
- **Toggle en header luna/sol:** Task 7 + Task 5 (estilo/alineado).
- **Alcance app completa (juego + modales + chrome):** Task 3 (Tailwind→vars) +
  Task 4 (CSS vars en :root) + `theme-color` (Task 1/2).
- **Dos sistemas de color unificados:** Task 3 + Task 4.
- **Anti-FOUC:** Task 2.
- **Tests:** Task 1 (lógica pura) + Task 8 (Preview manual: contraste, FOUC, modales).
- **Fuera de alcance:** admin `.theme-platino` (no tematizado), foto del coche,
  panel de ajustes, transición animada elaborada — respetado (no hay tareas).
```
