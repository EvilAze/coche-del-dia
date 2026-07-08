# Modo oscuro — «Edición de noche»

**Fecha:** 2026-07-09
**Estado:** Diseño aprobado, pendiente de plan de implementación.

## Problema

El rediseño «Prensa del motor» es papel claro (crema) en todo momento. De noche
resulta agresivo a la vista. Queremos un modo oscuro que **mantenga la identidad
editorial de periódico** (tinta + rojo de rotativa + oro viejo), con un **toggle
accesible de un toque**.

## Decisiones (cerradas en brainstorming)

1. **Paleta nocturna: «Grafito cálido»** — inversión del papel a un grafito casi
   negro con matiz cálido, para que siga leyéndose como "tinta sobre papel" pero
   de noche. (Descartadas: pizarra fría y sepia nocturno.)
2. **Arranque: seguir el sistema + memoria.** Primera visita usa
   `prefers-color-scheme`. Si el usuario pulsa el toggle, su elección se recuerda
   y prevalece sobre el sistema.
3. **Ubicación del toggle:** en la barra de secciones del header, tras `PERFIL ·`,
   pegado al margen derecho. Glifo luna (en día, invita a noche) / sol (en noche,
   vuelve a día).
4. **Alcance: toda la app** — juego + modales + chrome del navegador. Nada de
   modales en blanco cegador al abrirlos de noche.

## Hallazgo clave: dos sistemas de color

- **El juego** (`.prensa` / `.cdd-*` / `.prensa-*` / `.pm-*`) se pinta con CSS
  custom properties (`var(--bg)`, `var(--cdd-text)`, `var(--line-strong)`…),
  definidas hoy en el bloque `.prensa` de `src/index.css`.
- **Los modales** (Ranking, Perfil/MyStats, Garaje, Logros, HowTo, Nickname) usan
  **tokens de Tailwind** (`bg-background`, `text-muted-foreground`, `text-mint`,
  `border-border`, `font-display`…) que en `tailwind.config.js` son **hex fijos**.
- Además, hay **literales hardcodeados** en `src/index.css`: `#b3271b` (rojo) ×47,
  `#1b1712` (tinta) ×19, `#f3eee1` (papel) ×11, y las reglas base de `html/body`
  (`@layer base`) fijan `#f3eee1` / `#1b1712` a pelo.

Conclusión: un modo oscuro completo exige **unificar ambos sistemas sobre una
única fuente de verdad** (CSS variables) y tokenizar los literales.

## Arquitectura

### 1. Fuente de verdad única: CSS variables temáticas

- Definir la paleta en `:root` con los **valores de día actuales** (papel, tinta,
  rojo, oro, filetes, superficies).
- Sobreescribirla bajo `html[data-tema="noche"]` con la paleta grafito cálido.
- El bloque `.prensa` deja de fijar los **valores** de color localmente (para no
  ensombrecer el override de `:root[data-tema]`); conserva las fuentes
  (`--font-display/body/mono`) y las declaraciones que consumen las variables
  (`background: var(--bg)`, etc.). Los temas de admin (`.theme-platino` /
  `.theme-cobre`, usados solo en `PreviewPanel`) siguen fijando sus tokens
  localmente y quedan fuera del modo oscuro (no se tematizan).

Tokens (nombres orientativos; se consolidan en el plan):

| Token | Día (actual) | Noche (grafito cálido) |
|-------|--------------|------------------------|
| `--papel` (`--bg`) | `#f3eee1` | `#17130d` |
| `--papel-2` (`--bg2`) | `#e9e2cf` | `#211b12` |
| `--papel-mat` (`--surface`) | `#fbf7ec` | `#1e1a13` |
| `--tinta` (`--cdd-text`, `--line-strong`) | `#1b1712` | `#ece1cf` / filete `#b9ad97` |
| `--tinta-muted` (`--cdd-muted`) | `#6e6553` | `#9a8d76` |
| `--faint` | `rgba(110,101,83,.62)` | `rgba(154,141,118,.6)` |
| `--line` | `rgba(27,23,18,.25)` | `rgba(236,225,207,.14)` |
| `--rojo` (rotativa) | `#b3271b` | `#e0574a` (subido para AA) |
| `--oro` (`--gold`) | `#7a5c10` | `#d9b877` |

Nota: `--line-strong` en día es tinta plena `#1b1712`; en noche el filete fuerte
es `#b9ad97` (no la tinta clara pura), para que las dobles rayas del folio se
lean sin deslumbrar. Se afina en Preview.

### 2. Que ambos consumidores lean las variables

