# "Racha en peligro" (notificación local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personalizar la notificación local diaria para que, si el usuario logueado tiene racha activa (≥2 días), use copy de loss-aversion ("¡No pierdas tu racha de N días!") en vez del genérico.

**Architecture:** Cambio mínimo y client-only. Una función pura `reminderCopy(t, tn, streak)` elige el copy; un `useEffect` en `App.jsx` (solo nativo) reprograma la notificación diaria existente (`rearmIfEnabled`) con ese copy cada vez que cambia `streak`. Sin Firebase, sin servidor: la app ya conoce la racha. Anónimos tienen racha 0 → genérico.

**Tech Stack:** React 18 + Vite, Capacitor `@capacitor/local-notifications` (ya integrado), i18n propio (`useT`/`tn`), Vitest.

**Decisiones fijadas:** umbral `STREAK_NUDGE_MIN=2` · copy vía i18n con plural (`.one/.other`) · solo logueados (anón=racha 0) · `notifications.js` sin cambios · `index.jsx` rearm de arranque sigue genérico.

**Spec:** `docs/superpowers/specs/2026-06-21-streak-at-risk-notification-design.md`

---

## Task 1: Strings i18n del recordatorio de racha

**Files:**
- Modify: `src/i18n/locales/es.json`
- Modify: `src/i18n/locales/en.json`

- [ ] **Step 1: Añadir las claves en `es.json`**

Dentro del bloque `"notif"`, tras `"reminderBody"`, añade (cuida la coma tras `reminderBody`):
```json
    "reminderBody": "Adivina el coche del día y mantén tu racha.",
    "streakReminderTitle": "¡Tu racha está en juego!",
    "streakReminderBody": {
      "one": "No pierdas tu racha de {count} día. Adivina el coche de hoy.",
      "other": "No pierdas tu racha de {count} días. Adivina el coche de hoy."
    }
```
(Es decir: a la línea existente `"reminderBody": "...mantén tu racha."` se le añade la coma final y, debajo, las dos claves nuevas.)

- [ ] **Step 2: Añadir las claves en `en.json`**

Dentro del bloque `"notif"`, tras `"reminderBody"`:
```json
    "reminderBody": "Guess the car of the day and keep your streak.",
    "streakReminderTitle": "Your streak is on the line!",
    "streakReminderBody": {
      "one": "Don't lose your {count}-day streak. Guess today's car.",
      "other": "Don't lose your {count}-day streak. Guess today's car."
    }
```

- [ ] **Step 3: Verificar JSON válido + claves presentes (UTF-8 OK)**

Run:
```bash
node -e "const es=require('./src/i18n/locales/es.json'),en=require('./src/i18n/locales/en.json'); console.log('es one:', es.notif.streakReminderBody.one); console.log('es title:', es.notif.streakReminderTitle); console.log('en other:', en.notif.streakReminderBody.other); console.log('OK')"
```
Expected: imprime los textos (con `¡`/tildes correctas) y `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "feat(notif): strings i18n del recordatorio de racha en peligro

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Selección de copy `reminderCopy()` (TDD)

**Files:**
- Create: `src/lib/reminderCopy.js`
- Test: `src/lib/reminderCopy.test.js`

- [ ] **Step 1: Escribir el test PRIMERO — `src/lib/reminderCopy.test.js`**

```js
// src/lib/reminderCopy.test.js
import { describe, it, expect } from "vitest";
import { reminderCopy, STREAK_NUDGE_MIN } from "./reminderCopy";

// Mocks de t/tn que devuelven la key (+ count) para verificar la SELECCIÓN
// de copy, no el texto traducido.
const t = (key) => key;
const tn = (key, count) => `${key}#${count}`;

