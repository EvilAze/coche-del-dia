# Rediseño plano (v0) — Fase 3 · Social · Plan

**Fecha:** 2026-06-16
**Rama:** `claude/flat-redesign-phase-1` (una sola rama; PR #34 crece; merge único al final).
**Depende de:** primitiva `.modal-panel-flat` (Fase 1).

## Objetivo
Aplanar el chrome de las **pantallas de datos sociales** sustituyendo el panel de cristal por la
primitiva plana. Sin cambios de lógica.

## Hallazgo (auditoría)
Estas pantallas **ya son planas por dentro**: sus superficies usan tintes sutiles
(`bg-white/[0.03]`, `border-white/10`, gradientes hacia `#0d1014`, tintes de acento) — **sin
`backdrop-blur` ni `.glass`**. Por tanto **no hay rediseño**: solo se cambia el panel.

## Alcance (verificado por grep — 1 ocurrencia por archivo)
`modal-panel-glass` → `modal-panel-flat`:

| Archivo | Modal |
|---|---|
| `src/components/Ranking.jsx` | Ranking mensual |
| `src/components/MyStats.jsx` | Perfil / mis estadísticas |
| `src/components/AchievementsModal.jsx` | Logros |
| `src/components/PublicProfile.jsx` | Perfil público |

**Fuera de alcance:** Garage (Fase 4). `modal-scrim` ya plano (no se toca).

## Verificación
- `npm run build` verde · `npm run test:unit` verde · Preview de Vercel.

## Hecho cuando
Las 4 pantallas sociales renderizan con panel plano; build/tests verdes; commits en el PR #34.
