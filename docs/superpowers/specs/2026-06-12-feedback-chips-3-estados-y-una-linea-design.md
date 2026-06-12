# Diseño — Feedback de intentos: 3 estados claros + filas en una línea

**Fecha:** 2026-06-12
**Ámbito:** Pantalla de juego diario (`src/components/configurator/`)
**Estado:** Aprobado en brainstorming, pendiente de plan de implementación

---

## 1. Problema

En el juego diario, el feedback de cada intento (chips de marca / modelo / año) no
comunica con claridad cuándo un campo es **incorrecto**, y los nombres largos
**parten en dos líneas** dejando el historial alto y desigual.

Dos causas concretas, observadas en `configurator/AttemptList.jsx` + `index.css`:

1. **Un solo canal de señal: color de relleno.** El acierto es un chip de menta
   sólida; "mismo país" es un chip oscuro con un 10% de tinte menta + borde
   punteado + bandera; el **fallo es un chip gris apagado con texto *muted***. No
   hay icono (✓/✕) en marca/modelo —aunque `icons.jsx` ya los define— y el fallo
   no tiene **señal negativa** (ni rojo ni ✕): el ojo lo lee como *casilla vacía*,
   no como *"esto está mal"*. Además, "mismo país" y "fallo" son dos rectángulos
   oscuros casi idénticos a un vistazo en móvil.

2. **Wrapping de valores largos.** La rejilla de columnas es fija
   (`grid-template-columns: 1.1fr 1.4fr 1fr`) y el texto usa
   `-webkit-line-clamp: 2`. "Mercedes-Benz", "190E Evolution II" o "Chevrolet"
   no caben y parten en dos líneas → filas de altura irregular.

**No afecta a la lógica de juego ni al servidor:** es puramente presentación del
feedback que ya devuelve `api/validate-guess.js` (`status` + `direction`).

---

## 2. Objetivos y no-objetivos

### Objetivos
- Que **acierto / mismo país / fallo** se distingan a la primera, con doble
  codificación **color + icono** (accesible para daltonismo y vistazos rápidos).
- Que **cada intento ocupe una sola línea** por chip, con altura uniforme y sin
  recortar información.
- Reforzar la legibilidad del estado **"mismo país"** (el más críptico).
- Mantener el lenguaje visual premium (acento menta `#7af0c8` sobre oscuro) y
  reutilizar tokens existentes en vez de inventar colores nuevos.

### No-objetivos (fuera de alcance, anotados como futuro)
- **Repesca** (`src/Repesca.jsx` + legacy `GuessLog`/`GuessRow`): conserva su
  propio estilo de feedback. La inconsistencia diario↔repesca se aborda en otra
  tarea. **No tocar ni borrar los legacy** (siguen en uso).
- Las **dos pastillas de estado** apiladas en la esquina superior derecha
  (píldora del header vs HUD de intentos sobre la foto).
- **Sobrecarga del acento menta** (menta = acción + acierto + pip actual + rank).
- Cambios en steppers de año, décadas rápidas, PhotoPeek, EndScreen, etc.

---

## 3. Decisiones (cerradas en brainstorming)

| Tema | Decisión |
|------|----------|
| Lenguaje de color | Opción 1: **menta = acierto** (ya es el acento), **rojo sobrio = fallo**, cobre/menta-tinte = mismo país. Sin semáforo chillón. |
| Intensidad del rojo | "Tal cual" el ladrillo apagado mostrado. Base = el rojo de los pips. |
| Año fallado | **En rojo**, coherente con marca/modelo (decisión explícita del usuario). |
| Mismo país | **Incluido** en esta tarea: reforzar su legibilidad. |
| Una línea | **Opción A — auto-ajuste de texto (shrink-to-fit)**. Columnas fijas y alineadas; el texto largo se encoge hasta un mínimo legible. Sin recortes, sin `…`. |

---

## 4. Diseño detallado

### 4.1. Tokens de color (`src/index.css`)

Reutilizar el rojo ya presente en los pips gastados
(`.cdd-pip.spent { background: rgba(226,96,96,.8) }`, es decir `#e26060`) como
base del estado de fallo. Definir en **ambos temas** (`.theme-platino` y
`.theme-cobre`), junto a los demás tokens:

