# Rediseño plano (v0) — Fase 4 · Garaje + Repesca · Plan

**Fecha:** 2026-06-16
**Rama:** `claude/flat-redesign-phase-1` (una rama; PR #34; merge único al final).
**Depende de:** `.modal-panel-flat` y `.scrim-flat` (Fase 1).

## Objetivo
Aplanar el Garaje (60 KB) y la página de Repesca. Sin cambios de lógica.

## Verificación de seguridad (regla 5) — hecha antes de tocar
El Garaje **no** oculta la identidad de coches con blur: los coches bloqueados usan `LockedCard`
(sin foto real); solo `UnlockedCard` muestra foto a color (coches ya ganados). Los 5
`backdrop-blur-sm` son **decorativos** (bandas de bandera de país/marca + chips de insignia), no
anti-spoiler. Por tanto aplanarlos no filtra nada.

## Cambios

### `src/components/Garage.jsx`
- Scrim principal del drawer (`scrim` con blur) → `scrim-flat` (1).
- Sub-modales de confirmación `modal-panel-glass` → `modal-panel-flat` (3, idénticos).
- `backdrop-blur-sm` decorativos eliminados (5): 2 capas `absolute inset-0` sobre bandas de
  bandera (la legibilidad ya la dan el gradiente oscuro + text-shadow) y 3 chips de insignia
  (completo / ✓ / veterano) que conservan su tinte `bg-accent/2x` / `bg-amber-500/20`.
- Los 3 `modal-scrim` ya planos → sin cambios.

### `src/Repesca.jsx`
- Header sticky `bg-bg-primary/90 backdrop-blur-glass` → `bg-bg-primary` sólido (1).

### `src/components/RepescaDrawAnimation.jsx`
- Sin cristal → sin cambios.

## Verificación
- `npm run build` verde · `npm run test:unit` (61/61) · Preview de Vercel.

## Hecho cuando
Garaje y Repesca planos; build/tests verdes; commits en el PR #34.
