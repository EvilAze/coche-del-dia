# Entrada por código de 6 dígitos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el enlace mágico por un código de 6 cifras que funciona igual en web y en la app Android, instrumentar el embudo de login (que hoy no existe) y encadenar la oferta de la app para que ningún anónimo la instale perdiendo su racha.

**Architecture:** Todo el cambio vive en el cliente. `src/lib/auth.js` gana dos funciones (`pedirCodigo`, `verificarCodigo`) que envuelven `signInWithOtp`/`updateUser` y `verifyOtp`, arrastrando el `tipo` de token entre los dos pasos porque Supabase usa tokens distintos para el alta (`email`) y para la vinculación de un anónimo (`email_change`). `LoginModal` pasa de una cara a dos. La analítica se emite con el `track()` de Umami que ya existe, y el éxito se detecta en `useAuthSession`, que ya vigila las transiciones de sesión. El servidor NO se toca.

**Tech Stack:** React 18 + JSX (sin TypeScript), Vite 8, Supabase JS v2, Vitest (+ jsdom y @testing-library/react para los componentes), Umami para analítica, Capacitor para la app.

**Spec:** `docs/superpowers/specs/2026-08-27-login-codigo-6-digitos-design.md`

---

## Antes de empezar: contexto que no está en el código

**Reglas del repo que aplican a este plan** (`CLAUDE.md`):

- **Regla 10:** comentarios en español explicando el **porqué**, no el qué. El código de este repo documenta densamente los trade-offs. Un comentario que dice «incrementa el contador» sobra; uno que dice «60 s y no 30 porque el correo tarda» es el que hace falta.
- **Regla 16:** `npm run test:estetica` falla ante emoji en JSX o en cadenas de UI, paleta cruda de Tailwind (`amber-400`, `zinc-300`…), glows (`shadow-[0_0_…]`), hex sueltos en clases, esquinas redondeadas (`rounded-lg`…), sombras de catálogo (`shadow-md`…) y blanco/negro crudos (`bg-white`, `text-black`). Usa los tokens: `tinta`, `tinta-2`, `papel`, `papel-2`, `muted`, `rojo`/`accent`, `gold`, `border`. Y las clases del sistema: `pm-btn`, `pm-btn--ghost`, `pm-body`, `pm-kicker`, `pm-label`, `prensa-input`, `prensa-label`.
  `src/components/LoginModal.jsx` **ya tiene** una excepción registrada a la regla `blanco-negro` (la chapa de marca de Google). No añadas más.
- **Regla 14:** UTF-8. Nunca metas caracteres no-ASCII dentro de una *char-class* de regex; usa la forma escapada.
- **Regla 12/13:** no levantes servidores locales. La verificación es el Preview de Vercel.

**Cómo se ejecutan los tests:**

```bash
npx vitest run src/lib/auth.test.js
```

Los ficheros que necesitan DOM llevan el pragma `// @vitest-environment jsdom` en la primera línea (ver `src/components/FaldonApp.test.jsx`). Los de `src/lib/` corren en node.

**El patrón de mocks de `auth.test.js`** es `vi.doMock` + `vi.resetModules()` + `await import(...)`, porque `src/lib/auth.js` importa `supabase` a nivel de módulo y hay que interceptarlo antes de evaluarlo. No lo cambies.

**Orden de las tareas.** Las tareas 1–3 son la base (auth + textos) y las 4–5 dependen de ellas. Las 6–7 (analítica) y 8–10 (derivación) son independientes entre sí. La 11 es documentación. La 12 cierra.

---

## Estructura de ficheros

| Fichero | Qué le pasa | Responsabilidad tras el cambio |
|---|---|---|
| `src/lib/auth.js` | Modificar | Único sitio que sabe qué llamada de Supabase toca en cada plataforma y en cada estado de sesión. Gana `pedirCodigo`, `verificarCodigo`, `marcarLoginEnCurso`, `leerLoginEnCurso`. Pierde `signInWithEmail`. |
| `src/lib/auth.test.js` | Modificar | Cobertura de lo anterior. Un test existente se **invierte** (tarea 1). |
| `src/components/LoginModal.jsx` | Modificar | La puerta de entrada, ahora en dos pasos. Sigue sin lógica de negocio: llama a `lib/auth`. |
| `src/components/LoginModal.test.jsx` | **Crear** | El recorrido de los dos pasos y que el `tipo` viaja intacto. |
| `src/i18n/locales/es.json` · `en.json` | Modificar | Textos. Paridad obligatoria (`src/i18n/locales.test.js`). |
| `src/hooks/useAuthSession.js` | Modificar | Ya vigila las transiciones de sesión; ahora además emite `login_success`. |
| `src/lib/analytics.js` | Modificar | Solo el bloque de convención de la cabecera. `track()` no cambia. |
| `src/App.jsx` | Modificar | `openLogin(surface)` acepta y guarda la superficie de origen. |
| `src/components/{Ranking,Garage,SumarioModal}.jsx`, `src/components/configurator/EndScreen.jsx` | Modificar | Cada llamador dice de dónde viene. |
| `src/lib/edicionApp.js` | Modificar | Gana `momentoDeFaldon()` y las gemelas de descarte del faldón de registro. |
| `src/lib/edicionApp.test.js` | Modificar | Cobertura de lo anterior. |
| `src/components/FaldonApp.jsx` | Modificar | Dos caras según haya cuenta o no. |
| `src/components/FaldonApp.test.jsx` | Modificar | Los tests existentes **necesitan `user`** ahora (ver tarea 8). |
| `src/components/MyStats.jsx` | Modificar | Le falta el evento de impresión de la puerta de la app. |
| `docs/correo-de-entrada.md` | Reescribir | Las **dos** plantillas, no una. |
| `android/app/build.gradle` | Modificar | `versionCode` 56 / `versionName` 1.10.0 (tarea 12). |

---

## Task 1: `emailLoginDisponible()` deja de excluir la app

El motivo por el que estaba apagado en nativo (el enlace del correo abre el navegador del sistema y la sesión nace fuera del WebView) desaparece cuando no hay enlace, solo un código que se teclea dentro de la pantalla.

**Files:**
- Modify: `src/lib/auth.js:118-121`
- Test: `src/lib/auth.test.js:105-110`

- [ ] **Step 1: Invertir el test existente**

En `src/lib/auth.test.js`, **reemplaza** este test entero (el comentario incluido):

```js
  // En nativo el enlace abriría el navegador del sistema y la sesión nacería
  // FUERA del WebView de la app. Apagado aunque el flag esté puesto.
  it("email: en nativo queda apagado aunque el flag esté encendido", async () => {
    setup({ isNative: true, emailLogin: "true" });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(false);
  });
```

por:

```js
  // ANTES estaba apagado en nativo porque el enlace del correo abría el
  // navegador del sistema y la sesión nacía FUERA del WebView. Con el código de
  // 6 cifras no se sale de la pantalla, así que el motivo caducó: la app es
  // justo donde más falta hace un segundo método, porque allí Google es el
  // único que hay.
  it("email: en nativo también está disponible (el código no sale de la app)", async () => {
    setup({ isNative: true, emailLogin: "true" });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(true);
  });

  it("email: en nativo sigue respetando el flag apagado", async () => {
    setup({ isNative: true });
    const { emailLoginDisponible } = await import("./auth");
    expect(emailLoginDisponible()).toBe(false);
  });
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run src/lib/auth.test.js -t "en nativo también está disponible"`
Expected: FAIL — `expected false to be true`.

- [ ] **Step 3: Implementar**

En `src/lib/auth.js`, sustituye la función `emailLoginDisponible()` y su bloque de comentario por:

```js
/**
 * ¿Está disponible la entrada por correo (código de 6 cifras)?
 *
 * Detrás de un flag A PROPÓSITO: sin SMTP propio, el email integrado de
 * Supabase va limitado a 2 correos/hora en TODO el proyecto, y una puerta de
 * entrada que falla es peor que no tenerla. Se enciende solo tras configurar
 * SMTP (hoy, Resend — ver docs/correo-de-entrada.md).
 *
 * EN NATIVO YA NO SE EXCLUYE. Mientras el método era un enlace, en la app
 * estaba apagado porque el enlace abría el navegador del sistema y la sesión
 * nacía FUERA del WebView. Un código se teclea donde estás, así que ese motivo
 * caducó — y la app es justo donde más falta hace, porque allí Google era el
 * único camino que había.
 */
export function emailLoginDisponible() {
  return import.meta.env.VITE_EMAIL_LOGIN === "true";
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/auth.test.js`
Expected: PASS, todos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.js src/lib/auth.test.js
git commit -m "feat(auth): la entrada por correo deja de estar apagada en la app"
```

---

## Task 2: `pedirCodigo` y `verificarCodigo`

El corazón del cambio. `pedirCodigo` devuelve el **tipo de token** además del error, y ese tipo es lo que `verificarCodigo` necesita: Supabase emite un token de tipo `email` para un alta o entrada normal y uno de tipo `email_change` cuando un anónimo adjunta su correo con `updateUser`. Confundirlos produce «código incorrecto» para el 100% de uno de los dos caminos.

**Files:**
- Modify: `src/lib/auth.js` (sustituye `signInWithEmail`)
- Test: `src/lib/auth.test.js`

- [ ] **Step 1: Añadir `verifyOtp` al mock de Supabase**

En `src/lib/auth.test.js`, dentro de `setup()`, añade el espía junto a los demás (después de la línea de `updateUser`):

```js
  const verifyOtp = vi.fn().mockResolvedValue({ data: { session: {} }, error: null });
```

Añádelo al objeto `auth` del `vi.doMock("../supabaseClient", ...)`:

```js
        signInWithOAuth, signInWithOtp, signOut: signOutSb,
        getSession, signInAnonymously, linkIdentity, updateUser, verifyOtp,
```

Y al `return` de `setup()`:

```js
    signInWithOAuth, signInWithOtp, signOutSb, nativeGoogleSignIn, nativeSignOut,
    getSession, signInAnonymously, linkIdentity, updateUser, verifyOtp,