describe("reminderCopy", () => {
  it("racha 0 (anónimo / sin racha) → copy genérico", () => {
    expect(reminderCopy(t, tn, 0)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha 1 (por debajo del umbral) → copy genérico", () => {
    expect(reminderCopy(t, tn, 1)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha >= umbral → copy de racha con el count", () => {
    expect(STREAK_NUDGE_MIN).toBe(2);
    expect(reminderCopy(t, tn, 5)).toEqual({
      title: "notif.streakReminderTitle",
      body: "notif.streakReminderBody#5",
    });
  });

  it("streak ausente/no numérico → genérico (defensivo)", () => {
    expect(reminderCopy(t, tn, undefined)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });
});
```

- [ ] **Step 2: Run test → FAIL (módulo no existe)**

Run: `npx vitest run src/lib/reminderCopy.test.js`
Expected: FAIL (`Cannot find module './reminderCopy'`).

- [ ] **Step 3: Crear `src/lib/reminderCopy.js`**

```js
// src/lib/reminderCopy.js
// Copy del recordatorio diario local según la racha del usuario. Para un
// logueado con racha activa (>= STREAK_NUDGE_MIN) usamos loss-aversion
// ("¡No pierdas tu racha de N días!"); si no, el copy genérico de siempre.
//
// Función PURA: recibe t/tn como argumentos en vez de importar el i18n global,
// así es testeable sin Capacitor ni el módulo i18n. Los usuarios anónimos
// tienen racha 0 en este sistema → siempre caen al copy genérico.

export const STREAK_NUDGE_MIN = 2;

export function reminderCopy(t, tn, streak = 0) {
  if (typeof streak === "number" && streak >= STREAK_NUDGE_MIN) {
    return {
      title: t("notif.streakReminderTitle"),
      body: tn("notif.streakReminderBody", streak, { count: streak }),
    };
  }
  return {
    title: t("notif.reminderTitle"),
    body: t("notif.reminderBody"),
  };
}
```

- [ ] **Step 4: Run test → PASS (4 tests)**

Run: `npx vitest run src/lib/reminderCopy.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminderCopy.js src/lib/reminderCopy.test.js
git commit -m "feat(notif): reminderCopy() elige copy genérico vs racha según streak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Reprogramar el recordatorio al cambiar la racha (`App.jsx`)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Añadir imports**

En la cabecera de imports de `src/App.jsx`, añade:
```js
import { isNative, rearmIfEnabled } from "./lib/notifications";
import { reminderCopy } from "./lib/reminderCopy";
```

- [ ] **Step 2: Destructurar `tn` de `useT()`**

Reemplaza (línea ~33):
```js
  const { t } = useT();
```
por:
```js
  const { t, tn } = useT();
```

- [ ] **Step 3: Añadir el efecto que reprograma con copy de racha**

Justo DESPUÉS del efecto que cierra el modal de login (el bloque
`useEffect(() => { if (user && activeModal === "login") closeModal(); }, [user, activeModal, closeModal]);`),
añade:
```js
  // Recordatorio "racha en peligro": cuando se conoce/actualiza la racha del
  // logueado (al loguear o tras terminar partida), reprogramamos la notificación
  // local diaria con copy personalizado (>=2 días → "no pierdas tu racha"; si no,
  // genérico). Solo nativo; rearmIfEnabled no-opea sin permiso del SO. Anónimos
  // tienen racha 0 → copy genérico.
  useEffect(() => {
    if (!isNative()) return;
    rearmIfEnabled(reminderCopy(t, tn, streak)).catch(() => {});
  }, [streak, t, tn]);
```

- [ ] **Step 4: Build + tests**

Run: `npx vite build 2>&1 | tail -3`
Expected: `built in ...`.
Run: `grep -n "reminderCopy\|rearmIfEnabled\|isNative" src/App.jsx`
Expected: los 2 imports + el uso dentro del efecto.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(notif): reprogramar el recordatorio con copy de racha al cambiar streak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Verificación final + PR

**Files:** (ninguno; verificación e integración)

- [ ] **Step 1: Suite completa verde**

Run: `npx vitest run && npm run test:security && npm run test:attacks`
Expected: 0 failed (incluye `src/lib/reminderCopy.test.js`).

- [ ] **Step 2: Build de producción**

Run: `npx vitest run && npx vite build 2>&1 | tail -3`
Expected: tests verdes + `built in ...`.

- [ ] **Step 3: Sync del build en android (para probar en el dispositivo)**

Run: `npm run cap:sync 2>&1 | tail -3`
Expected: `Sync finished`.

- [ ] **Step 4: Push y PR (claude/streak-risk-notification → main)**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(notif): nudge 'racha en peligro' en la notificación local" \
  --body "$(cat <<'EOF'
## Resumen
La notificación local diaria pasa a copy de loss-aversion para logueados con racha activa (≥2 días): **"¡No pierdas tu racha de N días!"** en vez del genérico "Hoy hay coche nuevo". Anónimos (racha 0) y rachas <2 → genérico, como hasta ahora.

**Sin Firebase, sin servidor, sin tokens** — la app ya conoce `streak` (de `useAuthSession`). Es el camino barato del nudge de retención (el de "te adelantan en el ranking" sí necesitaría FCM y queda fuera de alcance).

## Cambios
- `src/lib/reminderCopy.js` (+test): función pura que elige copy genérico vs racha según `streak` (umbral `STREAK_NUDGE_MIN=2`).
- `src/App.jsx`: `useEffect` (solo nativo) que reprograma la notif. diaria (`rearmIfEnabled`) con `reminderCopy(t, tn, streak)` al cambiar la racha.
- i18n: `notif.streakReminderTitle` + `notif.streakReminderBody` (plural `.one/.other`).

## Verificación
- `vitest` (incl. reminderCopy), `test:security`, `test:attacks`, `vite build` verdes.
- Web: sin cambios (todo native-gated por `isNative()`).
- App: probar en dispositivo con un usuario logueado con racha ≥2.

## Fuera de alcance
FCM / push de servidor (nudge de ranking) · rachas anónimas (no existen aquí) · iOS.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR creado. Avisar "listo para mergear".

---

## Notas de ejecución
- **Verificación web** por `vite build` + suites; la notificación real se prueba en dispositivo (no en Preview de Vercel). El efecto es native-gated → web intacto.
- `notifications.js` e `index.jsx` NO se tocan (el rearm de arranque sigue genérico; el efecto de `App.jsx` lo mejora cuando se conoce la racha).
- UTF-8 en los JSON (regla 14): `¡`, tildes correctas.