```css
/* Fallo: rojo sobrio, mismo tono que el pip gastado. Tinte oscuro para chip,
   versión clara para el icono ✕ (contraste sobre el chip rojo apagado). */
--bad: #e26060;
--bad-ink: #f0a39c;   /* trazo del ✕ y flecha de año fallado */
--bad-sub: #d98b83;   /* subtexto "MÁS NUEVO/ANTIGUO" en chip rojo */
```

(En `.theme-cobre` se pueden afinar a un rojo levemente más cálido si el QA
visual lo pide; arrancar con los mismos valores.)

### 4.2. Estados del chip (matriz)

Mapeo desde el `status` real del servidor (`correct` / `partial` / `wrong`) +
`direction` (`up`/`down`) al chip. `partial` solo lo emite la celda **marca**.

| Campo | correct | partial (mismo país) | wrong |
|-------|---------|----------------------|-------|
| **Marca** | menta sólida + **✓** | tinte menta + borde punteado + **bandera** + "MISMO PAÍS" | rojo + **✕** |
| **Modelo** | menta sólida + **✓** | — (no aplica) | rojo + **✕** |
| **Año** | menta sólida + **✓** + "±tol" | — (no aplica) | rojo + **flecha ↑/↓** + "MÁS NUEVO/ANTIGUO" |

- El **✓** (`I.check`) y la **✕** (`I.x`) salen de `configurator/icons.jsx` (ya
  existen). El **✓** va en `--accent-ink` (oscuro sobre menta); la **✕** y la
  **flecha de año** en `--bad-ink`.
- El icono/marca vive en el slot derecho del chip (`cdd-chip-mark`), igual que
  hoy hace la flecha de año → una sola convención de posición.
- "Mismo país" mantiene `t("cdd.sameCountry")` = "MISMO PAÍS" y la bandera; el
  **refuerzo** consiste en: bandera ligeramente mayor y siempre visible (heroína
  del chip), caption "MISMO PAÍS" en menta, borde punteado menta. (Opcional, a
  validar en implementación: micro-pin de ubicación antes del caption.)

### 4.3. CSS de tonos (`src/index.css`, bloque `.tone-*`)

- `.tone-good`: sin cambios de fondo; añadir
  `.tone-good .cdd-chip-mark { color: var(--accent-ink); }` para el ✓.
- `.tone-near`: sin cambios estructurales (ya es el "casi"); asegurar que la
  bandera y el caption "MISMO PAÍS" se leen (refuerzo del 4.2).
- `.tone-off`: **cambia de gris a rojo**:
  ```css
  .tone-off {
    background: color-mix(in oklab, var(--bad) 15%, var(--surface));
    color: var(--cdd-text);                 /* texto BLANCO, no muted: el cambio clave */
    border: 1px solid color-mix(in oklab, var(--bad) 50%, var(--line));
  }
  .tone-off .cdd-chip-mark { color: var(--bad-ink); }
  .tone-off .cdd-chip-sub  { color: var(--bad-sub); }
  ```
  El paso de `--cdd-muted` a `--cdd-text` es lo que convierte el fallo de
  "casilla inactiva" en "esto está mal".

### 4.4. Una línea — auto-ajuste de texto (Opción A)

La fórmula pura de cálculo vive en `src/lib/fitText.js` (con su `fitText.test.js`
al lado, según convención de CLAUDE.md); el hook `src/hooks/useFitText.js` la
envuelve con `ResizeObserver` y la consume el `Chip` de `AttemptList.jsx` para el
**texto del nombre** (marca y modelo; el año es numérico corto y no lo necesita):

- El span de texto va con `white-space: nowrap; overflow: hidden;` y `flex: 1`.
- Cálculo **O(1)** por medición (sin bucle), en `fitText.js`: medido a tamaño
  máximo, `fontSize = clamp(min, max, max * clientWidth / scrollWidth)`.
  - `max` = tamaño base actual del chip (12.5px historial; el `cdd-live-attempt`
    usa su propio tamaño más compacto — el hook lee el tamaño base del nodo).
  - `min` = 10px (suelo legible). Si ni a 10px cabe (caso extremo), se acepta el
    `overflow: hidden` sin `…` (no debería ocurrir con el catálogo real).
- Recalcular con `ResizeObserver` sobre el contenedor (cambia el ancho de
  columna: rotación, resize, desktop↔móvil) y cuando cambie el valor.
- Guardas: si `clientWidth === 0` (primer paint antes de layout), no medir; el
  `ResizeObserver` dispara al quedar dispuesto.