```

- [ ] **Step 2: Escribir los tests que fallan**

En `src/lib/auth.test.js` hay **CUATRO** tests que llaman a `signInWithEmail`, no dos. Bórralos todos — al desaparecer la función, cualquiera que quede lanza `TypeError`:

1. `"email: signInWithEmail pide OTP creando usuario y vuelve al origen"`
2. `"email: sin window, el redirect queda undefined en vez de reventar"` — sin reemplazo a propósito: la rama de `emailRedirectTo`/`window` deja de existir.
3. `"Correo: con sesión anónima adjunta el email a esa cuenta"` — dentro de `describe("vincular identidad sobre una sesión anónima")`. Su cobertura pasa al test 3 de abajo, que asserta lo mismo Y el `tipo`.
4. `"Correo: si el email ya es de otra cuenta, cae al enlace normal"` — mismo `describe`. Su cobertura pasa al test 4 de abajo.

Deja un comentario en el sitio de los dos últimos diciendo dónde vive ahora esa cobertura: quien lea ese `describe` buscando el caso del correo tiene que encontrarlo.

En el lugar de los dos primeros, pon:

```js
  // ── Código de 6 cifras ───────────────────────────────────────────────────
  // El `tipo` que devuelve pedirCodigo NO es informativo: verifyOtp lo exige y
  // son dos tokens distintos. Si se calculara otra vez en el paso 2, entre
  // medias la sesión podría haber cambiado y el código válido se rechazaría.
  it("código: sin sesión anónima pide OTP creando usuario, y el tipo es 'email'", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: null });
    const { pedirCodigo } = await import("./auth");
    const res = await pedirCodigo("piloto@ejemplo.com");
    expect(m.signInWithOtp).toHaveBeenCalledWith({
      email: "piloto@ejemplo.com",
      options: { shouldCreateUser: true },
    });
    expect(res).toEqual({ error: null, tipo: "email" });
  });

  // Sin enlace en el correo, emailRedirectTo no tiene consumidor: mandarlo
  // sería declarar un destino al que ya no vuelve nadie.
  it("código: no manda emailRedirectTo (ya no hay enlace al que volver)", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: null });
    const { pedirCodigo } = await import("./auth");
    await pedirCodigo("piloto@ejemplo.com");
    expect(m.signInWithOtp.mock.calls[0][0].options).not.toHaveProperty("emailRedirectTo");
  });

  it("código: con sesión anónima ADJUNTA el correo y el tipo es 'email_change'", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: "anon" });
    const { pedirCodigo } = await import("./auth");
    const res = await pedirCodigo("piloto@ejemplo.com");
    expect(m.updateUser).toHaveBeenCalledWith({ email: "piloto@ejemplo.com" });
    expect(m.signInWithOtp).not.toHaveBeenCalled();
    expect(res).toEqual({ error: null, tipo: "email_change" });
  });

  // El correo ya pertenece a otra cuenta: la vinculación no tiene arreglo (son
  // dos cuentas distintas), así que se entra a la que ya existe. Se pierde el
  // progreso anónimo de este dispositivo, que es inevitable.
  it("código: si adjuntar el correo falla, cae a OTP normal y el tipo cambia a 'email'", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: "anon", linkFalla: true });
    const { pedirCodigo } = await import("./auth");
    const res = await pedirCodigo("piloto@ejemplo.com");
    expect(m.updateUser).toHaveBeenCalledTimes(1);
    expect(m.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(res.tipo).toBe("email");
  });

  it("código: el error de Supabase se devuelve, no se traga", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: null });
    m.signInWithOtp.mockResolvedValueOnce({ data: null, error: { status: 429, message: "rate limit" } });
    const { pedirCodigo } = await import("./auth");
    const res = await pedirCodigo("piloto@ejemplo.com");
    expect(res.error).toEqual({ status: 429, message: "rate limit" });
    expect(res.tipo).toBe("email");
  });

  it("verificarCodigo pasa el tipo que recibe, sin recalcularlo", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: "anon" });
    const { verificarCodigo } = await import("./auth");
    await verificarCodigo("piloto@ejemplo.com", "123456", "email_change");
    expect(m.verifyOtp).toHaveBeenCalledWith({
      email: "piloto@ejemplo.com",
      token: "123456",
      type: "email_change",
    });
  });

  it("verificarCodigo con tipo 'email' llama a verifyOtp con ese tipo", async () => {
    const m = setup({ isNative: false, emailLogin: "true", sesion: null });
    const { verificarCodigo } = await import("./auth");
    await verificarCodigo("piloto@ejemplo.com", "654321", "email");
    expect(m.verifyOtp).toHaveBeenCalledWith({
      email: "piloto@ejemplo.com",
      token: "654321",
      type: "email",
    });
  });
```

- [ ] **Step 3: Ejecutar para verificar que fallan**

Run: `npx vitest run src/lib/auth.test.js`
Expected: FAIL — los siete nuevos, con `No "pedirCodigo" export is defined on the mock` o `pedirCodigo is not a function`.

- [ ] **Step 4: Implementar**

En `src/lib/auth.js`, **borra la función `signInWithEmail` entera** (con su bloque de comentario) y pon en su lugar:

```js
/**
 * PASO 1 — pide un código de 6 cifras al correo.
 *
 * Devuelve `{ error, tipo }`. El `tipo` no es decoración: `verifyOtp` lo exige
 * y son DOS TOKENS DISTINTOS.
 *
 *   - Sin sesión anónima → `signInWithOtp` → token de tipo `email`.
 *   - Con sesión anónima → `updateUser({ email })`, que ADJUNTA el correo a la
 *     cuenta que ya existe (mismo user id → la racha, las estadísticas y el
 *     Archivo sobreviven) → token de tipo `email_change`.
 *
 * Por eso el tipo viaja hasta el paso 2 en vez de recalcularse allí: entre los
 * dos pasos pueden pasar minutos, y si la sesión cambiara de estado por el
 * camino recalcularlo rechazaría un código perfectamente válido.
 *
 * `shouldCreateUser: true` a propósito: para un juego diario, distinguir
 * «registro» de «acceso» es una diferencia que solo le importa a la base de
 * datos. Pones tu correo y entras.
 */
export async function pedirCodigo(email) {
  if (await sesionAnonimaVigente()) {
    const res = await supabase.auth.updateUser({ email });
    if (!res?.error) return { error: null, tipo: "email_change" };
    // El correo ya pertenece a otra cuenta. No tiene arreglo por vinculación:
    // son dos cuentas distintas y hay que entrar a la que ya existe, a costa
    // del progreso anónimo de este dispositivo.
    console.warn("[auth] adjuntar el correo falló, pidiendo código normal:", res.error.message);
  }

  const res = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return { error: res?.error ?? null, tipo: "email" };
}

/**
 * PASO 2 — canjea el código por una sesión.
 *
 * No decide el `tipo`: se lo da quien llamó a `pedirCodigo`. Ver allí el
 * porqué. Devuelve `{ data, error }` estilo Supabase; la sesión, si sale bien,
 * la recoge `onAuthStateChange` (useAuthSession) como cualquier otra.
 */
export async function verificarCodigo(email, codigo, tipo) {
  return supabase.auth.verifyOtp({ email, token: codigo, type: tipo });
}
```

- [ ] **Step 5: Verificar que pasan**

Run: `npx vitest run src/lib/auth.test.js`
Expected: PASS, todos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.js src/lib/auth.test.js
git commit -m "feat(auth): pedirCodigo/verificarCodigo — OTP de 6 cifras con su tipo de token"
```

---

## Task 3: Los textos

El test `src/i18n/locales.test.js` exige que `es.json` y `en.json` tengan **exactamente** las mismas rutas de claves. Si añades en uno y olvidas el otro, falla — que es justo para lo que existe.

**Files:**
- Modify: `src/i18n/locales/es.json:36-44`, `:53-57`
- Modify: `src/i18n/locales/en.json:36-44`, `:53-57`

- [ ] **Step 1: Reemplazar el bloque de correo en `es.json`**

Sustituye las líneas 36–44 de `src/i18n/locales/es.json` (desde `"emailCta"` hasta `"emailSentHint"`, ambas incluidas) por:

```json
    "emailCta": "Enviarme un código",
    "emailSending": "Enviando…",
    "emailNoPassword": "Sin contraseña: te llega un código de 6 cifras.",
    "emailInvalid": "Revisa el correo, no parece válido.",
    "emailError": "No se pudo enviar el código. Inténtalo de nuevo.",
    "emailRateLimited": "Demasiadas peticiones. Espera unos minutos y vuelve a intentarlo.",
    "codeTitle": "REVISA TU CORREO",
    "codeBody": "Te hemos enviado un código de 6 cifras a {email}.",
    "codeLabel": "Código",
    "codePlaceholder": "000000",
    "codeCta": "Entrar",
    "codeVerifying": "Comprobando…",
    "codeInvalid": "Ese código no es correcto. Revísalo y vuelve a escribirlo.",
    "codeExpired": "El código ha caducado. Pide otro y te llega uno nuevo.",
    "codeNetwork": "No hemos podido comprobarlo. Revisa la conexión y vuelve a intentarlo.",
    "codeResend": "Enviar otro código",
    "codeResendWait": "Puedes pedir otro en {seconds} s",
    "codeChangeEmail": "Usar otro correo",
    "codeSpamHint": "Si no lo ves, mira en spam. Caduca en una hora.",
```

**Nota (corrección a la spec):** la spec decía retirar `emailNoPassword`. Se **conserva** porque sigue teniendo consumidor (el renglón bajo el botón del paso 1); solo cambia el texto. Las que sí desaparecen son `emailSentTitle`, `emailSentBody` y `emailSentHint`.

- [ ] **Step 2: Añadir el faldón de registro en `es.json`**

Sustituye la línea 57 de `src/i18n/locales/es.json` (`"promoDoor": "Edición Android"`, la última del bloque `app`, sin coma final) por:

```json
    "promoDoor": "Edición Android",
    "promoAccountTitle": "Antes de mudarte",
    "promoAccountBody": {
      "one": "Tu racha de {count} día vive en este navegador. Sin cuenta no viaja al móvil: en la app empezarías de cero.",
      "other": "Tu racha de {count} días vive en este navegador. Sin cuenta no viaja al móvil: en la app empezarías de cero."
    },
    "promoAccountBodyPlain": "Tu progreso vive en este navegador. Con cuenta te sigue al móvil, a la app y a cualquier otro dispositivo.",
    "promoAccountCta": "Crear mi cuenta",
    "promoAccountDecline": "Ahora no"
```

- [ ] **Step 3: Los mismos dos bloques en `en.json`**

Sustituye las líneas 36–44 de `src/i18n/locales/en.json` por:

```json
    "emailCta": "Send me a code",
    "emailSending": "Sending…",
    "emailNoPassword": "No password: we send you a 6-digit code.",
    "emailInvalid": "That email doesn't look right.",
    "emailError": "Couldn't send the code. Please try again.",
    "emailRateLimited": "Too many requests. Wait a few minutes and try again.",
    "codeTitle": "CHECK YOUR EMAIL",
    "codeBody": "We sent a 6-digit code to {email}.",
    "codeLabel": "Code",
    "codePlaceholder": "000000",
    "codeCta": "Sign in",
    "codeVerifying": "Checking…",
    "codeInvalid": "That code isn't right. Check it and type it again.",
    "codeExpired": "That code has expired. Ask for another one.",
    "codeNetwork": "We couldn't check it. Check your connection and try again.",
    "codeResend": "Send another code",
    "codeResendWait": "You can ask for another in {seconds}s",
    "codeChangeEmail": "Use a different email",
    "codeSpamHint": "If you don't see it, check spam. It expires in an hour.",
```

Y la línea 57 (`"promoDoor": "Android edition"`) por:

```json
    "promoDoor": "Android edition",
    "promoAccountTitle": "Before you move",
    "promoAccountBody": {
      "one": "Your {count}-day streak lives in this browser. Without an account it won't travel: in the app you'd start from zero.",
      "other": "Your {count}-day streak lives in this browser. Without an account it won't travel: in the app you'd start from zero."
    },
    "promoAccountBodyPlain": "Your progress lives in this browser. With an account it follows you to your phone, the app, and any other device.",
    "promoAccountCta": "Create my account",
    "promoAccountDecline": "Not now"
```

- [ ] **Step 4: Verificar la paridad**

Run: `npx vitest run src/i18n/locales.test.js`
Expected: PASS. Si falla, el objeto `{ faltanEnIngles, faltanEnEspanol }` te dice exactamente qué clave se quedó coja.

- [ ] **Step 5: Verificar que no queda nadie usando las claves borradas**

Run: `grep -rn "emailSentTitle\|emailSentBody\|emailSentHint" src/`
Expected: solo `src/components/LoginModal.jsx` (se arregla en la tarea 4). Si sale otro fichero, arréglalo también.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "i18n: textos del código de 6 cifras y del faldón de registro"
```

**Estado transitorio: LA SUITE SE QUEDA EN ROJO hasta la tarea 4.** Entre este
commit y el siguiente, el modal todavía pide `app.emailSentTitle`, que ya no
existe. `locales.test.js` tiene CUATRO tests, no solo el de paridad: el cuarto
escanea todas las llamadas `t()`/`tn()` de `src/` y falla si la clave no está en
los dos idiomas. Existe por un incidente real —`prensa.fajaLider` y compañía se
borraron de los locales y `RankParte` siguió llamándolas, así que todo jugador
logueado con puesto vio un literal `prensa.fajaDistancia.one` en pantalla—, y
está haciendo exactamente su trabajo aquí.

O sea que este par de tareas (3 y 4) es **atómico**: no dejes la rama parada
entre medias, y no empujes nada al remoto hasta que la 4 esté dentro. Si tienes
que interrumpir, hazlo después de la 4.

---

## Task 4: `LoginModal` en dos pasos

La pieza grande. El modal pasa de una cara (formulario + acuse de recibo muerto) a dos pasos reales: correo → código. Incluye ya sus eventos de embudo (`login_method`, `login_code_sent`, `login_verified`), porque van dentro de los mismos manejadores y separarlos obligaría a editar dos veces las mismas funciones.

**Nota sobre el «atrás» de Android:** NO añadas un `useHistoryClose` propio para volver del paso 2 al paso 1. El «atrás» ya lo cubre el `useHistoryClose` **global** de `App.jsx`, que cierra el slot entero, y `ModalShell` advierte explícitamente contra apilar una segunda capa (entradas fantasma en el historial). Cerrar el modal entero con «atrás» es lo que hacen todos los demás modales de la app; que este se comporte igual es lo correcto.

**Files:**
- Modify: `src/components/LoginModal.jsx` (reescritura completa)
- Test: `src/components/LoginModal.test.jsx` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crea `src/components/LoginModal.test.jsx`:

```jsx
// @vitest-environment jsdom
//
// src/components/LoginModal.test.jsx
// LA PUERTA DE ENTRADA, MONTADA DE VERDAD.
//
// POR QUÉ EXISTE: el fallo caro de este componente es mudo. Si el `tipo` de
// token que devolvió el paso 1 no llega intacto al paso 2, Supabase rechaza un
// código perfectamente válido y el jugador ve «ese código no es correcto» sin
// haberse equivocado en nada — y como los dos caminos (alta y vinculación de
// anónimo) usan tokens distintos, el bug afectaría solo a una mitad de los
// usuarios. Eso no se ve en un Preview: se ve en los que no vuelven.

