# Rediseño plano (v0) — Fase 2 · Modales ligeros · Plan

**Fecha:** 2026-06-16
**Rama:** `claude/flat-redesign-phase-1` (decisión del usuario: una sola rama acumula todas las
fases; un único PR (#34) y un único merge al final). Fase 2 va encima de Fase 1.
**Depende de:** primitiva `.modal-panel-flat` creada en Fase 1.

## Objetivo
Aplanar el "chrome" de los **modales ligeros** sustituyendo el panel de cristal por la primitiva
plana. Sin cambios de lógica.

## Alcance (verificado por grep)
`modal-panel-glass` → `modal-panel-flat` en los 5 sitios de los modales ligeros:

| Archivo | Línea | Modal |
|---|---|---|
| `src/components/HowToPlayModal.jsx` | panelClassName | Cómo se juega |
| `src/components/NicknameModal.jsx` | panelClassName | Onboarding de nick |
| `src/components/ScoringHelpModal.jsx` | panelClassName | Ayuda de puntuación |
| `src/App.jsx` | Login (≈339) | Login Google |
| `src/App.jsx` | day-rollover (≈457) | Cambio de día |

**Fuera de alcance (siguen con cristal hasta sus fases):** Ranking, MyStats, AchievementsModal,
PublicProfile (Fase 3), Garage (Fase 4). NO se tocan sus `modal-panel-glass`.

## Notas
- `modal-scrim` ya es plano (solo tinte, sin blur) → no se toca.
- El interior de estos modales usa utilidades Tailwind ya planas (`bg-accent`, `text-white`,
  botón Google `bg-white`); los CTA son menta sólida → coherentes con la Fase 1. No se migran a
  `.btn` en esta fase (polish opcional futuro).

## Verificación
- `npm run build` verde.
- `npm run test:unit` verde (sin lógica tocada).
- Revisión visual en el Preview de Vercel (la rama actualiza el Preview al pushear).

## Hecho cuando
Los 5 modales ligeros renderizan plano; build/tests verdes; commits sobre `phase-1` empujados al
PR #34.
