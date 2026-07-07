# Rediseño «Prensa del motor» — spec de port a producción

**Fecha:** 2026-07-07 · **Estado:** pendiente de aprobación
**Referencia visual (fuente de verdad):** `public/prensa-del-motor.html` (prototipo navegable; se elimina en la última fase)

## 1. Objetivo y alcance

Sustituir la dirección visual "Platino menta" (grafito + menta neón, estética v0/shadcn
que "canta a IA") por el sistema editorial **«Prensa del motor»**: imprenta a dos tintas
sobre papel, tipografía con carácter, jerarquía por filetes. El cambio es **solo de
piel**: cero cambios en API, datos, mecánica o reglas de seguridad (5/6/7 de CLAUDE.md).

**Dentro del alcance:** pantalla de juego, EndScreen, todos los modales, pantallas
internas (Garaje/Logros/Ranking/Perfil/Perfil público), repesca y túnel (re-skin del
flujo actual), toasts/errores/onboarding, activos de marca (OG, manifest, splash),
i18n es/en, app Capacitor (status bar/splash).

**Fuera del alcance (post-lanzamiento):**
- **Fe de erratas** (repesca con elección del jugador): cambio de PRODUCTO, PR propio.
- **Edición vespertina** (tema oscuro sepia): objetivo ≤3 semanas tras el lanzamiento.
- `/admin-tools` (interno, no lo ve ningún jugador).
- Las mejoras de cupón (prefijo inequívoco, Enter-salta) SÍ entran: son pequeñas y ya
  están diseñadas y probadas en el prototipo.

## 2. Sistema de diseño

### Paleta (tokens Tailwind nuevos; se retiran accent/mint/glass/glow)

| Token | Valor | Uso |
|---|---|---|
| `papel` | `#f3eee1` | fondo base |
| `papel-2` | `#e9e2cf` | fondo de apoyo (barras estadística, tintes) |
| `mat` | `#fbf7ec` | paspartú de la foto |
| `tinta` | `#1b1712` | texto, filetes, botón primario |
| `tinta-2` | `#6e6553` | secundario: pies, notas, labels |
| `rojo` | `#b3271b` | ÚNICO acento: veredictos, CTA hover, urgencia, fecha |
| `oro-viejo` | `#7a5c10` | SOLO texto premium (racha, podio, logros) sobre papel — AA |

Disciplina de dos tintas: **no existe el ámbar/warn** (la urgencia del último intento
es rojo). El oro premium actual (`#e8c87a`, pensado para fondo oscuro) se sustituye por
**oro viejo de tinta** `#7a5c10` (texto/filetes; nunca relleno) — mantiene la semántica
"esto es valioso" del CLAUDE.md sin romper contraste sobre papel.

### Tipografía (reemplaza Archivo/Space Mono/Sora)

- **Fraunces** (400/600/900 + italic): masthead, titulares, nombres de coches, pies.
- **Libre Franklin** (400/600/800): labels versalitas, botones, folio, UI.
- **Courier Prime** (400/700): lo que "escribe" el jugador (cupón), fichas, números.
- Carga vía `<link>` en `index.html` con preconnect (regla anti-FOUT ya documentada),
  `font-display: swap`, subsets latin. Riesgo LCP vigilado en QA (§7).

### Reglas duras

1. **Sin sombras, sin glow, sin blur, sin degradados.** Jerarquía = filetes (1px,
   `3px double`), blanco y tipografía.
2. **Esquinas vivas en todo** (`border-radius: 0`). Sin excepciones.
3. **Veredictos = marcas de corrector**: acierto → subrayado rojo firme + ✓; "cerca" →
   subrayado rojo discontinuo + apostilla cursiva; fallo → tachado en tinta al 55%.
4. La ventana de la foto es **4:3 SIEMPRE** en todos los breakpoints (regla 5/6: mismo
   recorte = misma dificultad). Marco: paspartú `mat` 8px + filete tinta 1px.
5. Animaciones: entrada "estampado" (opacity+scale 1.02→1, ~280ms), sello con
   overshoot, temblor de errata. Centralizadas en `tailwind.config.js`. Todas
   anuladas bajo `prefers-reduced-motion`.

### Decisiones cerradas (lo que desaparece)

- **Confetti → fuera.** La victoria la celebra el sello RESUELTO estampándose (+ haptic
  en app). El confetti es ajeno al lenguaje.
