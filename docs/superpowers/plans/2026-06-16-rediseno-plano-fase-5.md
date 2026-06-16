# Rediseño plano (v0) — Fase 5 · Cierre · Plan

**Fecha:** 2026-06-16
**Rama:** `claude/flat-redesign-phase-1` (una rama; PR #34; merge único al final).

## Objetivo
Cerrar el aplanado: flatten de los últimos restos de cristal detectados por auditoría + barrido de
CSS muerto. Privacidad ya estaba limpia (sin cristal).

## Stragglers aplanados (los cazó la auditoría final, no estaban en el mapa por fase)
- `src/components/ResultPanel.jsx`: `glass-strong` → `surface-flat` (resultado de Repesca).
- `src/components/Toast.jsx`: `bg-bg-tertiary/95 backdrop-blur-glass` → `bg-bg-tertiary` sólido
  (notificaciones, app-wide).
- `src/components/CarImage.jsx`: lightbox `scrim` → `scrim-flat`; 3 chips/botones decorativos
  pierden `backdrop-blur-sm` (etiqueta de pista, botón de zoom, botón de cerrar). **No** se tocan
  `<picture>`/`srcset`/`sizes` → regla 6 intacta.
- `src/components/HeaderSandwich.jsx`: header sticky `bg-[#0d0c0a]/90 backdrop-blur-xl` →
  `bg-bg-primary` sólido (usado por ResultPanel/Repesca).

## Barrido de CSS muerto (`src/index.css`, 1103 → 924 líneas)
Eliminadas las clases de cristal sin uso (0 referencias verificado): `.glass`, `.glass-strong`,
`.glass-panel`, `.glass-hover`, `.modal-panel-glass`, `.scrim` (con blur), `.spec`/`.spec::before`,
y la regla `@media (prefers-reduced-transparency){ .glass-panel,.modal-panel-glass }`. Eliminados
también los tokens huérfanos en ambos temas: `--mat-*`, `--edge`, `--spec`, `--elev-*`,
`--glow-accent`/`--glow-gold`.

**Conservado:** `.modal-scrim` (tinte sin blur, lo usan los modales aplanados), las primitivas
planas de la Fase 1, y `--line-strong`/`--gold-glow`/`--font-*`/`--ambient` (en uso).

> Cuidado tenido: un comentario-marcador con `--mat-*/` cerraba el comentario CSS antes de tiempo
> (`*/`) y rompía el build; reescrito sin esa secuencia (lección tipo regla 14).

## Fuera de alcance (intencionado)
`src/admin/SwapCarModal.jsx` conserva `backdrop-blur` — el panel admin (`/admin-tools`) es interno
y queda fuera del rediseño de cara al usuario.

## Verificación
- `npm run build` verde · `npm run test:unit` (61/61) · 0 cristal en toda la app de usuario.
- Regla 6: el diff de `CarImage.jsx` no toca `srcset`/`sizes`/`<picture>`.
- Revisión visual: Preview de Vercel.

## Hecho cuando
Cero cristal en la app de usuario; build/tests verdes; commits en el PR #34. **Rediseño "todo
aplanado" completo (Fases 1-5).**