- `prefers-reduced-motion`: no aplica (no hay animación nueva); el ajuste de
  tamaño es instantáneo.

Resultado: columnas fijas y **alineadas entre filas** (se conserva la lectura de
"tabla"), una sola línea por chip, los 2-3 nombres largos se ven un punto más
pequeños, **nunca** truncados.

### 4.5. Estructura de fila (sin cambios de layout)

Se mantiene `grid-template-columns` fijo y la cabecera. El año y el "mismo país"
siguen siendo chips de **dos renglones internos** (valor + caption), igual que
hoy; "una línea" se refiere a que el **nombre** no haga wrap, no a eliminar el
caption. La altura de la fila la fija el chip más alto (con caption) y los demás
se estiran (`align-items: stretch`), como ya ocurre.

---

## 5. Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `src/index.css` | Tokens `--bad/--bad-ink/--bad-sub` en ambos temas; `.tone-off` → rojo + texto claro; marcas de `.tone-good`/`.tone-off`. |
| `src/components/configurator/AttemptList.jsx` | Marca ✓/✕ en chips de marca y modelo; integrar `useFitText` en el texto del nombre; sr-only de estado por chip (a11y). |
| `src/lib/fitText.js` *(nuevo)* | Fórmula pura de tamaño O(1) (clamp `max * clientWidth/scrollWidth`). |
| `src/lib/fitText.test.js` *(nuevo)* | Test unitario de la fórmula (vitest, al lado). |
| `src/hooks/useFitText.js` *(nuevo)* | Hook que envuelve `fitText` con `ResizeObserver`. |

**No se tocan:** `Combo.jsx`, `YearField.jsx`, `GuessForm.jsx` (configurator),
`Header.jsx`, `StageHud.jsx`, ni nada de `Repesca.jsx`/legacy.

Aplica automáticamente también a la **"fila viva"** (`cdd-live-attempt` sobre el
formulario) y a la fila **pending** (shimmer, sin tono — se mantiene neutra).

---

## 6. Accesibilidad

- **Doble codificación** color + icono (✓/✕/bandera/flecha) — no se depende solo
  del color.
- Los iconos van `aria-hidden` (ya lo hace `<Icon>`); añadir un **sr-only** por
  chip con el estado explícito, p.ej. "Mercedes-Benz, incorrecto" / "Chevrolet,
  país correcto" / "1985, el real es más nuevo". (Hoy el estado no se anuncia.)
- Contraste: texto `--cdd-text` sobre `tone-off` (rojo al 15% sobre surface)
  cumple AA; verificar en QA.
- `prefers-reduced-motion`: sin cambios (flip-reveal existente se respeta).

---

## 7. Casos límite

- Catálogo aún sin cargar → no hay chips (sin cambios).
- Nombre extremadamente largo que no cabe ni a 10px → `overflow: hidden` sin
  `…` (degradación silenciosa; improbable con el catálogo real).
- Fila "pending" → permanece neutra con shimmer (no recibe tono ni iconos).
- Tablero con casi todo fallado → muchos chips rojos; es **deliberado** y
  coherente (decisión "año en rojo"). Los chips "mismo país" en menta-tinte
  rompen la monotonía.

---

## 8. Verificación

- **Manual (fuente de verdad):** el usuario revisa en su `vercel dev` (regla #12
  de CLAUDE.md). Casos: intento con marca/modelo/año fallidos (rojo + ✕/flecha),
  intento con "mismo país" (bandera + caption), intento ganador (menta + ✓),
  nombres largos ("Mercedes-Benz", "190E Evolution II") en una línea, móvil
  ≤360px y desktop, modo lectura reducida.
- **Unit:** `vitest` sobre la fórmula de `src/lib/fitText.js` (entrada
  `clientWidth/scrollWidth` + base + suelo → tamaño con clamp).
- `test:security` / `test:rls` / `test:attacks` no se ven afectados (sin cambios
  de servidor ni de datos).

---

## 9. Trabajo futuro (anotado, fuera de esta tarea)

1. **Consistencia diario ↔ repesca:** unificar el feedback de `Repesca.jsx`
   (legacy verde/rojo) con este nuevo sistema menta/rojo.
2. **Dos pastillas de estado** en la esquina superior derecha: diferenciar
   "temporada" (header) de "este intento" (HUD foto).
3. **Auditar la sobrecarga del acento menta** (reservarlo para menos usos).
