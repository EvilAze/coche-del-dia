# Port «Prensa del motor» — Fase 1: cimientos + pantalla de juego

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar los cimientos tipográficos/tokens y la pantalla de juego completa al sistema editorial «Prensa del motor», dejando el resto de superficies intactas (se portan en F2–F5; solo se mergea al completar F5).

**Architecture:** Re-skin in situ de la capa `.cdd-*` de `index.css` usando `public/prensa-del-motor.html` como fuente de verdad visual. Los tokens nuevos CONVIVEN con los antiguos hasta F5 (las pantallas no portadas siguen funcionando). Cero cambios en `api/`, `middleware.js` y `CarImage` (reglas 5/6 de CLAUDE.md).

**Tech Stack:** React 18 + Vite, Tailwind 3 (tokens), CSS plano en `index.css`, vitest para lógica extraída (`resolver`), Vercel Preview para verificación visual.

**Spec:** `docs/superpowers/specs/2026-07-07-rediseno-prensa-del-motor-design.md`
**Fuente visual:** `public/prensa-del-motor.html` (líneas de CSS referenciadas por sección)

**Convenciones de esta fase:**
- Commits pequeños por tarea, mensajes `design(f1): …`, en español, explicando el porqué.
- Verificación visual = servidor de preview local ya configurado (`.claude/launch.json` → "dev") + push a la rama para Vercel Preview al cerrar la fase.
- `npm run build` NO funciona en el worktree (falta @capacitor/*, ver memoria del proyecto); la red de seguridad es `npx vitest run` + el build real del Preview de Vercel.

---

### Task 1: Fuentes y metadatos base (`index.html`)

**Files:**
- Modify: `index.html:8` (theme-color), `index.html:19-27` (fuentes), `index.html:151-156` (noscript)

- [ ] **Step 1: Sustituir el link de Google Fonts**

Reemplazar el bloque de fuentes (líneas 19–27) por:

```html
    <!--
      Sistema «Prensa del motor»: Fraunces (display editorial, con itálica),
      Libre Franklin (UI/labels) y Courier Prime (cupón/datos). Sustituye a
      Archivo + Space Mono. Mismo patrón preconnect + display=swap (anti-FOIT);
      pesos acotados a los que usa el sistema para no engordar el LCP.
    -->
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,900;1,9..144,400;1,9..144,600&family=Libre+Franklin:wght@400;600;800&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap"
    />
```

- [x] **Step 2: theme-color y noscript a papel → DIFERIDO A F5** (decisión en ejecución:
son globales y la app sigue oscura hasta F5; cambiarlos ahora dejaría la barra del
navegador en papel sobre pantallas grafito en los Previews intermedios. Misma lógica
de convivencia que los tokens. F5 los cambia junto con la retirada de Archivo/Space
Mono del link de fuentes, que también se conservan hasta entonces.)

- [ ] **Step 3: Verificar en preview**

`preview_eval`: `document.fonts.ready.then(() => [...document.fonts].map(f => f.family))` debe incluir Fraunces/Libre Franklin/Courier Prime tras recargar `/`.

- [ ] **Step 4: Commit** — `design(f1): fuentes Fraunces/Franklin/Courier y theme-color papel`

---

### Task 2: Tokens Tailwind nuevos (conviven con los viejos hasta F5)

**Files:**
- Modify: `tailwind.config.js:14-59` (colors + boxShadow) y `:63-79` (animation)

- [ ] **Step 1: Añadir paleta prensa SIN retirar la antigua**

Dentro de `colors`, añadir (los tokens antiguos `accent/gold/mint/...` se quedan hasta F5 — las pantallas no portadas los siguen usando):

```js
        // ── Sistema «Prensa del motor» (F1+). Los tokens antiguos conviven
        //    hasta F5: retirarlos ahora dejaría sin estilo las pantallas aún
        //    no portadas. El grep de limpieza es criterio de cierre de F5. ──
        papel: { DEFAULT: "#f3eee1", 2: "#e9e2cf", mat: "#fbf7ec" },
        tinta: { DEFAULT: "#1b1712", 2: "#6e6553" },
        rojo: "#b3271b",
        // Oro premium re-pigmentado para papel: SOLO texto/filetes, nunca
        // relleno (el #e8c87a actual es ilegible sobre claro).
        "oro-viejo": "#7a5c10",
```

- [ ] **Step 2: Añadir fuentes prensa como familias nuevas**

En `fontFamily` añadir (sin tocar `display/body/mono` hasta F5, por la misma convivencia):

```js
        serif: ["'Fraunces'", "Georgia", "serif"],
        franklin: ["'Libre Franklin'", "Arial", "sans-serif"],
        courier: ["'Courier Prime'", "monospace"],
```

- [ ] **Step 3: Animaciones prensa**

En `animation`/`keyframes` añadir (adaptadas del prototipo, líneas ~120-138 del HTML):

```js
        "estampar": "estampar 0.28s cubic-bezier(0.2,1,0.3,1) both",
        "sellar": "sellar 0.45s cubic-bezier(0.2,1.4,0.4,1) both",
        "temblor": "temblor 0.4s ease",
```
```js
        estampar: { from: { opacity: 0, transform: "scale(1.02)" } },
        sellar: { from: { opacity: 0, transform: "rotate(-7deg) scale(1.7)" } },
        temblor: {
          "20%,60%": { transform: "translateX(-4px)" },
          "40%,80%": { transform: "translateX(4px)" },
        },
```

- [ ] **Step 4: Verificar que vitest sigue verde** — `npx vitest run` (los tests de lib no tocan Tailwind; esto caza typos de sintaxis en el config vía el build de Vite del preview).

- [ ] **Step 5: Commit** — `design(f1): tokens papel/tinta/rojo/oro-viejo y animaciones de imprenta`

---

### Task 3: `resolver()` — prefijo inequívoco (TDD)

**Files:**
- Create: `src/lib/resolver.js`
- Create: `src/lib/resolver.test.js`

- [ ] **Step 1: Test que falla**

```js
// src/lib/resolver.test.js
import { describe, it, expect } from "vitest";
import { resolver } from "./resolver";

const MARCAS = ["Jaguar", "Lancia", "Lamborghini", "Seat"];

describe("resolver (prefijo inequívoco → valor canónico)", () => {
  it("prefijo único autocompleta al canónico", () => {
    expect(resolver("jag", MARCAS)).toBe("Jaguar");
  });
  it("coincidencia exacta gana aunque haya otros prefijos", () => {
    expect(resolver("lancia", MARCAS)).toBe("Lancia");
  });
  it("prefijo ambiguo NO adivina", () => {
    expect(resolver("la", MARCAS)).toBe("la"); // Lancia y Lamborghini
  });
  it("sin match devuelve lo escrito, recortado", () => {
    expect(resolver("  bmw ", MARCAS)).toBe("bmw");
  });
  it("ignora tildes y mayúsculas en la comparación", () => {
    expect(resolver("citroen", ["Citroën"])).toBe("Citroën");
  });
  it("vacío se devuelve tal cual", () => {
    expect(resolver("   ", MARCAS)).toBe("");
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo** — `npx vitest run src/lib/resolver.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/lib/resolver.js
// Prefijo inequívoco → valor canónico ("jag" → "Jaguar"): recorta la mayor
// fricción del cupón en móvil (teclear nombres completos). SOLO autocompleta
// si el prefijo casa con UNA única opción — nunca adivina entre varias.
// Normaliza tildes con la forma ESCAPADA del rango combinante (regla 14 de
// CLAUDE.md: nunca incrustar los caracteres, un re-guardado mal codificado
// generaría un char-class inválido que tumba el chunk).
const norm = (s) =>
  String(s).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function resolver(valor, lista) {
  const v = norm(valor);
  if (!v) return String(valor).trim();
  const exacto = lista.find((x) => norm(x) === v);
  if (exacto) return exacto;
  const prefijo = lista.filter((x) => norm(x).startsWith(v));
  return prefijo.length === 1 ? prefijo[0] : String(valor).trim();
}
```

- [ ] **Step 4: Verde** — `npx vitest run src/lib/resolver.test.js` → 6 passed.

- [ ] **Step 5: Commit** — `feat(f1): resolver() de prefijo inequívoco para el cupón (con tests)`

---

### Task 4: Capa CSS prensa — variables raíz y cabecera

**Files:**
- Modify: `src/index.css` (bloque `.theme-platino`/`.cdd-app` en adelante)
- Referencia: `public/prensa-del-motor.html` `<style>` (secciones "Sistema", "Cabecera")

- [ ] **Step 1: Nuevo bloque de variables `.prensa` que sustituye a `.theme-platino` para el juego**

Sobre el bloque `.theme-platino` (index.css:265): añadir el tema nuevo. NO borrar `.theme-platino`/`.theme-cobre` todavía (Configurator deja de usarlos en Task 8; el grep de F5 los retira):

```css
/* ═══ Tema «Prensa del motor» (F1) ══════════════════════════════════════
   Imprenta a dos tintas: PAPEL + TINTA + ROJO (+ oro-viejo SOLO texto
   premium). Sin sombras/glow/blur; jerarquía por filetes; esquinas vivas.
   Mapea las MISMAS variables que consumía .theme-platino para minimizar el
   churn en la capa .cdd-*; las que el lenguaje prensa elimina (glow, warn
   ámbar) apuntan a tinta/rojo para que ningún selector quede sin valor. */
.prensa {
  --bg: #f3eee1; --bg2: #e9e2cf; --surface: #fbf7ec; --surface2: #e9e2cf;
  --line: rgba(27,23,18,.9); --line-2: rgba(27,23,18,.25);
  --line-strong: #1b1712;
  --cdd-text: #1b1712; --cdd-muted: #6e6553; --faint: rgba(110,101,83,.62);
  --accent: #b3271b; --accent-ink: #f3eee1;
  --good-ink: #f3eee1;
  --bad: #6e6553; --bad-ink: #6e6553; --bad-sub: #6e6553;
  --warn: #b3271b; /* la urgencia en prensa es ROJA: no existe el ámbar */
  --gold: #7a5c10; --gold-ink: #f3eee1; --gold-glow: transparent;
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Libre Franklin', Arial, sans-serif;
  --font-mono: 'Courier Prime', monospace;
  --ambient: none;
}
```

- [ ] **Step 2: Port de la cabecera** — reescribir los bloques `.cdd-header`, `.cdd-wordmark`, `.cdd-title`, `.cdd-date`, `.cdd-nav`, `.cdd-iconbtn`, `.cdd-statuspill` según el prototipo (topbar de enlaces + masthead + folio). El detalle de selectores se decide con el markup de Task 5 (Header.jsx) delante; regla fija: masthead Fraunces 900 centrado, folio entre filetes `3px double`, racha en `--gold` con `✦`, cero glows/pills.

- [ ] **Step 3: Verificación visual en preview** (la cabecera nueva sobre el juego real, móvil 375px y 1280px).

- [ ] **Step 4: Commit** — `design(f1): tema .prensa + cabecera de periódico`

---

### Task 5: `Header.jsx` → cabecera de periódico

**Files:**
- Modify: `src/components/configurator/Header.jsx` (111 líneas, reescritura de markup)
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/en.json` (strings nuevos)

- [ ] **Step 1: Markup nuevo** — estructura del prototipo: `topbar` (enlaces GARAJE · RANKING · AYUDA como texto versalitas — mismos handlers que los iconbtns actuales, incluida la campana de push si está montada y el punto de alerta de repesca como `(1)` rojo junto a GARAJE), `masthead` (h1 + lema en cursiva), `folio` (fecha larga + "EDICIÓN GRATUITA" + racha `✦ N`). La fecha ya existe en el Header actual; el lema es string i18n nuevo (`header.lema`: "El diario de los que reconocen un coche por el faro." / voz inglesa propia).
- [ ] **Step 2: Sin Nº de edición** — el dato no existe client-side y NO se inventa (YAGNI; si algún día `get-daily-car` devuelve el ordinal, se añade al folio).
- [ ] **Step 3: Verificar interacciones** — abrir garaje/ranking/ayuda desde los enlaces nuevos en preview; racha visible para logueado y CTA "COMPITE →" para anónimo (mismo gating que la statuspill actual).
- [ ] **Step 4: Commit** — `design(f1): Header como cabecera de periódico (topbar+masthead+folio)`

---

### Task 6: Escenario — `ZoomStage` con paspartú, fuera `StageHud`, pips fotogramas

**Files:**
- Modify: `src/components/configurator/ZoomStage.jsx` (quitar `<StageHud/>` y grain; marco paspartú)
- Delete (F5 definitivo, aquí solo desconectar): uso de `StageHud.jsx`
- Modify: `src/components/configurator/AttemptProgress.jsx` + CSS `.cdd-progress*`
- Modify: CSS `.cdd-stage-frame` (paspartú `--surface` mat + filete 1px tinta; viñeta ::after FUERA — sobre papel no hace falta oscurecer para leer los pips, que ya no viven sobre la foto)

- [ ] **Step 1: Marco**: `.cdd-stage-frame { border:1px solid var(--line-strong); background:var(--surface); padding:8px; border-radius:0 }`, imagen dentro con `overflow:hidden`. La ventana interior sigue 4:3 EXACTO (regla 6: el `<picture>`/srcset NO se toca).
- [ ] **Step 2: Pips fotogramas** bajo la foto (pie de foto): cuadrados 9px, gastado=tinta, actual=rojo; urgencia último intento = parpadeo rojo (reduced-motion lo anula). Mover `AttemptProgress` de overlay-sobre-foto a fila del pie (JSX en `ZoomStage`/`Configurator`).
- [ ] **Step 3: Pie de foto** en cursiva Fraunces (string i18n `stage.pie`: "El ejemplar de hoy, visto de demasiado cerca…").
- [ ] **Step 4: Verificar** zoom por intentos intacto en preview (los scales CSS vienen de `useGame`/`zoom.js` — ni tocarlos).
- [ ] **Step 5: Commit** — `design(f1): escenario con paspartú, pips fotogramas y sin HUD sci-fi`

---

### Task 7: Clasificación — `AttemptList` con marcas de corrector

**Files:**
- Modify: `src/components/configurator/AttemptList.jsx` (numeración 01…, estructura de fila)
- Modify: CSS `.cdd-attempts`, `.cdd-chip*`, `.tone-*`

- [ ] **Step 1: CSS de veredictos** (del prototipo, sección "Clasificación"): `.tone-good` → subrayado rojo 2px + ✓ rojo; `.tone-near` → subrayado rojo discontinuo + apostilla cursiva roja (las apostillas MISMO PAÍS/±2 ya existen vía i18n); `.tone-off` → tachado tinta al 55%. Fondos transparentes, sin chips rellenos.
- [ ] **Step 2: Numeración** `01…05` en Courier a la izquierda de cada fila; filete inferior `--line-2` entre filas. `useFitText` se conserva tal cual.
- [ ] **Step 3: Pendiente/flip**: `is-pending` pasa de shimmer brillante a "entintado" (pulso de opacity); `flip` se sustituye por `animate-estampar`.
- [ ] **Step 4: Verificar** una partida real en preview (intento bueno/cerca/malo) + `prefers-reduced-motion`.
- [ ] **Step 5: Commit** — `design(f1): clasificación con marcas de corrector de pruebas`

---

### Task 8: El cupón — `GuessForm`/`Combo`/`YearField` + `Configurator` shell

**Files:**
- Modify: `src/components/configurator/GuessForm.jsx` (resolver + enter-next + submit UX)
- Modify: `src/components/configurator/Combo.jsx`, `YearField.jsx` (re-skin, atributos móvil)
- Modify: `src/components/configurator/Configurator.jsx` (shell: `.prensa` en vez de `.theme-platino` + inyección `--accent`; broadsheet grid areas; estadística en columna solo con partida cerrada)
- Modify: CSS `.cdd-form*`, `.cdd-combo`, `.cdd-listbox`, `.cdd-year*`, `.cdd-submit`, `.cdd-shell` (→ `.hoja` ancho 1260 + grid areas de 3 columnas del prototipo)

- [ ] **Step 1: Cupón visual**: caja doble filete (`border` + `outline` offset 3px), cabecera "CUPÓN DE RESPUESTA" con filetes laterales, campos de línea base con entrada en Courier, ADIVINAR bloque tinta → hover rojo. Listbox custom: papel, filete, sin blur/sombra-glow (sombra funcional mínima permitida SOLO aquí si el overlay no se distingue: `0 12px 24px rgba(27,23,18,.15)` — única excepción documentada).
- [ ] **Step 2: UX móvil** (ya validada en prototipo): `resolver()` de Task 3 aplicado a marca (catálogo de marcas ya está client-side en `GuessForm`) y modelo (lista de la marca activa); `enterkeyhint`/`inputmode`/`autocapitalize=off`; Enter salta marca→modelo→año; al enviar: blur + scroll al veredicto/resultado (media <940px).
- [ ] **Step 3: Broadsheet**: grid-template-areas del prototipo (columna única móvil con orden foto→intentos→cupón; 2 col 940–1099; 3 col ≥1100 con filetes verticales). La "estadística del día" se monta en la columna izquierda REUTILIZANDO `dailyStats.jsx`, renderizada SOLO si `status !== "playing"` (gating del spec §3).
- [ ] **Step 4: Verificar** partida completa en preview a 375/768/1280px: orden móvil, prefijos, Enter, foco en campo faltante, broadsheet.
- [ ] **Step 5: Commit** — `design(f1): cupón de respuesta + pliego broadsheet + estadística gateada`

---

### Task 9: Pie de página + cierre de fase

**Files:**
- Modify: CSS `.cdd-footer`, `.cdd-foot-link` (filete superior, versalitas, countdown "CIERRE DE EDICIÓN EN hh:mm:ss" con `useCountdown` ya existente, Franklin + tabular-nums)
- Modify: `src/components/configurator/Configurator.jsx` (si el countdown no está ya en el footer del juego)

- [ ] **Step 1: Port del footer** según prototipo (sección "Pie de página").
- [ ] **Step 2: Suite completa** — `npx vitest run` → verde. Grep de seguridad: `grep -rn "theme-platino" src/components/configurator/` → solo referencias muertas pendientes de F5, ninguna activa en el juego.
- [ ] **Step 3: Revisión visual final de F1** — preview móvil (375), tablet (768), broadsheet (1280); `prefers-reduced-motion`; navegación por teclado con focus-ring (ya rojo vía `--accent`).
- [ ] **Step 4: Push** — el Preview de Vercel enseña la pantalla de juego portada (resto de la app aún oscura: esperado, no se mergea hasta F5). Avisar al usuario para revisión.

---

## Self-review (hecho al escribir)

- Cobertura del spec §2-§4 para el alcance F1: tokens (T2/T4), fuentes (T1), juego completo (T4–T9), gating estadística (T8), reglas duras (T4-T7), UX móvil (T8). EndScreen/modales/internas = F2–F4, fuera de este plan por diseño.
- Los pesos de Fraunces del `<link>` (T1) coinciden con los usos (400/600/900 + ital).
- `resolver()` firma única (T3) reutilizada en T8.
- Riesgo asumido y documentado: T4-T8 mapean variables antiguas → nuevas para reutilizar la capa `.cdd-*`; los selectores que el lenguaje elimina (glow/ámbar) quedan neutralizados vía variables, y F5 los borra físicamente.
