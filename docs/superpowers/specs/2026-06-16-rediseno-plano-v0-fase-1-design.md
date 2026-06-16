# Rediseño plano (v0) — Fase 1: Base + Pantalla de juego

**Fecha:** 2026-06-16
**Rama:** `claude/flat-redesign-phase-1`, partiendo de **producción** (`origin/main` @ `b0911a1`,
que ya incluye el rate-limit PR #31 y el liquid glass mergeado en PR #32).
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Contexto

Se ha generado un nuevo diseño de la pantalla de juego con Vercel **v0** ("La Carrocería":
Next.js 16 + React 19 + TypeScript + Tailwind v4 + shadcn + `lucide-react` + `next/image`).
La app real ("El Motor") es Vite + React 18 + JSX + Tailwind v3 + framer-motion, con backend
Supabase, anti-cheat, i18n y zoom por-coche.

El v0 trae **datos hardcodeados y lógica simulada** (`game-data.ts` expone la respuesta en el
cliente y sirve la imagen completa — viola la **regla 5** de `CLAUDE.md`). Por tanto el v0 es
**solo una referencia visual**: se descarta su capa de datos y se conserva 100% la lógica real.

> **Nota de base (2026-06-16):** el liquid glass ya está **en producción** (PR #32 mergeado a
> `main`). Por instrucción del usuario, esta fase parte de producción (`origin/main`) y **olvida**
> las ramas/commits de cristal que no llegaron a producción. Los componentes de la pantalla de
> juego en producción son exactamente los explorados (los `.jsx` no difieren; solo varía algo de
> `index.css`).

### Decisión de dirección (acordada)
El destino es **"todo aplanado"**: retirar el estético *liquid glass* de toda la app y adoptar el
look **plano/v0** (superficies sólidas, bordes sutiles, sin blur). Por tamaño y riesgo, se ejecuta
**por fases**, cada una con su spec → plan → PR (un único *merge* por fase, regla 13):

| Fase | Contenido |
|---|---|
| **1 · Base + Juego** *(este spec)* | Tokens + primitivas planas **y** la pantalla de juego completa |
| 2 · Modales ligeros | ModalShell, Login, HowToPlay, Nickname, ScoringHelp, day-rollover |
| 3 · Social | Ranking, MyStats/Perfil, Logros |
| 4 · Garaje + Repesca | Garage (60 KB) + flujo de repesca |
| 5 · Cierre | Privacidad + barrido de CSS muerto (glass) |

La Fase 1 va primero porque **establece el sistema de diseño** (tokens + primitivas) que heredan
las fases 2-5.

### Estrategia de implementación (acordada): Enfoque C — Híbrido
1. Crear una **capa de tokens + primitivas planas** (`.btn`, `.input`, `.surface`, chrome de modal
   plano, celda de intento) que sustituyen al sistema de cristal **en la pantalla de juego**.
2. Adaptar cada componente del subárbol `configurator/` a esas primitivas, **editando JSX solo
   donde la estructura v0 difiere** (dots de progreso, "último intento" etiquetado, hero del
   resultado) y **conservando intactos los bloques de lógica** (anti-cheat, foco, haptics, aria).

## Objetivos

- Re-skin de la **pantalla de juego** (subárbol `src/components/configurator/` + `CarImage.jsx`)
  al look plano del v0.
- Nacimiento del **design system plano** reutilizable (tokens + primitivas) para las fases siguientes.
- **Cero cambios de lógica**: `useGame`, `/api/*`, hooks, i18n, zoom, anti-cheat, RLS → intactos.

## No-objetivos (fuera de alcance de la Fase 1)

- Modales (Ranking, Garaje, MyStats, Logros, Login, Nickname, HowTo, ScoringHelp, day-rollover),
  Repesca, Privacidad, Admin → **siguen con cristal** hasta sus fases.
- **No se borran** las clases `.glass*` / `.modal-panel-glass` / `--mat-*` todavía (las usan los
  modales). En la Fase 1 solo se **deja de usarlas en la pantalla de juego**.
- Sin cambios en la capa de datos/imagen ni en la seguridad (regla 5 preservada por construcción).

## Decisiones de detalle (acordadas)

1. **Sin HUD de cámara**: se retira el crosshair + grano de `StageHud` sobre la foto. Foto limpia
   en marco plano, fiel al v0.
2. **EndScreen rico con estilo plano**: se conserva TODO el contenido real (percentil, distribución,
   compartir nativo/clipboard, cromo→garaje, CTA de login anónimo, countdown) pero re-skineado a
   plano y adoptando el **hero + chip de resultado en oro** del v0.
3. **Formulario Marca/Modelo en 2 columnas** (como el v0); Año a ancho completo debajo; ADIVINAR
   a ancho completo.
4. **Desktop en dos columnas**: se conserva la adaptación actual (foto a la izquierda, panel de
   acción a la derecha), re-skineada a plano. Móvil: columna única.

## Sistema de diseño plano

### Tokens
Se **conserva la paleta grafito-frío + menta/oro** existente (`tailwind.config.js`): es la marca y
ya coincide con el acento del v0 (`#7af0c8` / `#e8c87a`). Lo que cambia es el **tratamiento de
superficie**, no los colores.

| Token / sistema | Antes (cristal) | Después (plano) |
|---|---|---|
| Superficie de panel | `.glass`/`.glass-strong` (translúcido + `backdrop-filter` blur + saturate) | sólida: `bg-secondary` (#14181e) / `bg-tertiary` (#1b212a) + borde 1px `--line` |
| Borde / canto | rim especular, glints cromáticos, `--edge`, sheen | borde plano 1px (`border` / `border-strong`) |
| Elevación | `--elev-*` + halo de acento | sombra plana suave o ninguna |
| Foco | `.focus-ring` (se conserva) | `.focus-ring` (sin cambios) |

> En la pantalla de juego, las variables `--mat-*` / `--edge` / `--elev-*` y las clases `.glass*`
> dejan de aplicarse. **No se eliminan del CSS** (los modales las usan hasta su fase).

### Primitivas nuevas (CSS, en `@layer components`/`utilities` de `index.css`)
Bocetos de intención (los valores finos se afinan en implementación, anclados al v0):

- `.btn` — base de botón plano (alto táctil ≥44px, `rounded-xl`, peso semibold).
  - `.btn--mint` — relleno menta sólido + texto tinta oscura (`mint-foreground`); estado
    `:active` con `scale(.98)`. Hereda el comportamiento del actual `.cdd-submit`.
  - `.btn--ghost` — borde/tinte sutil, sin relleno (CTA secundario; p.ej. "guardar progreso").
  - `.btn--icon` — botón de icono cuadrado (`size-9`, `rounded-lg`, `hover:bg` sutil).
- `.input` — campo plano: `bg-tertiary` + borde 1px, `placeholder` apagado,
  `focus:border-accent` + `focus-visible` ring de acento, estados `disabled`/`invalid`.
- `.surface` — card plana: `bg-secondary` + borde 1px + `rounded-2xl` (reemplaza `.glass-panel`
  en la pantalla de juego).
- `.attempt-cell` — celda de intento plana, tinte por estado (ver AttemptRow).
- Chrome de modal plano (`.modal-panel-flat` / scrim sin blur) — **se define aquí** para que las
  fases 2-4 lo hereden, aunque la Fase 1 aún no lo aplique a ningún modal.

## Cambios por componente (lógica preservada)

| Componente | Cambio visual | Lógica intacta |
|---|---|---|
| `configurator/Header.jsx` | Iconos planos (`.btn--icon`), píldora racha/puesto plana (racha=oro, puesto=menta), header sólido sin blur ni sticky-frost | todos los accesos (píldora→ranking, garaje+dot de repesca, perfil/login), i18n, haptics, pop de racha |
| `CarImage.jsx` + `configurator/ZoomStage.jsx` | Marco plano `rounded-2xl border bg-card`; **se retira el HUD** (`StageHud`) | pipeline AVIF/LQIP, `srcset`/`sizes` (coherencia con `middleware.js`, regla 6), zoom por-coche, anti-leak (regla 5), blur de derrota anónima, `onRevealLoad` |
| `configurator/StageHud.jsx` | **No se borra** (lo reutiliza `src/admin/PreviewPanel.jsx`, la "sala de pruebas"). Solo se deja de montar en `ZoomStage` (se quita `hud={<StageHud/>}` del juego) | — (el admin lo sigue usando tal cual) |
| `configurator/AttemptProgress.jsx` | Dots tipo v0 bajo la foto (usado=sólido, actual=menta con glow, restante=apagado) **conservando** la urgencia (actual ámbar a falta de 2, rojo pulsante en el último) | conteo exacto en `aria-label`, no se pinta al revelar |
| `Configurator.jsx` (`cdd-live-attempt`) | Etiqueta "ÚLTIMO INTENTO" (kicker) + fila, en la posición del v0 (entre foto y formulario) | shimmer pending, flip-reveal, `aria-live` |
| `configurator/GuessForm.jsx` | Layout v0: **Marca/Modelo en 2 columnas** + Año a ancho completo + ADIVINAR pleno; inputs planos | **anti-cheat completo** (filtros tried-wrong, modelo bloqueado sin marca válida), cadena de foco, carry-forward, `guessCarId`, validación de año, shake+toast+haptics |
| `configurator/Combo.jsx` | Input plano (`.input`) + caret; listbox plano `bg-secondary` + borde | filtrado sin acentos (`[̀-ͯ]`, regla 14), teclado, banderas por opción, auto-scroll móvil |
| `configurator/YearField.jsx` | Campo + steppers planos; chips de décadas planos | rango 1886..hoy, décadas, scroll-into-view móvil, `enterKeyHint` |
| `configurator/AttemptList.jsx` | Celdas planas tono-por-estado estilo v0 (good / near / off) | semántica `partial`+bandera "MISMO PAÍS", flecha ↑/↓ de año, `useFitText`, doble codificación color+icono, a11y |
| `configurator/EndScreen.jsx` | **Hero** (foto + degradado) + **chip de resultado en oro** ("ACERTADO · n/5") estilo v0; cuerpo plano; cromo→garaje como *notice* plano; resto de bloques (tabs ficha/compartir, grid, percentil, distribución, countdown) re-skineados a plano | compartir nativo/`clipboard`/legacy, `useCountdown`, percentil/distribución reales (`useDailyStats`), CTA login anónimo, confetti, `buildShareText` (espejo del grid, regla de sync) |
| `configurator/PhotoPeek.jsx` | Miniatura flotante plana | IntersectionObserver, scroll-back, blur cierre teclado |
| `Configurator.jsx` footer | Plano | enlaces (cómo se juega, privacidad), i18n |

## Archivos afectados (Fase 1)

- `src/index.css` — añadir tokens/primitivas planas; reescribir reglas `cdd-*` de la pantalla de
  juego (líneas ~416-1103) a plano. **Sin tocar** el bloque de cristal de los modales (~79-415,
  salvo añadir el chrome de modal plano para herencia futura).
- `tailwind.config.js` — sin cambios de color. **No** se tocan las sombras `glass*` (las usan los
  modales hasta sus fases). Solo se añadirán tokens/alias si alguna primitiva plana lo necesita.
- `src/components/configurator/*.jsx` — ediciones quirúrgicas de marcado/clases (ver tabla).
- `src/components/CarImage.jsx` — re-skin del marco + retirada del HUD (solo presentación).

## Verificación

1. `npm run build` — compila sin errores (Vite).
2. `npm run test:unit` (Vitest) — verde (lógica intacta).
3. `npm run test:security && npm run test:attacks && npm run test:rls` — verdes (no se toca
   server/RLS/anti-leak).
4. **Revisión visual en el Preview de Vercel** tras push a la rama `claude/…` (regla 12): pantalla
   de juego en móvil y desktop, partida completa (jugar → fallar → acertar/perder → EndScreen),
   estados de error del formulario, derrota anónima (foto difuminada).
5. Coherencia `middleware.js` ↔ `CarImage.jsx` del `srcset`/`sizes` (regla 6) — no debe cambiar.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Romper anti-cheat / foco / a11y al editar JSX | Enfoque C: editar solo marcado/clases, **no** los bloques de lógica; revisar diff por componente |
| Contraste temporal: juego plano ↔ modales cristal | Aceptado y acotado (regla de fases); se resuelve en Fases 2-4 |
| `StageHud` reutilizado por el admin | Verificar usos antes de retirarlo; si lo usa el admin, solo dejar de montarlo en el juego |
| Mojibake en CSS/regex (regla 14) | Mantener `[̀-ͯ]` escapado; asegurar UTF-8 al guardar |
| Doble descarga de imagen (regla 6) | No alterar `srcset`/`sizes` de `CarImage`/`middleware` |
| Regresión visual desktop (2 columnas) | Mantener la media query existente, solo re-skinear superficies |

## Definición de "hecho" (Fase 1)

- Pantalla de juego en look plano v0 (móvil 1 col / desktop 2 cols), sin cristal.
- Primitivas planas (`.btn`, `.input`, `.surface`, chrome de modal plano) disponibles para fases
  siguientes.
- Build + suites de tests verdes; Preview de Vercel revisado.
- PR `claude/flat-redesign-phase-1` → `main` listo para *merge* (un solo botón, regla 13).