- **Crosshair y grain del HUD → fuera.** Eran atrezzo "cámara sci-fi" de la dirección
  anterior.
- **Shimmer pending → "entintado"**: barrido sutil de opacidad en tinta, sin brillo.
- **Voz del copy: «usted»**, registro de periódico clásico ("Rellene con letra clara",
  "Piénselo dos veces"). Es deliberado: es LA voz de la marca nueva. En inglés,
  registro de prensa anglosajona equivalente (sin "usted" artificial).

## 3. Layout

- **Móvil (<940px):** columna única, orden **foto → intentos → cupón → estadística**
  (validado en prototipo). Cabecera compacta; targets ≥44px; inputs 16px
  (`inputmode`/`enterkeyhint`/sin autocorrector); tras enviar: blur + scroll al
  veredicto (o al resultado si cierra).
- **940–1099px:** pliego a 2 columnas (foto | intentos+cupón), filete vertical.
- **≥1100px:** **broadsheet 3 columnas** — clasificación | foto | cupón — con filetes;
  contenedor `max-width: 1260px`. El shell actual de 480px desaparece en escritorio.
- La **estadística del día** (distribución de intentos que hoy vive en EndScreen vía
  `useDailyStats`) asciende a bloque visible en la columna izquierda del broadsheet /
  final de página en móvil, con barras de tinta y nota editorial. Misma fuente de
  datos, cero fetches nuevos: solo se muestra si la partida del día está cerrada
  (no chivar dificultad a quien aún juega — coherente con el gating actual).

## 4. Mapa de port por componente

| Actual | Tratamiento prensa |
|---|---|
| `Header.jsx` (wordmark+píldora) | Cabecera de periódico: topbar de enlaces versalitas, masthead Fraunces, folio con Nº de edición y fecha; racha en oro-viejo `✦` |
| `StageHud.jsx` | **Se elimina** (crosshair/grain fuera) |
| `ZoomStage.jsx` | Marco paspartú + filete; pie de foto en cursiva |
| `AttemptProgress.jsx` | Pips "fotogramas" (cuadraditos); urgencia solo en rojo |
| `AttemptRow/AttemptList` | Filas de clasificación numeradas (01…) con marcas de corrector; `useFitText` se conserva |
| `GuessForm/Combo/YearField` | El cupón: caja de doble filete, campos de línea base, entrada Courier; listbox custom re-skin papel; + prefijo inequívoco y Enter-salta; décadas/steppers re-skin |
| `PhotoPeek.jsx` | Miniatura con marco tinta (funcionalidad intacta) |
| `EndScreen.jsx` | Crónica + sello (RESUELTO rojo / SIN RESOLVER tinta / muro de suscripción anónimo con tachones); tabs ficha/compartir conservadas; percentil y distribución en estilo estadística; countdown "cierre de edición" |
| `dailyStats.jsx` | Barras de tinta + nota editorial (además del uso en columna, §3) |
| `Confetti.jsx` | **Se elimina** (sello como celebración) |
| `ShiftLights.jsx` | Confirmar sin usos tras la migración del túnel → **borrar** |
| `ModalShell` + modales | Panel papel con doble filete, scrim tinte tinta (sin blur, ya es así) |
| Garaje | Cromos como **fichas de archivo/recortes**: los ganados con foto y pie; los bloqueados con tachones de redacción |
| Ranking | Tabla de clasificación estilo "resultados" de periódico deportivo; podio con oro-viejo |
| Logros / MyStats / PublicProfile | Re-skin conservando estructura funcional (no se rediseña IA otra vez) |
| Repesca (`Repesca.jsx` + `ResultPanel`) | Re-skin mínimo del flujo ACTUAL (ruleta incluida); `ResultPanel` legacy muere y Repesca adopta el stack nuevo |
| Túnel | Re-skin (hereda automáticamente gran parte al compartir stack) |
| `Toast/ErrorFallback/LanguageStrip/NotificationOptIn` | Re-skin papel |
| `.focus-ring` | Pasa de menta a **rojo** (accesibilidad teclado intacta) |

**CSS:** reemplazo in situ de la capa `.cdd-*` en `index.css` (misma estructura de
clases donde el markup no cambia → menos churn en JSX); clases nuevas `prensa-*` solo
donde el markup sí cambia. Los tokens v0 (`mint`, `card`…) de `tailwind.config.js` se
retiran; grep final de tokens huérfanos como criterio de cierre.