import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const pedirCodigo = vi.fn();
const verificarCodigo = vi.fn();
const signInWithGoogle = vi.fn().mockResolvedValue({ error: null });
const track = vi.fn();
const push = vi.fn();

async function montar(props = {}) {
  vi.resetModules();

  vi.doMock("../lib/auth", () => ({
    pedirCodigo,
    verificarCodigo,
    signInWithGoogle,
    emailLoginDisponible: () => true,
  }));
  vi.doMock("../lib/analytics", () => ({ track }));
  vi.doMock("../i18n", () => ({ useT: () => ({ t: (k) => k }) }));
  vi.doMock("./Toast", () => ({ useToast: () => ({ push }) }));
  // ModalShell arrastra framer-motion y el bloqueo de scroll; aquí solo estorba.
  // Su comportamiento (foco, role, backdrop) se prueba donde vive.
  vi.doMock("./ModalShell", () => ({
    default: ({ open, children }) => (open ? <div>{children}</div> : null),
  }));
  vi.doMock("./CloseButton", () => ({ default: () => <button type="button">cerrar</button> }));
  vi.doMock("./LanguageStrip", () => ({ default: () => null }));

  const { default: LoginModal } = await import("./LoginModal.jsx");
  return render(<LoginModal open onClose={() => {}} {...props} />);
}

/** Rellena el correo y envía el paso 1. */
async function enviarCorreo(valor = "piloto@ejemplo.com") {
  fireEvent.change(screen.getByPlaceholderText("app.emailPlaceholder"), {
    target: { value: valor },
  });
  fireEvent.click(screen.getByText("app.emailCta"));
  await screen.findByPlaceholderText("app.codePlaceholder");
}