- **CSS del juego:** reemplazar los literales por tokens:
  `#b3271b → var(--rojo)`, `#1b1712 → var(--tinta)`, `#f3eee1 → var(--papel)`.
  Incluye las reglas base de `html/body` y `select option` en `@layer base`.
- **Tailwind:** en `tailwind.config.js`, apuntar cada color de la paleta a
  `var(--token, #hexDeDía)`. El **fallback hex de día garantiza cero regresión**
  en modo día aunque la variable no estuviera definida.

### 3. Controlador de tema — `src/lib/theme.js`

Módulo puro (patrón espejo de `src/i18n/index.js`):

- `resolveInitial()`: `localStorage['cdd-tema']` (`"dia"|"noche"`) si existe; si no,
  `matchMedia('(prefers-color-scheme: dark)')`.
- `applyTheme(tema)`: fija `document.documentElement.dataset.tema`,
  `document.documentElement.style.colorScheme` (`'dark'|'light'`) y actualiza el
  `<meta name="theme-color">` (grafito de noche, papel de día).
- `setTheme(tema)`: persiste en `localStorage` + `applyTheme` + notifica
  subscriptores.
- `toggleTheme()`: alterna día/noche.
- `useTheme()`: hook React (`{ tema, toggle }`) suscrito a los cambios.
- Listener de `prefers-color-scheme`: solo actúa mientras **no** haya override
  manual en `localStorage`.

### 4. Anti-flash (FOUC)

Snippet inline y síncrono en el `<head>` de `index.html` (antes de que React
monte) que lee `localStorage['cdd-tema']` / `matchMedia` y fija `data-tema` +
`color-scheme` en `document.documentElement`. Evita el fogonazo blanco al cargar
de noche. El `<meta name="theme-color">` inicial también se ajusta ahí.

### 5. Toggle en el header — `src/components/configurator/Header.jsx`

- Botón nuevo al final del grupo derecho de `.prensa-topbar`, tras `PERFIL`, con
  su `·` separador.
- Glifo `Icon` (trazo 1.6, `currentColor`): luna en día, sol en noche.
- Color `--cdd-muted` → `--rojo` en hover/activo (igual que el resto de enlaces).
- `aria-label` i18n ("Cambiar a edición de noche/día"), `aria-pressed`, área
  táctil 44px, `haptic.impactLight()`.
- **Ajuste de la barra:** cuando el glifo está presente, la fila (o el grupo
  derecho) alinea al **centro** en vez de a línea base, para que el icono case
  ópticamente con las versalitas (validado en mockup). No debe alterar el
  espaciado del separador ya pulido.

### 6. i18n

Nuevas claves en `es.json` / `en.json` para el `aria-label` del toggle (y, si se
decide etiqueta textual en algún sitio, su string). Sin hardcodear.

## Testing y verificación

- **Unit (Vitest):** `src/lib/theme.test.js` — `resolveInitial` (memoria vs
  sistema), `toggleTheme`, persistencia, que el listener del sistema se ignora
  con override manual. Mockear `localStorage` y `matchMedia`.
- **Regresión de día:** `npm test` verde; revisión visual de que el día queda
  idéntico (fallbacks hex de Tailwind + tokens = mismos colores).
- **Preview de Vercel (manual):** contraste AA de la paleta noche (tinta/muted/
  rojo/oro sobre grafito), ausencia de FOUC al recargar de noche, modales en
  oscuro, `theme-color` del chrome móvil, y el toggle bien situado en la barra.

## Fuera de alcance (YAGNI)

- Panel de ajustes: basta el glifo de un toque.
- Transición animada elaborada entre temas (a lo sumo un fundido corto de color,
  respetando `prefers-reduced-motion`).
- Tematizar rutas/legacy que no son «prensa» ni Tailwind-token (p. ej. panel de
  admin con `.theme-platino`): se quedan como están.
- Alterar la foto del coche (es contenido fotográfico; no se retiñe).

## Archivos afectados (previsión)

- `src/index.css` — `:root` (día) + `html[data-tema="noche"]` (noche); tokenizar
  literales; base `html/body`; ajuste de centrado de la topbar.
- `tailwind.config.js` — colores → `var(--token, #hexDía)`.
- `src/lib/theme.js` (nuevo) + `src/lib/theme.test.js` (nuevo).
- `src/components/configurator/Header.jsx` — botón toggle + alineado.
- `index.html` — snippet anti-FOUC + `theme-color`.
- `src/i18n/locales/es.json`, `en.json` — claves del toggle.