## 5. Copy, i18n y lanzamiento

- Todos los strings nuevos vía `useT()` (`es.json`/`en.json`). Glosario clave:
  cupón de respuesta / answer coupon · clasificación / the standings · cierre de
  edición / final edition · edición gratuita / free edition · sello RESUELTO / SOLVED.
- **Nota de la redacción**: modal one-time en la primera visita post-lanzamiento
  (flag `localStorage`), tono de periódico anunciando su remodelación: "Nueva
  imprenta, mismo periódico. Su racha, su garaje y sus reglas siguen donde estaban."
- Texto de compartir: sin cambios (la rejilla ✅❌ funciona y es reconocible).

## 6. Marca, activos y app nativa

- **OG image** nueva (cabecera sobre papel) — crítica para el share.
- `manifest.json` `theme_color` → papel; `<meta name="theme-color">` ídem;
  favicon/iconos: se conservan (el cambio de iconos de app es otra guerra),
  `splash-car.jpg` se revisa sobre papel.
- Capacitor: StatusBar con iconos oscuros sobre claro; safe-areas ya resueltas
  (`.safe-area-pad`) — verificar sobre fondo claro en el emulador.
- `middleware.js`/`CarImage`: **cero cambios** de srcset/preload (regla 6). Solo estilos.

## 7. QA — criterios de aceptación (checklist de la última fase)

- [ ] Contraste AA en todos los pares (ojo: rojo sobre papel en cuerpos <14px, oro-viejo, tinta-2).
- [ ] Auditoría visual de ≥20 fotos aleatorias del catálogo sobre papel (bordes duros).
- [ ] LCP móvil sin regresión vs producción (fuentes: preload + swap + subsets).
- [ ] `prefers-reduced-motion` anula estampados/sellos/temblores.
- [ ] Navegación por teclado completa con focus-ring rojo.
- [ ] i18n: cero strings hardcodeados; `en` con voz propia revisada.
- [ ] `npm test` + `test:security`/`test:rls`/`test:attacks` verdes (no deberían ni
      inmutarse: no se toca server — si algo falla, algo hicimos mal).
- [ ] Grep de tokens retirados (`accent`, `mint`, `glow`, `glass`, `#7af0c8`) = 0 usos.
- [ ] Móvil real (Android WebView + navegador) y escritorio ≥1100 revisados a mano.
- [ ] Prototipo `public/prensa-del-motor.html` eliminado.

## 8. Fases (commits en esta rama; UN solo merge a producción)

1. **F1 — Cimientos + juego:** tokens/fuentes/`index.html`/`tailwind.config`, base
   `index.css`, pantalla de juego completa (Configurator y todos sus hijos).
2. **F2 — Fin de partida:** EndScreen (3 finales), estadística del día, Nota de la
   redacción (desactivada tras un flag hasta el merge).
3. **F3 — Modales y satélites:** ModalShell, HowToPlay, Scoring, Nickname,
   Achievements, toasts, ErrorFallback, onboarding.
4. **F4 — Internas:** Garaje, Logros, Ranking, MyStats, PublicProfile, Repesca
   (re-skin), Túnel.
5. **F5 — Marca + QA:** OG/manifest/theme-color/splash, i18n en, checklist §7,
   borrar prototipo y `Confetti/ShiftLights/StageHud` muertos.

Cada fase termina con push → revisión visual en el Preview de Vercel. El PR a `main`
se abre al completar F5 con la checklist en la descripción.

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| LCP por fuentes serif variables | subsets, preload del woff2 crítico, swap; medir en Preview |
| Fotos tratadas para oscuro se ven duras sobre papel | paspartú + filete; auditoría de 20 fotos en F1 — si >20% falla, se añade tratamiento CSS (leve bajada de contraste del marco) |
| El «usted» divide opiniones | es reversible por i18n sin tocar código; se valida con la nota de Reddit |
| Cansancio a mitad de port (app inconsistente) | fases en rama, un solo merge; nunca se despliega mezclado |
| Regresión funcional en re-skin de combos | los tests de lib no cubren UI: prueba manual guiada del cupón en F1 (móvil + teclado físico) |

**Rollback:** revert del merge. Sin migraciones, sin cambios de datos, sin envs nuevas.