describe("LoginModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email" });
    verificarCodigo.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("arranca pidiendo el correo, no el código", async () => {
    await montar();
    expect(screen.getByPlaceholderText("app.emailPlaceholder")).toBeTruthy();
    expect(screen.queryByPlaceholderText("app.codePlaceholder")).toBeNull();
  });

  it("un correo mal formado no llega a pedir nada", async () => {
    await montar();
    fireEvent.change(screen.getByPlaceholderText("app.emailPlaceholder"), {
      target: { value: "esto-no-es-un-correo" },
    });
    fireEvent.click(screen.getByText("app.emailCta"));
    expect(pedirCodigo).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalled();
  });

  it("tras enviar el correo, pasa al paso del código", async () => {
    await montar();
    await enviarCorreo();
    expect(pedirCodigo).toHaveBeenCalledWith("piloto@ejemplo.com");
    expect(screen.getByText("app.codeTitle")).toBeTruthy();
  });

  // EL TEST QUE JUSTIFICA EL FICHERO: el tipo del paso 1 llega intacto al 2.
  it("el tipo devuelto por pedirCodigo viaja hasta verificarCodigo", async () => {
    pedirCodigo.mockResolvedValue({ error: null, tipo: "email_change" });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await waitFor(() =>
      expect(verificarCodigo).toHaveBeenCalledWith("piloto@ejemplo.com", "123456", "email_change")
    );
  });

  it("seis cifras verifican solas, sin pulsar el botón", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "999888" },
    });
    await waitFor(() => expect(verificarCodigo).toHaveBeenCalledTimes(1));
  });

  it("el campo del código descarta lo que no sean cifras y corta en seis", async () => {
    await montar();
    await enviarCorreo();
    const campo = screen.getByPlaceholderText("app.codePlaceholder");
    fireEvent.change(campo, { target: { value: "12a3-45 6789" } });
    expect(campo.value).toBe("123456");
  });

  it("un código caducado se distingue de uno incorrecto", async () => {
    verificarCodigo.mockResolvedValue({ data: null, error: { message: "Token has expired" } });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeExpired");
    expect(screen.queryByText("app.codeInvalid")).toBeNull();
  });

  it("un código incorrecto vacía el campo para volver a intentarlo", async () => {
    verificarCodigo.mockResolvedValue({ data: null, error: { message: "Token is invalid" } });
    await montar();
    await enviarCorreo();
    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await screen.findByText("app.codeInvalid");
    expect(screen.getByPlaceholderText("app.codePlaceholder").value).toBe("");
  });

  it("«usar otro correo» vuelve al paso 1 conservando lo tecleado", async () => {
    await montar();
    await enviarCorreo();
    fireEvent.click(screen.getByText("app.codeChangeEmail"));
    const campo = await screen.findByPlaceholderText("app.emailPlaceholder");
    expect(campo.value).toBe("piloto@ejemplo.com");
  });

  // El reenvío nace bloqueado: sin cuenta atrás, «no me llega» se convierte en
  // pulsar el botón cinco veces y chocar con el rate limit del proveedor.
  it("el reenvío arranca en cuenta atrás, no disponible", async () => {
    await montar();
    await enviarCorreo();
    expect(screen.queryByText("app.codeResend")).toBeNull();
    expect(screen.getByText("app.codeResendWait")).toBeTruthy();
  });

  it("mide el embudo: método, código enviado y resultado", async () => {
    await montar();
    await enviarCorreo();
    expect(track).toHaveBeenCalledWith("login_method", { method: "email" });
    expect(track).toHaveBeenCalledWith("login_code_sent", { vinculando: false });

    fireEvent.change(screen.getByPlaceholderText("app.codePlaceholder"), {
      target: { value: "123456" },
    });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("login_verified", { result: "ok" })
    );
  });

  it("Google sigue siendo el primer camino y se mide", async () => {
    await montar();
    fireEvent.click(screen.getByText("common.continueWithGoogle"));
    expect(track).toHaveBeenCalledWith("login_method", { method: "google" });
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run src/components/LoginModal.test.jsx`
Expected: FAIL — `No "pedirCodigo" export is defined on the "../lib/auth" mock` (el componente todavía importa `signInWithEmail`).

- [ ] **Step 3: Reescribir el componente**

Sustituye el contenido **entero** de `src/components/LoginModal.jsx` por:

```jsx
// src/components/LoginModal.jsx
// La puerta de entrada. Dos caminos y dos pasos.
//
// JERARQUÍA: Google primero y con peso (un solo toque, y es lo que usa la
// mayoría), el correo debajo tras un filete. No al revés: ofrecer primero el
// camino de dos pasos sería empujar al jugador al más lento.
//
// POR QUÉ UN CÓDIGO Y NO UN ENLACE. El enlace obligaba a salir de la pantalla e
// ir a la bandeja de correo, que es donde se desangran los embudos en móvil, y
// en la app no se podía ofrecer siquiera: la sesión habría nacido en el
// navegador del sistema, fuera del WebView. Un código de seis cifras se teclea
// donde estás. Es además el gesto que todo el mundo reconoce de su banco y de
// WhatsApp, así que no hay nada que aprender.
//
// POR QUÉ NO CONTRASEÑA. Con confirmación de correo, darse de alta con
// contraseña son cinco pasos (correo, inventar contraseña, ir a la bandeja,
// confirmar, volver): el viaje del código MÁS inventar algo que recordar. Solo
// compensaría en el segundo login, que en un juego diario con sesión
// persistente prácticamente no ocurre. Y deja cola para siempre: recuperación,
// fuerza mínima, contraseñas filtradas, soporte.
//
// El correo se pinta SOLO si `emailLoginDisponible()` (ver lib/auth.js): el
// email integrado de Supabase va limitado a 2 correos/hora en todo el proyecto,
// así que la opción está apagada hasta que haya SMTP propio.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  signInWithGoogle,
  pedirCodigo,
  verificarCodigo,
  emailLoginDisponible,
} from "../lib/auth";
import { track } from "../lib/analytics";
import { useToast } from "./Toast";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";
import LanguageStrip from "./LanguageStrip";

// Validación deliberadamente laxa: "algo@algo.algo". La de verdad la hace el
// servidor al enviar, y un regex estricto de RFC rechaza correos válidos raros.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CIFRAS = 6;

// Espera antes de poder pedir otro código. Sesenta segundos y no treinta porque
// un correo puede tardar: un botón disponible antes de que llegue el primero
// invita a pedir un segundo, y el segundo INVALIDA al primero — el jugador
// acabaría escribiendo un código recién caducado por culpa nuestra.
const SEGUNDOS_REENVIO = 60;

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// `aviso`: null en el caso normal; "identidad-ocupada" cuando la vinculación
// falló porque esa cuenta de Google ya es de otro usuario; cualquier otra
// cadena para un fallo genérico de OAuth. Lo decide App.jsx leyendo la URL de
// retorno (lib/authCallback.js).
export default function LoginModal({ open, onClose, aviso = null }) {
  const { t } = useT();
  const toast = useToast();
  const conEmail = emailLoginDisponible();

  const [paso, setPaso] = useState("correo");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  // El tipo de token que devolvió pedirCodigo. Se ARRASTRA hasta la
  // verificación en vez de recalcularlo: ver el porqué en lib/auth.js.
  const [tipoOtp, setTipoOtp] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // "codeInvalid" | "codeExpired" | "codeNetwork" | null. Son tres mensajes y
  // no uno porque la acción que los resuelve es distinta: uno se reescribe,
  // otro se repide y el tercero no depende del jugador. Decirle «ese código no
  // es correcto» a quien se ha quedado sin cobertura es culparle de algo que
  // hizo bien (regla 21: degradar no es inventarse el estado).
  const [errorCodigo, setErrorCodigo] = useState(null);
  const [reenvioEn, setReenvioEn] = useState(0);

  // Doble toque en el botón de Google. En web da igual (redirige y la página se
  // va), pero en la app el plugin nativo tarda un instante en presentar la hoja
  // de cuentas — y ahí cabe un segundo toque, que `lib/nativeAuth` detecta y
  // devuelve como error: un aviso rojo por algo que no has hecho mal.
  const [entrando, setEntrando] = useState(false);

  // Al cerrarse, el modal vuelve al paso 1. Sin esto, quien cierra a medias y
  // reabre se encuentra pidiéndole un código que ya no va a llegar. El correo
  // SÍ se conserva: no hay ninguna razón para hacérselo teclear otra vez.
  useEffect(() => {
    if (open) return;
    setPaso("correo");
    setCodigo("");
    setTipoOtp(null);
    setErrorCodigo(null);
    setReenvioEn(0);
  }, [open]);

  // Cuenta atrás del reenvío. Un setTimeout por segundo y no un intervalo: así
  // el desmontaje lo limpia solo y no hay que acordarse de pararlo.
  useEffect(() => {
    if (reenvioEn <= 0) return undefined;
    const id = setTimeout(() => setReenvioEn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [reenvioEn]);

  async function entrarConGoogle(vincular = true) {
    if (entrando) return;
    setEntrando(true);
    track("login_method", { method: "google" });
    // En nativo (app) el login va por plugin; si falla (p.ej. falta
    // VITE_GOOGLE_WEB_CLIENT_ID o el usuario cancela con error), damos
    // feedback visible en vez de "no pasa nada". En web redirige, y el error
    // que importa vuelve en la URL — lo recoge lib/authCallback.js.
    try {
      const { error } = (await signInWithGoogle({ vincular })) || {};
      if (error) toast.push(t("app.loginError"), { type: "error" });
    } finally {
      setEntrando(false);
    }
  }

  async function enviarCodigo(e) {
    e?.preventDefault();
    const limpio = email.trim();
    if (!EMAIL_RE.test(limpio)) {
      toast.push(t("app.emailInvalid"), { type: "error" });
      return;
    }
    setEnviando(true);
    track("login_method", { method: "email" });
    try {
      const { error, tipo } = await pedirCodigo(limpio);
      if (error) {
        // El error más probable en producción es el rate limit del proveedor de
        // correo. Merece su propio mensaje: «inténtalo de nuevo» no le dice al
        // jugador que lo que tiene que hacer es ESPERAR.
        const esRate =
          error.status === 429 || /rate limit|too many/i.test(error.message || "");
        toast.push(esRate ? t("app.emailRateLimited") : t("app.emailError"), { type: "error" });
        return;
      }
      setTipoOtp(tipo);
      setCodigo("");
      setErrorCodigo(null);
      setPaso("codigo");
      setReenvioEn(SEGUNDOS_REENVIO);
      track("login_code_sent", { vinculando: tipo === "email_change" });
    } catch {
      toast.push(t("app.emailError"), { type: "error" });
    } finally {
      setEnviando(false);
    }
  }

  async function verificar(valor) {
    const cifras = valor ?? codigo;
    if (verificando || cifras.length !== CIFRAS) return;
    setVerificando(true);
    try {
      const { error } = (await verificarCodigo(email.trim(), cifras, tipoOtp)) || {};
      if (error) {
        const caducado = /expired/i.test(error.message || "");
        setErrorCodigo(caducado ? "codeExpired" : "codeInvalid");
        // Vaciar el campo: reescribir sobre seis cifras que ya se rechazaron es
        // más trabajo que empezar de nuevo.
        setCodigo("");
        track("login_verified", { result: caducado ? "expired" : "bad_code" });
        return;
      }
      track("login_verified", { result: "ok" });
      // La sesión ya existe. Quien se entera es onAuthStateChange
      // (useAuthSession); aquí solo hay que quitarse de en medio.
      onClose?.();
    } catch {
      // Aquí NO se ha rechazado el código: no hemos llegado a preguntarlo. El
      // campo se conserva —lo tecleado sigue siendo válido— y el mensaje habla
      // de la conexión, no del jugador.
      setErrorCodigo("codeNetwork");
      track("login_verified", { result: "error" });
    } finally {
      setVerificando(false);
    }
  }

  // Solo cifras y como mucho seis. Se verifica sola al llegar a la sexta —el
  // botón sigue ahí porque pegar desde el gestor de contraseñas no siempre
  // dispara los mismos eventos que teclear.
  function cambiarCodigo(e) {
    const limpio = e.target.value.replace(/\D/g, "").slice(0, CIFRAS);
    setCodigo(limpio);
    if (errorCodigo) setErrorCodigo(null);
    if (limpio.length === CIFRAS) verificar(limpio);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("app.loginModalTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[100] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} />
      </div>

      {paso === "codigo" ? (
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.codeTitle")}
          </h2>
          <p className="pm-body">{t("app.codeBody", { email: email.trim() })}</p>

          <div className="mt-5 text-left">
            <label htmlFor="login-codigo" className="prensa-label">
              {t("app.codeLabel")}
            </label>
            <input
              id="login-codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              // El teclado del sistema aparece aquí, dentro de un role="dialog".
              // lib/teclado.js ignora a propósito los campos de un diálogo: la
              // hoja se ajusta sola y el pliego de detrás no tiene que
              // recomponerse (ver su cabecera).
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={CIFRAS}
              className="prensa-input text-center font-mono text-2xl tracking-[0.4em]"
              placeholder={t("app.codePlaceholder")}
              value={codigo}
              onChange={cambiarCodigo}
              disabled={verificando}
              autoFocus
            />
            {errorCodigo && (
              <p className="mt-2 text-sm text-rojo">{t(`app.${errorCodigo}`)}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => verificar()}
            className="pm-btn mt-4"
            disabled={verificando || codigo.length !== CIFRAS}
          >
            {verificando ? t("app.codeVerifying") : t("app.codeCta")}
          </button>

          <p className="pm-body mt-3 text-center text-xs">{t("app.codeSpamHint")}</p>

          <div className="mt-4 flex flex-col gap-2">
            {reenvioEn > 0 ? (
              <span className="pm-label !text-[10px]">
                {t("app.codeResendWait", { seconds: reenvioEn })}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => enviarCodigo()}
                className="pm-btn pm-btn--ghost !py-2 !text-xs"
                disabled={enviando}
              >
                {enviando ? t("app.emailSending") : t("app.codeResend")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPaso("correo");
                setCodigo("");
                setErrorCodigo(null);
                setReenvioEn(0);
              }}
              className="pm-label !text-[10px] underline"
            >
              {t("app.codeChangeEmail")}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
            {t("app.loginModalTitle")}
          </h2>

          {/* Vuelta de un intento fallido. Antes de esto, ese caso era una
              pantalla idéntica a la normal: el jugador volvía de Google sin
              sesión y sin ninguna explicación, y solo podía volver a pulsar el
              mismo botón para repetir el mismo fallo. */}
          {aviso === "identidad-ocupada" ? (
            <p className="mb-6 border border-dashed border-tinta px-3 py-2 text-left text-sm text-muted">
              {t("app.loginLinkTakenBody")}
            </p>
          ) : aviso ? (
            <p className="mb-6 border border-dashed border-tinta px-3 py-2 text-left text-sm text-muted">
              {t("app.loginFailedBody")}
            </p>
          ) : (
            <p className="mb-8 text-sm text-muted">{t("app.loginModalDescription")}</p>
          )}

          <button
            // Tras un fallo de vinculación entramos SIN vincular: ya sabemos
            // que esa cuenta es de otro usuario, y reintentar vinculando sería
            // mandarle a Google para volver con el mismo error.
            onClick={() => entrarConGoogle(aviso !== "identidad-ocupada")}
            disabled={entrando}
            aria-busy={entrando}
            // Blanco sobre negro es la CHAPA DE MARCA de Google (su logo va sobre
            // fondo blanco por sus propias directrices), así que ese par se queda
            // aunque no sea del tema; es el único sitio de la web donde el color
            // no lo elegimos nosotros. La forma sí es nuestra: esquina viva y el
            // papel se hunde 1px al pulsar.
            className="flex w-full items-center justify-center gap-3 rounded-none bg-white px-4 py-3 font-semibold text-black transition-transform active:translate-y-px disabled:opacity-60"
          >
            <GoogleGlyph />
            {t("common.continueWithGoogle")}
          </button>

          {conEmail && (
            <>
              {/* Filete con la conjunción centrada: el separador del sistema
                  prensa, no una línea suelta. */}
              <div className="my-5 flex items-center gap-3">
                <i className="h-px flex-1 bg-border" aria-hidden="true" />
                <span className="pm-label !text-[10px]">{t("app.orSeparator")}</span>
                <i className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>

              {/* `noValidate`, y el campo sigue siendo `type="email"`: son dos
                  cosas distintas. El tipo se queda porque es lo que saca el
                  teclado con la tecla @ en el móvil. La validación nativa se
                  apaga porque su burbuja sale en el idioma del SISTEMA y no en
                  el que el jugador eligió aquí — y porque es MÁS LAXA que
                  EMAIL_RE (`a@b` la pasa), así que iban a convivir las dos: el
                  mismo error se presentaba de dos maneras distintas según lo
                  equivocado que estuviera. Una puerta, un mensaje, y en nuestro
                  idioma. Sin esto, `enviarCodigo` no llega a ejecutarse con un
                  correo sin arroba y el toast traducido es código muerto. */}
              <form onSubmit={enviarCodigo} noValidate className="text-left">
                <label htmlFor="login-email" className="prensa-label">
                  {t("app.emailLabel")}
                </label>
                <input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  className="prensa-input"
                  placeholder={t("app.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={enviando}
                />
                <button type="submit" className="pm-btn mt-4" disabled={enviando}>
                  {enviando ? t("app.emailSending") : t("app.emailCta")}
                </button>
                <p className="pm-body mt-2 text-center text-xs">{t("app.emailNoPassword")}</p>
              </form>
            </>
          )}

          {/* Selector de idioma para usuarios anónimos. Antes vivía en el
              popover del header; al quitarlo, este modal (al que llega el
              anónimo desde el icono de perfil) es su nuevo hogar. */}
          <div className="mt-6 border-t border-border pt-4 text-left">
            <LanguageStrip />
          </div>
        </>
      )}
    </ModalShell>
  );
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/components/LoginModal.test.jsx`
Expected: PASS, los 12.

- [ ] **Step 5: Verificar la estética**

Run: `npm run test:estetica`
Expected: PASS. Si se queja de `bg-white`/`text-black` en `LoginModal.jsx`, es que se perdió la excepción de `ALLOW` en `scripts/check-estetica.mjs` — restáurala, no cambies el botón de Google.

**Verificación extra de esta tarea, que no está en las demás.** Al llegar aquí
dos cosas que estaban ROJAS desde la tarea 3 tienen que volver al verde, y son
la señal de que el par 3+4 ha cerrado bien:

- `npx vitest run src/i18n/locales.test.js` → 4/4 (estaba 3/4: el modal pedía las
  tres claves `emailSent*` retiradas).
- `npm run build` → compila (fallaba con `[MISSING_EXPORT] "signInWithEmail"`).

- [ ] **Step 6: Commit**

```bash
git add src/components/LoginModal.jsx src/components/LoginModal.test.jsx
git commit -m "feat(auth): la entrada por correo pasa a código de 6 cifras, en dos pasos"
```

---

## Task 5: `login_success` — el evento que cierra el embudo

El éxito no se puede medir desde el modal, porque en web Google **redirige y la página se recarga**: para cuando volvemos, la sesión ya está puesta y parece que siempre estuvo. `useAuthSession` sí ve las transiciones, pero no distingue «acabo de entrar» de «ya estaba dentro al cargar». La solución son dos caminos:

- **Transición dentro de la sesión** (código de 6 cifras, Google nativo): `useAuthSession` la ve sola — su `lastUserIdRef` guarda `${id}-${anon}` y esa clave cambia al entrar o al vincular.
- **Vuelta de un redirect** (Google en web): `signInWithGoogle` deja una nota en `sessionStorage` antes de irse, y la hidratación inicial la lee. `sessionStorage` sobrevive al redirect y muere con la pestaña, que es exactamente la vida útil que queremos.

**Files:**
- Modify: `src/lib/auth.js` (helper de la nota + `sesionAnonimaVigente` pasa a devolver el id)
- Modify: `src/hooks/useAuthSession.js:47-60`
- Modify: `src/lib/analytics.js` (bloque de convención)
- Test: `src/lib/auth.test.js`

- [ ] **Step 1: Test de la nota de login**

Añade al final del `describe("auth helpers", ...)` de `src/lib/auth.test.js`:

```js
  // ── La nota que sobrevive al redirect de Google ──────────────────────────
  describe("marca de login en curso", () => {
    it("se guarda al entrar con Google en web, con el id anónimo de origen", async () => {
      const m = setup({ isNative: false, sesion: "anon" });
      const store = {};
      vi.stubGlobal("sessionStorage", {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(JSON.parse(store.ccd_login_en_curso)).toEqual({ method: "google", anonId: "u1" });
      expect(m.linkIdentity).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("NO se guarda en nativo: allí no hay redirect y la transición se ve sola", async () => {
      setup({ isNative: true });
      const store = {};
      vi.stubGlobal("sessionStorage", {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      });
      const { signInWithGoogle } = await import("./auth");
      await signInWithGoogle();
      expect(store.ccd_login_en_curso).toBeUndefined();
      vi.unstubAllGlobals();
    });

    // Leerla la CONSUME: si se quedara puesta, el siguiente arranque de la
    // pestaña volvería a contar un login que ya se contó.
    it("leerLoginEnCurso devuelve la nota y la borra", async () => {
      setup({ isNative: false });
      const store = { ccd_login_en_curso: JSON.stringify({ method: "google", anonId: null }) };
      vi.stubGlobal("sessionStorage", {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      });
      const { leerLoginEnCurso } = await import("./auth");
      expect(leerLoginEnCurso()).toEqual({ method: "google", anonId: null });
      expect(store.ccd_login_en_curso).toBeUndefined();
      expect(leerLoginEnCurso()).toBeNull();
      vi.unstubAllGlobals();
    });

    it("sin sessionStorage no lanza (modo privado, sandbox)", async () => {
      setup({ isNative: false });
      vi.stubGlobal("sessionStorage", undefined);
      const { leerLoginEnCurso, marcarLoginEnCurso } = await import("./auth");
      expect(() => marcarLoginEnCurso("google", null)).not.toThrow();
      expect(leerLoginEnCurso()).toBeNull();
      vi.unstubAllGlobals();
    });
  });
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run src/lib/auth.test.js -t "marca de login"`
Expected: FAIL — `leerLoginEnCurso is not a function`.

- [ ] **Step 3: Implementar en `src/lib/auth.js`**

**3a.** Sustituye la función `sesionAnonimaVigente` por esta, que devuelve el **id** en vez de un booleano (un id sigue siendo *truthy*, así que los dos sitios que la usan como condición no cambian de comportamiento):

```js
/**
 * Id de la sesión anónima vigente, o null si no hay o no es anónima.
 *
 * Devuelve el ID y no un booleano porque hay dos consumidores con necesidades
 * distintas: quien solo quiere saber «¿vinculo o entro?» lo usa como condición
 * (un id es truthy), y quien va a redirigir a Google necesita apuntar DE QUÉ
 * cuenta venía para poder decir después si la vinculación conservó el progreso.
 */
async function idAnonimoVigente() {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    return u && u.is_anonymous === true ? u.id : null;
  } catch {
    return null;
  }
}
```

Y actualiza sus dos llamadas: en `signInWithGoogle` y en `pedirCodigo`, cambia `sesionAnonimaVigente()` por `idAnonimoVigente()`.

**3b.** Añade el helper de la nota justo debajo de `esCuentaReal` (arriba del fichero, donde vive el vocabulario de sesión):

```js
// ── La nota que sobrevive al redirect ──────────────────────────────────────
// En web, entrar con Google se lleva la página entera a otro dominio y la trae
// de vuelta recargada. Eso hace INOBSERVABLE el éxito: al volver, la sesión ya
// está puesta y es indistinguible de haber llegado ya logueado. Sin esta nota,
// `login_success` mediría todos los caminos MENOS el que usa la mayoría.
//
// sessionStorage y no localStorage a propósito: la nota tiene que morir con la
// pestaña. Una nota que sobreviviera al cierre convertiría la siguiente visita
// en un login falso.
const CLAVE_LOGIN = "ccd_login_en_curso";

/** Apunta que ESTA pestaña se va a un redirect de login. @param {string|null} anonId */
export function marcarLoginEnCurso(method, anonId) {
  try {
    sessionStorage.setItem(CLAVE_LOGIN, JSON.stringify({ method, anonId: anonId ?? null }));
  } catch {
    // Sin sessionStorage (modo privado, sandbox) solo perdemos la métrica. El
    // login funciona igual: nunca se degrada la entrada por medir.
  }
}

/** Lee la nota y LA CONSUME. Devuelve null si no había. */
export function leerLoginEnCurso() {
  try {
    const raw = sessionStorage.getItem(CLAVE_LOGIN);
    if (!raw) return null;
    sessionStorage.removeItem(CLAVE_LOGIN);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

**3c.** Sustituye el cuerpo de `signInWithGoogle` (deja intacto su bloque de comentario de cabecera) por:

```js
export async function signInWithGoogle({ vincular = true } = {}) {
  if (Capacitor.isNativePlatform()) {
    // Nativo no redirige: la sesión aparece en esta misma página y
    // useAuthSession la ve como transición. Marcarla aquí dejaría una nota
    // que nadie va a leer, y que ensuciaría el siguiente login de la pestaña.
    return nativeGoogleSignIn();
  }

  const anonId = await idAnonimoVigente();
  marcarLoginEnCurso("google", anonId);

  // Con sesión anónima en curso, VINCULAMOS en vez de entrar: linkIdentity
  // conserva el mismo user id, y con él la racha, las estadísticas y el
  // Archivo que el jugador acumuló como anónimo. Es la diferencia entre
  // «regístrate» y «no pierdas lo que llevas».
  if (vincular && anonId) {
    const res = await supabase.auth.linkIdentity({ provider: "google" });
    if (!res?.error) return res;
    console.warn("[auth] linkIdentity rechazado antes de redirigir:", res.error.message);
  }

  return supabase.auth.signInWithOAuth({ provider: "google" });
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/lib/auth.test.js`
Expected: PASS, todos.

- [ ] **Step 5: Emitir el evento desde `useAuthSession`**

En `src/hooks/useAuthSession.js`, añade a los imports:

```js
import { esCuentaReal, leerLoginEnCurso } from "../lib/auth";
import { track } from "../lib/analytics";
```

(sustituye la línea `import { esCuentaReal } from "../lib/auth";`).

Dentro de `syncUser`, sustituye estas tres líneas:

```js
      if (lastUserIdRef.current === nextKey) return;
      lastUserIdRef.current = nextKey;
```

por:

```js
      if (lastUserIdRef.current === nextKey) return;
      // `undefined` = primera pasada de esta carga de página. Distinguirlo de
      // `null` (sesión ya procesada, sin usuario) es lo que separa «acabo de
      // entrar» de «llegué ya logueado», y sin esa distinción login_success
      // contaría una entrada por cada recarga.
      const previo = lastUserIdRef.current;
      lastUserIdRef.current = nextKey;
      reportarLogin(sessionUser, previo);
```

Y añade esta función **dentro** del `useEffect`, justo encima de `async function syncUser(session)`:

```js
    /**
     * ¿Esta sincronización es una ENTRADA? Y si lo es, ¿por qué camino y
     * conservando el progreso anónimo o no?
     *
     * Dos caminos, porque el redirect de Google en web borra la evidencia:
     *
     *  - HIDRATACIÓN (`previo === undefined`): la sesión ya estaba al cargar.
     *    Solo cuenta como entrada si esta pestaña dejó una nota antes de irse
     *    a Google (lib/auth.js). Sin nota es alguien que ya venía logueado.
     *  - TRANSICIÓN: la sesión cambió con la página abierta — código de 6
     *    cifras o Google nativo. Aquí la nota, si la hubiera, está rancia: se
     *    consume igual para que no contamine el siguiente login.
     */
    function reportarLogin(sessionUser, previo) {
      const marca = leerLoginEnCurso();
      if (!esCuentaReal(sessionUser)) return;

      if (previo === undefined) {
        if (!marca) return;
        track("login_success", {
          method: marca.method,
          vinculado: marca.anonId === sessionUser.id,
        });
        return;
      }

      // Ya era cuenta real antes: un refresco de token, no una entrada.
      if (typeof previo === "string" && previo.endsWith("-false")) return;

      const proveedores = sessionUser.app_metadata?.providers || [];
      track("login_success", {
        method: proveedores.includes("google") ? "google" : "email",
        // Mismo id que la sesión anónima anterior = conservó racha y Archivo.
        vinculado: previo === `${sessionUser.id}-true`,
      });
    }
```

- [ ] **Step 6: Documentar los eventos en `analytics.js`**

En `src/lib/analytics.js`, en el bloque de convención de la cabecera, añade justo **encima** de la línea `//   - app_promo_shown`:

```js
//   - login_prompt_shown  { surface }              — se abre la puerta de entrada
//   - login_method        { method }               — google | email: qué camino elige
//   - login_code_sent     { vinculando }           — código pedido (vinculando: adjunta correo a un anónimo)
//   - login_verified      { result }               — ok | bad_code | expired | error
//   - login_success       { method, vinculado }    — sesión de CUENTA REAL creada
//   - login_dismiss       { surface }              — cierra sin entrar
//        Embudo de registro: prompt_shown → method → (code_sent → verified) →
//        success. `vinculado` es la métrica que de verdad importa: dice si el
//        jugador conservó su progreso anónimo o empezó de cero.
//        login_success NO sale del modal sino de useAuthSession: en web el
//        redirect de Google recarga la página y el modal ya no existe cuando
//        la sesión aparece. Ver reportarLogin() allí.
```

- [ ] **Step 7: Suite completa**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.js src/lib/auth.test.js src/hooks/useAuthSession.js src/lib/analytics.js
git commit -m "feat(analitica): login_success, incluido el Google de web que se pierde en el redirect"
```

---

## Task 6: De dónde viene el jugador (`surface`)

Sin esto el embudo no tiene denominador ni sabe qué puerta funciona. Hay **seis** superficies, no cuatro como decía la spec: se añaden `faldon` (la crea la tarea 8) y `vuelta-error` (el modal que se abre solo al volver de un OAuth fallido, `App.jsx:102`).

**Files:**
- Modify: `src/App.jsx:95-103`, `:281-283`, `:565-569`
- Modify: `src/components/configurator/EndScreen.jsx:404`
- Modify: `src/components/Ranking.jsx:518-523`
- Modify: `src/components/Garage.jsx:627-632`
- Modify: `src/components/SumarioModal.jsx:146`
- Modify: `src/components/LoginModal.jsx` (una línea)

- [ ] **Step 1: `openLogin` acepta la superficie (`src/App.jsx`)**

Sustituye:

```js
  // LoginModal NO es lazy a propósito: es la puerta de entrada y un chunk que
  // descargar en ese momento se nota. No necesita mountModal.
  function openLogin() {
    setActiveModal("login");
  }
```

por:

```js
  // LoginModal NO es lazy a propósito: es la puerta de entrada y un chunk que
  // descargar en ese momento se nota. No necesita mountModal.
  //
  // `surface` es de dónde viene el jugador. Sin ella el embudo de registro no
  // tiene denominador: se sabría cuánta gente entra, pero no qué puerta la
  // trajo — que es justo lo que hay que saber para mejorar la que no funciona.
  const [loginSurface, setLoginSurface] = useState(null);
  function openLogin(surface = "desconocida") {
    setLoginSurface(surface);
    track("login_prompt_shown", { surface });
    setActiveModal("login");
  }
```

- [ ] **Step 2: La apertura automática tras un OAuth fallido también cuenta**

En el `useEffect` de `avisoLogin` (`src/App.jsx:96-103`), sustituye:

```js
    setAvisoLogin(esIdentidadYaVinculada(err) ? "identidad-ocupada" : "generico");
    setActiveModal("login");
```

por:

```js
    setAvisoLogin(esIdentidadYaVinculada(err) ? "identidad-ocupada" : "generico");
    // Esta apertura no la pidió nadie: la provoca la vuelta de un OAuth
    // fallido. Cuenta como superficie propia porque su tasa de éxito no se
    // parece en nada a la de las demás — aquí el jugador ya falló una vez.
    setLoginSurface("vuelta-error");
    track("login_prompt_shown", { surface: "vuelta-error" });
    setActiveModal("login");
```

**Ojo al orden:** `loginSurface` se declara en el paso 1 dentro del cuerpo del componente. Si ese `useEffect` está por encima de la declaración, mueve el `const [loginSurface, setLoginSurface] = useState(null);` junto a `const [avisoLogin, setAvisoLogin] = useState(null);` (línea 95) y deja solo la función `openLogin` en su sitio.

- [ ] **Step 3: Distinguir el cierre del éxito**

En `src/components/LoginModal.jsx`, dentro de `verificar()`, sustituye:

```js
      // La sesión ya existe. Quien se entera es onAuthStateChange
      // (useAuthSession); aquí solo hay que quitarse de en medio.
      onClose?.();
```

por:

```js
      // La sesión ya existe. Quien se entera es onAuthStateChange
      // (useAuthSession); aquí solo hay que quitarse de en medio.
      //
      // Con bandera: este cierre es un ÉXITO, no un abandono. Sin ella, cada
      // registro conseguido se contaría además como un `login_dismiss` y la
      // métrica de abandono diría lo contrario de lo que pasa.
      onClose?.({ exito: true });
```

En `src/App.jsx`, sustituye el montaje del modal:

```jsx
      <LoginModal
        open={activeModal === "login"}
        onClose={() => { setAvisoLogin(null); closeModal(); }}
        aviso={avisoLogin}
      />
```

por:

```jsx
      <LoginModal
        open={activeModal === "login"}
        // El botón de cerrar y el backdrop pasan su evento de click, que no
        // tiene `exito`: solo el camino de verificación correcta lo trae.
        onClose={(res) => {
          if (!res?.exito) track("login_dismiss", { surface: loginSurface });
          setAvisoLogin(null);
          closeModal();
        }}
        aviso={avisoLogin}
      />
```

- [ ] **Step 4: Los llamadores dicen quiénes son**

`src/components/configurator/EndScreen.jsx` — sustituye:

```jsx
            <button className="cdd-submit cdd-submit--ghost" onClick={onOpenLogin}>
```

por:

```jsx
            <button className="cdd-submit cdd-submit--ghost" onClick={() => onOpenLogin?.("endscreen")}>
```

`src/components/Ranking.jsx` — sustituye `onOpenLogin?.();` por `onOpenLogin?.("ranking");`

`src/components/Garage.jsx` — sustituye `onOpenLogin?.();` por `onOpenLogin?.("garage");`

`src/components/SumarioModal.jsx` — sustituye:

```jsx
          onClick={user ? onOpenProfile : onOpenLogin}
```

por:

```jsx
          onClick={user ? onOpenProfile : () => onOpenLogin?.("sumario")}
```

- [ ] **Step 5: Verificar que ninguna llamada quedó pasando el evento del click**

Run: `grep -rn "onOpenLogin" src/ --include=*.jsx | grep -v "\.test\." | grep -v "onOpenLogin,$" | grep -v "onOpenLogin={onOpenLogin}" | grep -v "onOpenLogin={openLogin}"`
Expected: solo llamadas con una cadena literal dentro (`onOpenLogin?.("endscreen")`, etc.). Una llamada como `onClick={onOpenLogin}` pasaría el `MouseEvent` como `surface` y la métrica llegaría a Umami como un objeto.

- [ ] **Step 6: Suite completa**

Run: `npx vitest run && npm run test:estetica`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/components/LoginModal.jsx src/components/Ranking.jsx src/components/Garage.jsx src/components/SumarioModal.jsx src/components/configurator/EndScreen.jsx
git commit -m "feat(analitica): el embudo de login sabe por qué puerta entró el jugador"
```

---

## Task 7: Dos descartes independientes en `edicionApp.js`

El faldón tendrá dos caras (registro y Play) y **cada una necesita su propia memoria de rechazo**. Con una sola clave, decir «ahora no» al registro enterraría también la oferta de Play para cuando el jugador ya tenga cuenta — o sea que rechazar una cosa apagaría otra que ni se le ha ofrecido.

**Files:**
- Modify: `src/lib/edicionApp.js`
- Test: `src/lib/edicionApp.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añade al final del `describe("edicionApp", ...)` de `src/lib/edicionApp.test.js`:

```js
  // Dos caras del mismo faldón, dos memorias. Con una sola clave, rechazar
  // «regístrate» apagaba de paso una oferta de Play que aún no se había hecho.
  it("los dos descartes del faldón son independientes", async () => {
    mockPlataforma(false);
    setUA(UA_ANDROID);
    localStorage.setItem("cd_dias_jugados", JSON.stringify({ n: 5, ultima: "2026-08-01" }));
    const {
      momentoDeFaldon,
      faldonDescartado,
      faldonRegistroDescartado,
      marcarFaldonRegistroDescartado,
      marcarFaldonDescartado,
    } = await import("./edicionApp.js");

    expect(momentoDeFaldon()).toBe(true);

    marcarFaldonRegistroDescartado();
    expect(faldonRegistroDescartado()).toBe(true);
    expect(faldonDescartado()).toBe(false);
    // La puerta común no se cierra: sigue siendo buen momento, solo cambia
    // cuál de las dos caras se puede enseñar.
    expect(momentoDeFaldon()).toBe(true);

    marcarFaldonDescartado();
    expect(faldonDescartado()).toBe(true);
  });

  it("momentoDeFaldon es la puerta SIN el descarte (las tres condiciones de sitio y hábito)", async () => {
    mockPlataforma(false);
    setUA(UA_ANDROID);
    localStorage.setItem("cd_dias_jugados", JSON.stringify({ n: 5, ultima: "2026-08-01" }));
    const { momentoDeFaldon, marcarFaldonDescartado, debeOfrecerFaldon } =
      await import("./edicionApp.js");

    marcarFaldonDescartado();
    // debeOfrecerFaldon sí mira el descarte de Play; momentoDeFaldon, no.
    expect(debeOfrecerFaldon()).toBe(false);
    expect(momentoDeFaldon()).toBe(true);
  });

  it("sin los días mínimos, momentoDeFaldon dice que no", async () => {
    mockPlataforma(false);
    setUA(UA_ANDROID);
    localStorage.setItem("cd_dias_jugados", JSON.stringify({ n: 2, ultima: "2026-08-01" }));
    const { momentoDeFaldon } = await import("./edicionApp.js");
    expect(momentoDeFaldon()).toBe(false);
  });
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run src/lib/edicionApp.test.js`
Expected: FAIL — `momentoDeFaldon is not a function`.

- [ ] **Step 3: Implementar**

En `src/lib/edicionApp.js`, junto a `const DESCARTE_KEY = "cd_app_faldon_no";`, añade:

```js
// El faldón tiene DOS caras y cada una lleva su memoria. Con una sola clave,
// decir «ahora no» a «créate una cuenta» apagaba también la oferta de Play para
// cuando el jugador ya tuviera cuenta: rechazar una cosa enterraba otra que aún
// no se le había ofrecido.
const DESCARTE_REGISTRO_KEY = "cd_registro_faldon_no";
```

Junto a `faldonDescartado` / `marcarFaldonDescartado`, añade sus gemelas:

```js
export function faldonRegistroDescartado() {
  try {
    return localStorage.getItem(DESCARTE_REGISTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function marcarFaldonRegistroDescartado() {
  try {
    localStorage.setItem(DESCARTE_REGISTRO_KEY, "1");
  } catch {
    /* peor caso: se lo volvemos a ofrecer otro día */
  }
}
```

Y sustituye `debeOfrecerFaldon()` por este par:

```js
/**
 * ¿Es buen SITIO y buen MOMENTO para un faldón? Android en navegador, sin la
 * app instalada y con hábito (tres días). Deliberadamente NO mira los
 * descartes: cuál de las dos caras se puede enseñar depende de si hay cuenta,
 * y eso lo sabe el componente, no este módulo.
 */
export function momentoDeFaldon() {
  return debeOfrecerApp() && diasJugados() >= DIAS_MINIMOS;
}

/**
 * ¿Toca ofrecer el faldón de PLAY? Síncrono a propósito: el EndScreen decide en
 * el primer render y así no aparece un bloque a mitad de lectura (lo mismo que
 * hace NotificationOptIn con `initialMode`).
 */
export function debeOfrecerFaldon() {
  return momentoDeFaldon() && !faldonDescartado();
}
```

**3b.** Añade al bloque de comentario de cabecera del módulo, después del párrafo «LO QUE NO PROMETEMOS»:

```js
// LO QUE LA APP NO SE LLEVA: EL PROGRESO ANÓNIMO. La sesión anónima vive en el
// localStorage del NAVEGADOR y el WebView de la app sirve desde
// `https://localhost`, en el sandbox de la aplicación: no hay ningún camino por
// el que esa racha pueda viajar. Por eso el faldón tiene dos caras y por eso al
// anónimo se le pide cuenta ANTES de enseñarle Play — ofrecerle mudarse sin
// avisarle es mandarle a empezar de cero con nueve días a la espalda.
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/lib/edicionApp.test.js`
Expected: PASS, todos (los antiguos incluidos: `debeOfrecerFaldon` conserva su comportamiento).

- [ ] **Step 5: Commit**

```bash
git add src/lib/edicionApp.js src/lib/edicionApp.test.js
git commit -m "feat(embudo): el faldón separa el descarte del registro del de Play"
```

---

## Task 8: El faldón encadenado

**Files:**
- Modify: `src/components/FaldonApp.jsx`
- Modify: `src/components/configurator/EndScreen.jsx:519`
- Test: `src/components/FaldonApp.test.jsx`

- [ ] **Step 1: Adaptar los tests existentes y añadir los nuevos**

En `src/components/FaldonApp.test.jsx`:

**1a.** La función `montar` pasa a aceptar props. Sustitúyela por:

```jsx
async function montar({ nativo = false, ua = UA_ANDROID, props = {} } = {}) {
  vi.resetModules();
  setUA(ua);
  vi.doMock("@capacitor/core", () => ({
    Capacitor: { isNativePlatform: () => nativo },
  }));
  // i18n real no: el faldón solo necesita que las claves se resuelvan a algo
  // estable con lo que buscar en pantalla. `tn` devuelve la clave base igual
  // que `t`, que es lo único que necesitamos para localizar el bloque.
  vi.doMock("../i18n", () => ({
    useT: () => ({ t: (k) => k, tn: (k) => k }),
  }));

  const { default: FaldonApp } = await import("./FaldonApp.jsx");
  // Con cuenta por defecto: los tests de la puerta (plataforma, días,
  // instalada) se escribieron para la cara de Play y siguen midiendo eso.
  return render(<FaldonApp user={{ id: "u1" }} streak={0} onOpenLogin={() => {}} {...props} />);
}
```

**1b.** Añade estos tests al final del `describe("FaldonApp", ...)`:

```jsx
  // ── Las dos caras ────────────────────────────────────────────────────────
  // Un anónimo que instala la app aparece en el día 0: su racha vive en el
  // localStorage del navegador y el WebView tiene su propio almacenamiento.
  // Ofrecerle Play sin avisar es mandarle a perder lo que lleva.
  it("sin cuenta pide cuenta, no Play", async () => {
    sembrarDias(3);
    await montar({ props: { user: null, streak: 9 } });
    expect(screen.getByText("app.promoAccountTitle")).toBeTruthy();
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });

  it("con cuenta ofrece Play, no la cuenta", async () => {
    sembrarDias(3);
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
    expect(screen.queryByText("app.promoAccountTitle")).toBeNull();
  });

  it("el CTA de registro abre el login y NO va a Play", async () => {
    sembrarDias(3);
    const onOpenLogin = vi.fn();
    await montar({ props: { user: null, streak: 4, onOpenLogin } });
    fireEvent.click(screen.getByText("app.promoAccountCta"));
    expect(onOpenLogin).toHaveBeenCalledWith("faldon");
    expect(window.open).not.toHaveBeenCalled();
  });

  // La cadena: al registrarse desde el faldón, el mismo bloque pasa a ofrecer
  // Play sin que haya que navegar a ningún sitio.
  it("al aparecer la cuenta, el mismo faldón pasa a ofrecer Play", async () => {
    sembrarDias(3);
    const { rerender } = await montar({ props: { user: null, streak: 4 } });
    expect(screen.getByText("app.promoAccountTitle")).toBeTruthy();

    const { default: FaldonApp } = await import("./FaldonApp.jsx");
    rerender(<FaldonApp user={{ id: "u1" }} streak={4} onOpenLogin={() => {}} />);
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  // Rechazar «regístrate» no puede enterrar una oferta que aún no se ha hecho.
  it("rechazar el registro NO apaga la oferta de Play de después", async () => {
    sembrarDias(3);
    await montar({ props: { user: null, streak: 4 } });
    fireEvent.click(screen.getByText("app.promoAccountDecline"));
    expect(screen.queryByText("app.promoAccountTitle")).toBeNull();

    cleanup();
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.getByText("app.promoTitle")).toBeTruthy();
  });

  it("y al revés: rechazar Play no vuelve a pedir cuenta a quien ya la tiene", async () => {
    sembrarDias(3);
    await montar({ props: { user: { id: "u1" } } });
    fireEvent.click(screen.getByText("app.promoDecline"));

    cleanup();
    await montar({ props: { user: { id: "u1" } } });
    expect(screen.queryByText("app.promoTitle")).toBeNull();
  });
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run src/components/FaldonApp.test.jsx`
Expected: FAIL — los seis nuevos no encuentran `app.promoAccountTitle`.

- [ ] **Step 3: Implementar**

Sustituye el contenido **entero** de `src/components/FaldonApp.jsx` por:

```jsx
// src/components/FaldonApp.jsx
// EL FALDÓN DEL FINAL DE PARTIDA. Único sitio de la web donde se ofrece la app.
//
// DÓNDE: al final del pliego del resultado, justo DEBAJO de la cuenta atrás.
// El renglón de encima acaba de decir "próximo coche en 07:41:12", o sea
// "vuelve mañana": es el único momento de la web en que ofrecer un icono en la
// pantalla de inicio es la consecuencia de lo que estás leyendo y no un anuncio
// interrumpiendo. Por eso no está en la cabecera (taparía la fotografía, que es
// el juego) ni en un modal de bienvenida (se lo comería quien aún no ha jugado).
//
// DOS CARAS, Y EL ORDEN NO ES NEGOCIABLE. La sesión anónima vive en el
// localStorage del navegador; el WebView de la app sirve desde
// `https://localhost`, en el sandbox de la aplicación. La racha NO VIAJA. A un
// anónimo con nueve días a la espalda, «instálate la app» es «empieza de cero»
// sin decírselo. Así que:
//
//   - SIN CUENTA → se le pide cuenta, y con el argumento verdadero: lo que
//     tiene y puede perder. Es, de paso, el mejor motivo para registrarse que
//     hay en toda la web — mucho mejor que «guarda tus estadísticas en la nube»,
//     que no le urge a nadie.
//   - CON CUENTA → la oferta de Play de siempre.
//
// Al registrarse desde aquí, `user` aparece y este mismo bloque cambia de cara:
// la cadena se cierra sola, sin mandar al jugador a ninguna otra pantalla.
//
// A QUIÉN: `momentoDeFaldon()` — Android en navegador, sin tenerla ya instalada
// y con tres días jugados. El razonamiento de cada condición está en
// lib/edicionApp.js. Los descartes son DOS, uno por cara: rechazar el registro
// no puede enterrar una oferta de Play que todavía no se ha hecho.
//
// FORMA: el mismo recuadro de "suscripción al boletín" que NotificationOptIn
// (filete de tinta, kicker rojo, cuerpo en Fraunces). Deliberadamente NO parece
// una tarjeta de tienda de aplicaciones: ni icono de la app, ni estrellas, ni
// captura. En este lenguaje una edición nueva se anuncia con tipografía.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { track } from "../lib/analytics";
import {
  momentoDeFaldon,
  faldonDescartado,
  faldonRegistroDescartado,
  marcarFaldonDescartado,
  marcarFaldonRegistroDescartado,
  urlPlay,
} from "../lib/edicionApp";

const SURFACE = "faldon_final";

export default function FaldonApp({ user = null, streak = 0, onOpenLogin }) {
  const { t, tn } = useT();

  // La puerta común (sitio y hábito), en el PRIMER render y síncrona: igual que
  // NotificationOptIn, para que no aparezca un bloque a mitad de lectura.
  const [enMomento] = useState(momentoDeFaldon);
  // Los dos descartes se leen una vez y viven en estado para que pulsar «ahora
  // no» se note al instante sin volver a tocar localStorage.
  const [descartes, setDescartes] = useState(() => ({
    registro: faldonRegistroDescartado(),
    play: faldonDescartado(),
  }));

  const pideCuenta = !user;
  const visible =
    enMomento && (pideCuenta ? !descartes.registro : !descartes.play);

  // Denominador del embudo: impresiones → clics. Se re-emite si cambia la cara
  // porque son dos ofertas distintas con dos tasas distintas — quien se
  // registra aquí y ve entonces la de Play ha visto DOS cosas, no una.
  useEffect(() => {
    if (visible) track("app_promo_shown", { surface: SURFACE, auth: pideCuenta ? "anon" : "user" });
  }, [visible, pideCuenta]);

  if (!visible) return null;

  function irAPlay() {
    haptic.impactLight();
    track("app_promo_click", { surface: SURFACE });
    // No marcamos descarte: si vuelve sin instalar, el faldón sigue ahí. Lo que
    // cierra el faldón para siempre es un "no", no un "sí" a medias.
    window.open(urlPlay(SURFACE), "_blank", "noopener,noreferrer");
  }

  function crearCuenta() {
    haptic.impactLight();
    // Tampoco marca descarte, y por el mismo motivo: abrir el modal de entrada
    // no es haber entrado.
    onOpenLogin?.("faldon");
  }

  function descartar() {
    haptic.impactLight();
    track("app_promo_dismiss", { surface: SURFACE, auth: pideCuenta ? "anon" : "user" });
    if (pideCuenta) {
      marcarFaldonRegistroDescartado();
      setDescartes((d) => ({ ...d, registro: true }));
    } else {
      marcarFaldonDescartado();
      setDescartes((d) => ({ ...d, play: true }));
    }
  }

  return (
    <div className="mb-4 border border-tinta p-4 text-left">
      <p className="pm-kicker">
        {pideCuenta ? t("app.promoAccountTitle") : t("app.promoTitle")}
      </p>
      <p className="pm-body mt-2 text-sm">
        {pideCuenta
          ? // Con racha, se la nombramos: «tu racha de 9 días» pesa lo que no
            // pesa «tu progreso», porque habla de algo concreto que YA tiene.
            // Con 0 o 1 no hay nada que presumir y va el genérico — el mismo
            // criterio que el CTA de registro del EndScreen.
            streak > 1
            ? tn("app.promoAccountBody", streak, { count: streak })
            : t("app.promoAccountBodyPlain")
          : t("app.promoBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={pideCuenta ? crearCuenta : irAPlay}
          className="pm-btn flex-1 !py-2.5 !text-xs"
        >
          {pideCuenta ? t("app.promoAccountCta") : t("app.promoCta")}
        </button>
        <button
          type="button"
          onClick={descartar}
          className="pm-btn pm-btn--ghost !w-auto !py-2.5 !text-xs"
        >
          {pideCuenta ? t("app.promoAccountDecline") : t("app.promoDecline")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3b: Actualizar la convención de `analytics.js`**

Las tres líneas de `app_promo_*` ganan una propiedad. En `src/lib/analytics.js`, sustituye:

```js
//   - app_promo_shown        { surface }   — se pinta la oferta de la app Android
//   - app_promo_click        { surface }   — clic hacia la ficha de Play
//   - app_promo_dismiss      { surface }   — "ahora no" (cierra el faldón para siempre)
```

por:

```js
//   - app_promo_shown        { surface, auth? }  — se pinta la oferta de la app Android
//   - app_promo_click        { surface }         — clic hacia la ficha de Play
//   - app_promo_dismiss      { surface, auth? }  — "ahora no" (cierra ESA cara para siempre)
//        auth: anon | user, solo en faldon_final, donde el bloque tiene DOS
//        caras. Sin cuenta pide cuenta (la racha no viaja al APK: vive en el
//        localStorage del navegador); con cuenta ofrece Play. Son dos ofertas
//        distintas con dos tasas distintas, y sumarlas no significaría nada.
```

- [ ] **Step 4: Pasarle los datos desde `EndScreen`**

En `src/components/configurator/EndScreen.jsx`, sustituye:

```jsx
        <FaldonApp />
```

por:

```jsx
        <FaldonApp user={user} streak={streak} onOpenLogin={onOpenLogin} />
```

(`user`, `streak` y `onOpenLogin` ya están en el ámbito: son props del componente, líneas 122-130.)

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/components/FaldonApp.test.jsx`
Expected: PASS, los trece.

- [ ] **Step 6: Commit**

```bash
git add src/components/FaldonApp.jsx src/components/FaldonApp.test.jsx src/components/configurator/EndScreen.jsx
git commit -m "fix(embudo): al anónimo se le pide cuenta antes de mandarlo a Play"
```

---

## Task 9: La impresión que le falta a la puerta del perfil

La puerta de la app en el perfil mide clics (`app_promo_click` con `surface: "perfil"`) pero no impresiones: un numerador sin denominador, o sea un número del que no se puede sacar una tasa.

**Files:**
- Modify: `src/components/MyStats.jsx:208`

- [ ] **Step 1: Implementar**

En `src/components/MyStats.jsx`, justo debajo de la línea:

```js
  const ofreceApp = debeOfrecerApp();
```

añade:

```js
  // Denominador del embudo del perfil. El clic ya se medía; sin la impresión, el
  // número no se puede convertir en una tasa y no dice si la puerta funciona o
  // si simplemente la ve mucha gente. Ligado a `open` porque este modal se queda
  // montado tras la primera apertura (ver `mounted.*` en App.jsx): sin esa
  // dependencia, contaría una impresión por montaje y ninguna por visita.
  useEffect(() => {
    if (open && ofreceApp) track("app_promo_shown", { surface: "perfil" });
  }, [open, ofreceApp]);
```

Verifica que `useEffect` está en el `import { ... } from "react"` de la cabecera del fichero; si no, añádelo.

- [ ] **Step 2: Verificar**

Run: `npx vitest run && npm run test:estetica`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MyStats.jsx
git commit -m "fix(analitica): la puerta de la app en el perfil medía clics sin impresiones"
```

---

## Task 10: El muro del Archivo deja de anunciar solo Google

`AuthWall` pinta un botón «Continuar con Google» con su logo, pero lo que hace al pulsarlo es abrir un modal que ofrece **dos** métodos. Es literalmente el «no es del todo intuitivo» que originó este trabajo: en varios sitios Google se presenta como *el* método y no como *un* método.

**Files:**
- Modify: `src/components/Garage.jsx:1859-1886`

- [ ] **Step 1: Implementar**

En `src/components/Garage.jsx`, dentro de `AuthWall`, sustituye el bloque del botón (el comentario incluido):

```jsx
        {/* El botón de Google era `bg-papel … text-papel`: texto invisible
            sobre su propio fondo, herencia del tema oscuro donde `papel` era
            blanco sobre grafito. Ahora es el botón sólido del sistema. */}
        <button
          type="button"
          onClick={onLogin}
          className="pm-btn flex items-center justify-center gap-3"
        >
          <GoogleIcon className="h-4 w-4" />
          {t("common.continueWithGoogle")}
        </button>
```

por:

```jsx
        {/* Sin el glifo de Google y sin su nombre: este botón NO entra con
            Google, abre la puerta — que ofrece Google y también el código por
            correo. Anunciar un método concreto en el sitio que lleva a los dos
            es lo que hacía que la entrada por correo pareciera un camino de
            segunda, o directamente invisible. */}
        <button
          type="button"
          onClick={onLogin}
          className="pm-btn flex items-center justify-center gap-3"
        >
          {t("common.signIn")}
        </button>
```

- [ ] **Step 2: Comprobar si `GoogleIcon` se quedó sin consumidores**

Run: `grep -n "GoogleIcon" src/components/Garage.jsx`
Expected: si solo queda su definición, bórrala — un icono sin consumidor es sedimento (regla 16). Si tiene otros usos, déjala.

- [ ] **Step 3: Verificar**

Run: `npx vitest run && npm run build`
Expected: PASS y build en verde. El build es la red que caza un `GoogleIcon` borrado de más.

- [ ] **Step 4: Commit**

```bash
git add src/components/Garage.jsx
git commit -m "fix(ui): el muro del Archivo abre la puerta, no anuncia un método"
```

---

## Task 11: Las DOS plantillas de correo

El hallazgo que motiva media spec. `docs/correo-de-entrada.md` documenta una plantilla, pero el código dispara **dos**, y la que más se envía es la que **no** se personalizó:

| Plantilla de Supabase | La dispara | Quién cae ahí |
|---|---|---|
| **Magic Link** | `signInWithOtp` | Quien pide entrar **antes** de su primer intento. Casi nadie. |
| **Change Email Address** | `updateUser({ email })` | Quien pide entrar desde el final de partida — o sea, ya anónimo. **El caso normal.** |

`asegurarSesionAnonima()` crea la sesión en el **primer intento**, así que para cuando aparece el CTA de «guarda tu progreso» el jugador ya es anónimo y su correo sale por la segunda fila de esa tabla.

**Files:**
- Rewrite: `docs/correo-de-entrada.md`

- [ ] **Step 1: Comprobar el estado real antes de escribir nada**

En el dashboard de Supabase: **Authentication → Email Templates**. Mira si «Change Email Address» está personalizada o es la de fábrica (en inglés, asunto «Confirm Change of Email»). Anota lo que veas — si estuviera ya personalizada, este documento cambia de tono pero el contenido técnico (dos plantillas, `{{ .Token }}`, sin enlace) sigue siendo el mismo.

- [ ] **Step 2: Reescribir el documento**

Cambia el título y la sección «Por qué se personaliza» de `docs/correo-de-entrada.md` para que abran así (el resto del documento —restricciones del correo, DNS, SPF— se conserva tal cual):

```markdown
# Los correos de entrada

Plantillas del código de acceso y notas de configuración del envío. Viven aquí y
no en el código porque se editan en el dashboard de Supabase
(**Authentication → Email Templates**), pero se versionan igual que el SQL de
`scripts/`: son parte del producto, no un ajuste suelto.

## SON DOS PLANTILLAS, NO UNA

Es el error que estuvo en producción y costó descubrir, porque desde el código
no se ve: `src/lib/auth.js` llama a dos funciones distintas de Supabase según el
estado de la sesión, y **cada una usa su propia plantilla**.

| Plantilla | La dispara | Quién cae ahí |
|---|---|---|
| **Magic Link** | `signInWithOtp` | Quien pide entrar ANTES de su primer intento. |
| **Change Email Address** | `updateUser({ email })` | Quien pide entrar con una sesión anónima ya viva. |

Y la segunda es **la normal**. `asegurarSesionAnonima()` crea la sesión en el
primer intento, así que para cuando el jugador ve el CTA de «guarda tu progreso»
al final de la partida ya es anónimo: su correo sale por «Change Email Address».
Personalizar solo «Magic Link» es maquetar con esmero el correo que casi nadie
recibe.

**Si tocas una, toca la otra.** El contenido es el mismo; lo único que cambia es
dónde se pega.

## Por qué se personalizan

La plantilla que trae Supabase de fábrica es un párrafo genérico **en inglés**,
sin remitente reconocible y con el aspecto de un correo de sistema. A un jugador
español que acaba de leer «El diario de los que reconocen un coche por el faro»
le llega eso y parece de otra empresa — justo en el paso donde se está decidiendo
a entrar.

**Un solo correo bilingüe, español primero.** Las plantillas de Supabase son una
por proyecto: no hay selección por idioma del usuario como en `i18n/`. Con la
audiencia mayoritariamente española y una minoría en inglés, un correo con las
dos versiones cuesta cuatro líneas y no deja fuera a nadie.

## El código, no el enlace

`{{ .Token }}` es el protagonista y **`{{ .ConfirmationURL }}` no aparece**. No es
una preferencia estética:

- La plantilla es **una por proyecto**, así que el mismo correo lo lee quien está
  dentro del APK. Allí el enlace o no abre nada útil, o le mete la sesión en el
  navegador del sistema **e invalida el código** que estaba a punto de escribir
  en la app.
- Un correo con dos caminos donde uno rompe al otro es peor que un correo con
  uno solo.

El precio, aceptado: en escritorio hay que teclear seis cifras en vez de pulsar
un botón.
```

- [ ] **Step 3: Sustituir la plantilla HTML**

En la sección «La plantilla», cambia el encabezado por «## La plantilla (la MISMA en las dos)» y sustituye el bloque HTML entero por:

```html
<div style="margin:0;padding:24px;background:#f5f1e8;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:480px;margin:0 auto;background:#faf7f0;border:1px solid #d8d0bf;padding:32px 28px;">

    <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8a8172;">
      Edición del día
    </p>
    <p style="margin:0;font-size:30px;line-height:1.05;font-weight:bold;color:#1b1712;">
      Coche del Día
    </p>

    <div style="border-top:3px double #1b1712;border-bottom:3px double #1b1712;margin:20px 0 24px;padding:6px 0;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#1b1712;">
        Tu código · Your code
      </p>
    </div>

    <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#1b1712;">
      Escribe estas seis cifras donde te las pide el juego. No hay contraseña
      que recordar.
    </p>

    <p style="margin:0;background:#1b1712;color:#faf7f0;text-align:center;padding:18px 12px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:.32em;">
      {{ .Token }}
    </p>

    <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6b6355;">
      El código caduca en una hora y solo funciona una vez. Si no has pedido
      entrar, ignora este correo: no pasa nada.
    </p>

    <div style="border-top:1px solid #d8d0bf;margin:24px 0 0;padding-top:16px;">
      <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6355;">
        <strong style="color:#1b1712;">In English —</strong> Type these six digits
        where the game asks for them. No password needed. The code expires in one
        hour and works only once. If you didn’t request it, just ignore this email.
      </p>
    </div>

    <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8a8172;text-align:center;">
      cochedeldia.com
    </p>

  </div>
</div>
```

El asunto, para **las dos**: `Tu código de acceso · Coche del Día`

**Ojo al `letter-spacing` del código:** con `.32em` en un monoespaciado de 34px, seis cifras caben en 480px de ancho. Si lo subes, en Gmail móvil el código parte en dos líneas y deja de poderse copiar de un gesto.

- [ ] **Step 4: Añadir el ajuste que hay que verificar**

En la tabla «Configuración del envío», añade estas dos filas:

```markdown
| Plantillas | `/auth/templates` | **Magic Link** Y **Change Email Address**, las dos con el mismo HTML |
| Secure email change | `/auth/providers` → Email | Verificar. Con un anónimo no hay correo antiguo que confirmar, así que debería mandar UN solo correo; si mandara dos, hay que desactivarlo. |
```

Y sustituye el apartado «Antes de encender el flag» por:

```markdown
## Antes de encender el flag

1. Pídete un código **sin sesión anónima** (ventana nueva, pide entrar antes de
   jugar): comprueba que llega el de «Magic Link».
2. Pídete otro **con sesión anónima** (juega un intento primero, luego pide
   entrar): comprueba que llega el de «Change Email Address» y que es el mismo
   correo maquetado, no el de fábrica en inglés.
3. Los dos, a **bandeja de entrada y no a spam** (es lo que verifican DKIM y
   SPF; si cae en spam, algo del DNS no está bien).
4. Canjea los dos códigos y confirma que en el segundo **la racha sobrevive**.
5. Solo entonces, `VITE_EMAIL_LOGIN=true` y redeploy.

Encender el flag antes de verificar la entrega es publicar una puerta sin saber
si abre. Y probar solo el caso 1 es probar el camino que casi nadie recorre.
```

- [ ] **Step 5: Commit**

```bash
git add docs/correo-de-entrada.md
git commit -m "docs(correo): son DOS plantillas, y la que más se envía no estaba personalizada"
```

---

## Task 12: Verificación, Preview y entrega

**Regla 13, con la desviación ya aprobada.** Este cambio toca `src/`, o sea que viaja en el APK y le tocaría ir directo a `main` sin PR. Se hace un alto en el Preview **porque media entrega es web y eso el Preview sí lo ejercita**, y porque un fallo de auth no se detecta con tests unitarios: el `verifyOtp` real, la entrega del correo y «Secure email change» solo se ven en vivo.

**Files:**
- Modify: `android/app/build.gradle:28-29`

- [ ] **Step 1: La suite entera, en verde**

```bash
npm test && npm run build && npm run test:layout
```

Expected: todo PASS. `npm test` encadena `test:estetica`, `test:unit`, `test:security` y `test:attacks`.

`test:layout` mide la composición en seis pantallas con y sin teclado. Importa aquí porque el modal de entrada gana un campo de texto que **en la app abre el teclado del sistema por primera vez en esa pantalla** (el precedente es `NicknameModal`, que ya lo hace y funciona).

- [ ] **Step 2: Comprobar que no queda nada del enlace**

```bash
grep -rn "magic\|signInWithEmail\|emailRedirectTo\|emailSent" src/
```

Expected: sin resultados en código vivo. Si aparece algo, es sedimento del método anterior.

- [ ] **Step 3: Empujar la rama**

```bash
git push -u origin claude/login-codigo-6-digitos
```

Vercel despliega un Preview automático. **Esto NO es la entrega**: es el banco de pruebas.

- [ ] **Step 4: Dejar las plantillas listas ANTES de probar**

En el dashboard de Supabase, aplica lo de la tarea 11: las **dos** plantillas con el mismo HTML y el mismo asunto, y comprueba «Secure email change». Sin esto, el paso 5 mide un correo que no es el que va a salir.

- [ ] **Step 5: Verificación manual en el Preview** — lo que ningún test cubre

En la URL del Preview, con un móvil o el navegador en modo móvil:

- [ ] **Anónimo con racha (EL CAMINO IMPORTANTE).** Juega un intento (nace la sesión anónima), pide entrar, recibe el código, canjéalo. **La racha y el Archivo tienen que seguir ahí.** Si se pierden, `email_change` no se comporta como documenta Supabase y hay que aplicar el respaldo de la spec.
- [ ] **Sin sesión previa.** Ventana nueva, pide entrar antes de jugar. Llega el otro correo, y también entra.
- [ ] **Los dos correos** llegan a bandeja de entrada, no a spam, y con el diseño correcto.
- [ ] **Código incorrecto**: mensaje propio y el campo se vacía.
- [ ] **Código caducado**: espera una hora (o pide dos códigos seguidos y usa el primero, que el segundo invalida) y comprueba que el mensaje es el de caducado, no el de incorrecto.
- [ ] **Reenvío**: la cuenta atrás corre y el botón aparece al llegar a cero.
- [ ] **«Usar otro correo»** vuelve al paso 1 con el correo puesto.
- [ ] **Google sigue funcionando** en web, con sesión anónima y sin ella.
- [ ] **El faldón**: con tres días jugados y sin cuenta, pide cuenta. Al entrar, pasa a ofrecer Play sin recargar.
- [ ] **Umami**: los eventos `login_*` aparecen en el panel con su `surface`.

- [ ] **Step 6: Subir la versión (regla 17)**

Solo cuando el paso 5 esté entero en verde. En `android/app/build.gradle`, líneas 28-29:

```gradle
        versionCode 56
        versionName "1.10.0"
```

Minor y no patch: no es un arreglo, es un camino de entrada nuevo. `versionCode` estrictamente mayor que el último subido a Play (internal y closed comparten numeración).

```bash
git add android/app/build.gradle
git commit -m "chore(android): v56/1.10.0"
git push
```

- [ ] **Step 7: Entregar a `main`**

```bash
git push origin HEAD:main
```

- [ ] **Step 8: Sincronizar el checkout principal**

En el checkout principal (no en este worktree):

```bash
git pull && npm run cap:sync
```

Sin esto el APK sale con la compilación anterior aunque el código esté en `main`: los assets web son bundled y están gitignorados (regla 15). `cap:sync` ejecuta además `check-bundle-size.mjs`.

- [ ] **Step 9: Avisar**

Decir explícitamente qué versión va a salir (**v56 / 1.10.0**) y que el único paso que queda es pulsar *Build* en Android Studio.

---

## Notas de cierre

**Lo que este plan NO hace, a propósito:**

- No toca `api/`, ni el esquema, ni ningún endpoint. Todo el cambio es de cliente.
- No añade contraseña, ni «recordar dispositivo», ni SMS.
- No toca el login de `/admin-tools`.
- No mete `iOS` en la ecuación.

**Si `email_change` falla en el paso 5 de la tarea 12**, el respaldo escrito en la spec es hacer que `pedirCodigo` NO intente `updateUser` y vaya siempre por `signInWithOtp`. Eso deja la puerta abierta pero **pierde el progreso anónimo**, que es justo lo que este trabajo venía a salvar: no lo apliques sin decírselo al usuario, porque cambia el producto, no solo el código.
