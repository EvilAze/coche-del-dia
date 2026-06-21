# "Racha en peligro" — notificación local personalizada (retención)

**Fecha:** 2026-06-21
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Contexto previo:** app Android Capacitor con notificación local diaria (v1) y
login Google nativo (v2 sub-1), ambos en producción.

## Objetivo

Convertir el recordatorio diario local en un nudge de **loss-aversion** para los
usuarios con racha: en vez del genérico "Hoy hay coche nuevo", mostrar
**"¡No pierdas tu racha de N días!"**. Es el camino barato del nudge de retención
(sub-2 de v2) que evita FCM/servidor: **la app ya conoce la racha** del usuario,
así que basta personalizar el copy de la notificación que ya programamos.

### Por qué local y no FCM
- La racha es un dato que la app ya tiene en cliente (`streak` de
  `useAuthSession`, que viene de `record_daily_result_v2`).
- "Racha en peligro" no necesita evento de servidor → **cero Firebase, cero
  tokens, cero cron**. (El nudge de "te adelantan en el ranking" sí necesitaría
  FCM y queda fuera de alcance — futura sub-2b.)

### Hecho clave del dominio
**Los usuarios anónimos NO tienen racha** en este sistema (App.jsx: el streak
solo se aplica con usuario logueado; `record_daily_result_v2` lo devuelve solo
para logueados). Por tanto el nudge es **inherentemente solo para logueados**, y
se gatea de forma natural por `streak >= umbral` (que es 0 para anónimos →
reciben el copy genérico de siempre).

## Alcance

**Incluye:** copy personalizado de racha en la notificación local diaria cuando
el logueado tiene racha activa (≥ 2 días). **No incluye:** FCM/push de servidor,
nudge de ranking, rachas anónimas (no existen), iOS.

## Arquitectura

Cambio mínimo sobre lo existente. El recordatorio local ya se programa con
`scheduleDailyReminder({ title, body })` / `rearmIfEnabled({ title, body })`
(`src/lib/notifications.js`). Solo cambiamos **qué copy** se pasa, según la racha.

```
streak (useAuthSession, App.jsx)
   │  cambia al loguear / tras terminar partida
   ▼
App.jsx useEffect (solo nativo)
   │  reminderCopy(t, tn, streak):  streak>=2 ? copy-racha : copy-genérico
   ▼
rearmIfEnabled({ title, body })  →  (re)programa la notif. diaria 10:00
```

## Unidades

### `src/lib/notifications.js` — sin cambios de API
Ya expone `rearmIfEnabled({title, body})`, `scheduleDailyReminder({title, body})`,
`REMINDER_HOUR`. No se toca.

### Selección de copy — `reminderCopy(t, tn, streak)`
Pequeña función pura que devuelve `{ title, body }`:
- `streak >= STREAK_NUDGE_MIN` (=2) → título `notif.streakReminderTitle`,
  cuerpo `tn("notif.streakReminderBody", streak, { count: streak })`.
- si no → genérico `notif.reminderTitle` / `notif.reminderBody` (como hoy).

Ubicación: `src/lib/reminderCopy.js` (función pura, testeable sin Capacitor;
recibe `t`/`tn` como args para no acoplarse al i18n global). Exporta también
`STREAK_NUDGE_MIN`.

### `src/App.jsx` — reprogramar al cambiar la racha
`useEffect` (solo si `isNative()`), dependencia `[streak]`:
```
rearmIfEnabled(reminderCopy(t, tn, streak))
```
Se dispara al montar (racha inicial, normalmente 0 → genérico), al cargar la
sesión (login trae la racha) y tras terminar una partida (sube la racha). Como
`rearmIfEnabled` solo programa si el permiso del SO está concedido y usa id fijo,
reprogramar es idempotente.

### `src/index.jsx` — baseline en el arranque (sin cambios funcionales)
El rearm de arranque sigue **genérico** (en ese punto aún no se conoce la racha).
El efecto de `App.jsx` lo "mejora" a personalizado en cuanto la racha está
disponible. (Opcional: podría usar `reminderCopy(t, tn, 0)` para no duplicar
literales; equivale al genérico.)

### i18n — `src/i18n/locales/es.json` y `en.json`
Añadir bajo `notif`:
- `streakReminderTitle`: es "¡Tu racha está en juego!" · en "Your streak is on the line!"
- `streakReminderBody`: con plural (`tn` busca `.one`/`.other`):
  - es `.one`: "No pierdas tu racha de {count} día. Adivina el coche de hoy."
  - es `.other`: "No pierdas tu racha de {count} días. Adivina el coche de hoy."
  - en `.one`: "Don't lose your {count}-day streak. Guess today's car."
  - en `.other`: "Don't lose your {count}-day streak. Guess today's car."

## Flujo de datos

1. Usuario logueado abre la app / termina partida → `streak` se actualiza.
2. `App.jsx` efecto (nativo) → `reminderCopy(t, tn, streak)` elige copy.
3. `rearmIfEnabled` reprograma la notif. diaria (10:00) con ese copy, si hay
   permiso.
4. Al día siguiente a las 10:00, el SO dispara: con racha ≥2 → "No pierdas tu
   racha de N días"; si no → genérico.

## Manejo de errores / edge cases
- **Web**: `isNative()` falso → el efecto no hace nada. Sin cambios en web.
- **Sin permiso de notificación**: `rearmIfEnabled` no-opea (ya lo hace).
- **Racha desconocida / 0 / anónimo**: copy genérico (umbral no alcanzado).
- **Racha = 1**: genérico (un día no es una racha digna de loss-aversion); el
  umbral `STREAK_NUDGE_MIN=2` lo cubre y es tuneable.
- **Jugó hoy pero la notif. salta igual**: el copy ("no pierdas tu racha")
  sigue siendo válido como recordatorio; aceptable (igual que el genérico v1).

## Testing
- **Unit (Vitest)**: `reminderCopy` — para `streak` 0/1 → genérico; `>=2` →
  título de racha y cuerpo con `{count}` y plural correcto. Se mockean `t`/`tn`
  con funciones que devuelven la key+args, verificando la selección (no el texto
  traducido).
- **Web/CI**: suites y `vite build` verdes; el efecto es native-gated → web
  intacto.
- **App (manual)**: con un usuario logueado con racha ≥2, comprobar (ajustando
  la hora del dispositivo cerca de las 10:00) que la notif. dice "No pierdas tu
  racha de N días".

## Fuera de alcance
FCM / push de servidor (nudge "te adelantan en el ranking") · rachas anónimas ·
iOS · cambiar la hora/cadencia del recordatorio.
