# Entrada por código de 6 dígitos, y la derivación web→app encadenada

**Fecha:** 2026-08-27
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Rama:** `claude/login-codigo-6-digitos` → Preview de Vercel → `main`
**Contexto previo:**
`docs/superpowers/specs/2026-06-21-native-google-login-design.md` (login nativo),
`docs/correo-magic-link.md` (plantilla y SMTP).

---

## El problema

Son dos síntomas con una raíz común.

**1. La puerta de entrada pide salir de la pantalla.** Hoy el modal ofrece Google
y un **enlace mágico** por correo; en la app Android ni siquiera eso, porque
`emailLoginDisponible()` devuelve `false` en nativo a propósito (el enlace abriría
el navegador del sistema y la sesión se crearía FUERA del WebView). O sea: en el
APK es **Google o nada**, y en web el segundo camino obliga a irse a la bandeja de
correo, que es exactamente donde se desangran los embudos en móvil.

**2. El anónimo que instala la app pierde todo.** `<FaldonApp />` se pinta en
`EndScreen.jsx:519` sin mirar si hay cuenta, y `debeOfrecerFaldon()` tampoco lo
comprueba. Pero la sesión anónima vive en el `localStorage` del navegador y el
WebView de la app sirve desde `https://localhost` en su propio sandbox: **no hay
ningún mecanismo por el que esa racha pueda viajar**. Hoy, a un anónimo con nueve
días de racha se le ofrece la app y, si la instala, aparece en el día 0 sin que
nadie le haya avisado.

**La raíz común es que registrarse no tiene un argumento concreto.** «Guarda tus
estadísticas en la nube» es abstracto y no urge. «Tu racha de 9 días vive en este
navegador; en el móvil empezarías de cero» es verdad, es concreto, y cae justo en
el momento en que se lo estamos pidiendo.

### Y un tercer problema, encontrado al verificar

`updateUser({ email })` **no usa la plantilla que personalizamos**.
`docs/correo-magic-link.md` documenta «Magic link or OTP», pero
`asegurarSesionAnonima()` crea la sesión en el **primer intento**, así que quien
abre el modal desde el final de partida ya es anónimo y `auth.js:144` se va por
`updateUser`, que dispara la plantilla **«Change Email Address»** — la de fábrica,
en inglés y con asunto de correo de sistema. El correo bilingüe solo lo recibe
quien pide entrar ANTES de su primer intento: casi nadie.

**Verificar en el dashboard antes de dar esto por bueno.** Es el comportamiento
documentado de Supabase y encaja con el síntoma, pero no se ha visto la plantilla
real. Si estuviera personalizada, este apartado decae y el resto de la spec no
cambia.

### El agujero que impide saber si algo de esto funciona

**No hay un solo evento de analítica en el login.** Existen
`app_promo_shown/click/dismiss` para la oferta de la app, pero cero para la puerta
de entrada. Hoy es imposible distinguir entre «el anónimo nunca abre el modal»,
«lo abre y lo cierra» y «pide el correo y no vuelve». Solo el tercero se arregla
cambiando el método, así que la instrumentación entra en esta misma entrega.

---

## Por qué NO contraseña

Se evaluó y se descartó. Queda escrito para no volver a discutirlo:

1. **Registrarse con contraseña es más largo, no más corto.** Con confirmación de
   correo activada son cinco pasos (correo → inventar contraseña → ir a la bandeja
   → confirmar → volver): el viaje del enlace mágico MÁS inventar una contraseña.
   Sin confirmación, se aceptan correos no verificados y se pierde la recuperación
   de cuenta.
2. **Solo paga en el segundo login**, que en un juego diario con sesión persistente
   prácticamente no ocurre.
3. **Trae cola permanente**: recuperación (que necesita el mismo correo), fuerza
   mínima, contraseñas filtradas, soporte de «no me entra».
4. **No ataca la barrera real**, que es el argumento, no el mecanismo.

El **código de 6 dígitos** gana en todos los ejes que importan aquí: no sale de la
pantalla (ni en web ni en app), es la misma llamada que ya existe, no hay nada que
recordar ni que recuperar, y reaprovecha entero el SMTP de Resend ya configurado.

---

## Decisiones cerradas

| Decisión | Valor | Motivo |
|---|---|---|
| Método nuevo | **Código de 6 dígitos por correo** (`verifyOtp`) | No sale de la pantalla; mismo endpoint que ya se usa. |
| Contraseña | **No** | Ver arriba. |
| El enlace del correo | **Se retira** | Plantilla única por proyecto: el mismo correo lo lee quien está en el APK, donde el enlace o no abre nada útil o le loguea en el navegador **e invalida el código** que iba a escribir. Un correo con dos caminos donde uno rompe al otro es peor que uno con uno solo. Precio aceptado: en escritorio hay que teclear seis dígitos. |
| El código en la app | **Sí** | Es lo que desbloquea el segundo método en Android sin depender de que Chrome respete el App Link tras el redirect de Supabase. |
| Jerarquía del modal | **Google arriba, código debajo** | Sin cambios: Google sigue siendo un solo toque y lo que usa la mayoría. |
| Vinculación del anónimo | **Se conserva** (`updateUser` → `verifyOtp` con `email_change`) | Es lo que salva la racha. Es la razón de ser del cambio, no un detalle. |
| Faldón para anónimos | **Encadenado**: primero cuenta, luego Play | Instalar sin cuenta destruye progreso. Y convierte el embudo de la app en el mejor argumento de registro que hay. |
| Reenvío del código | **Sí, con cuenta atrás de 60 s** | Hoy no existe a propósito por el límite de 2 correos/hora de Supabase; con el SMTP de Resend ese motivo caducó, y sin reenvío «no me llega» es un callejón sin salida. |
| Un campo o seis casillas | **Un campo** | `inputMode="numeric"` + `autoComplete="one-time-code"`: Android ofrece el código solo. Seis casillas son más código y peor pegado. |

### Fuera de alcance (YAGNI)

- Contraseña, en cualquier forma.
- «Recordar este dispositivo».
- SMS / WhatsApp.
- Correos separados por idioma (sigue siendo un correo bilingüe, español primero:
  las plantillas de Supabase son una por proyecto).
- iOS.
- Tocar el login de `/admin-tools`.

---

## Arquitectura

```
  Modal de entrada
   ├── Google  ──────────────────────────────────────────────┐
   │     web:    signInWithOAuth / linkIdentity (redirect)    │
   │     app:    nativeGoogleSignIn → signInWithIdToken       │
   │                                                          │
   └── Correo ── PASO 1: pedirCodigo(email)                   │
         ├── ¿sesión anónima vigente?                         │
         │     SÍ  → updateUser({ email })   → tipo 'email_change'
         │     NO  → signInWithOtp({ email }) → tipo 'email'  │
         │           (shouldCreateUser: true)                 │
         │                                                    │
         └── PASO 2: verificarCodigo(email, codigo, tipo)     │
               supabase.auth.verifyOtp({ email, token, type })│
                                                              │
                              ┌───────────────────────────────┘
                              ▼
                 onAuthStateChange → useAuthSession
                   (la clave `${id}-${anon}` cambia sola al vincular)
                              │
                              ├─ setUser(cuentaReal)
                              └─ track("login_success", { method, vinculado })
```

**El `tipo` es la pieza crítica.** Son dos tokens distintos en Supabase y
confundirlos produce «código incorrecto» para el 100% de uno de los dos caminos.
Por eso `pedirCodigo` lo devuelve y el modal lo arrastra hasta la verificación en
vez de recalcularlo (entre el paso 1 y el paso 2 la sesión podría haber cambiado).

---

## Unidades

### `src/lib/auth.js`

- **`emailLoginDisponible()`** — deja de excluir nativo. Queda solo el flag
  `VITE_EMAIL_LOGIN === "true"`. El comentario que justifica la exclusión nativa se
  reemplaza por el que explica por qué ya no aplica (no hay enlace que salga del
  WebView).
- **`pedirCodigo(email)`** — sustituye a `signInWithEmail`. Devuelve
  `{ error, tipo }` con `tipo ∈ { 'email', 'email_change' }`. Conserva la lógica de
  hoy: con sesión anónima vigente intenta `updateUser({ email })` (tipo
  `email_change`); si falla porque el correo ya pertenece a otra cuenta, cae a
  `signInWithOtp` (tipo `email`) — que es entrar a la cuenta que ya existe, a costa
  del progreso anónimo, que es inevitable porque son dos cuentas distintas.
- **`verificarCodigo(email, codigo, tipo)`** — nueva.
  `supabase.auth.verifyOtp({ email, token: codigo, type: tipo })`. Devuelve
  `{ data, error }` estilo Supabase.
- **`emailRedirectTo`** desaparece de `signInWithOtp`: sin enlace en el correo no
  tiene consumidor.

`signInWithGoogle`, `esCuentaReal`, `asegurarSesionAnonima`, `haySesionLocal` y
`signOut` **no se tocan**.

### `src/components/LoginModal.jsx`

Pasa de dos caras (formulario / acuse de recibo) a **tres**: formulario de correo →
formulario de código → (sesión creada, el modal se cierra solo).

El estado `enviadoA` deja de ser un acuse muerto («abre el enlace y entrarás») y
pasa a ser el paso donde se escribe. Estado nuevo: `tipoOtp`, el que devolvió
`pedirCodigo`.

Paso del código:
- Un `<input>` con `inputMode="numeric"`, `autoComplete="one-time-code"`,
  `maxLength={6}`, `pattern="[0-9]*"`.
- **Reenviar** con cuenta atrás de 60 s (deshabilitado mientras corre). Reenviar
  vuelve a llamar a `pedirCodigo` y **refresca `tipoOtp`**.
- **Cambiar de correo**: vuelve al paso 1 conservando lo tecleado.
- Verificación automática al llegar a 6 dígitos, más botón explícito (el pegado
  desde el gestor de contraseñas no siempre dispara los mismos eventos).

Se conserva tal cual: la jerarquía (Google con peso arriba, filete, correo debajo),
el aviso de `identidad-ocupada`, la chapa de marca blanca de Google y el
`LanguageStrip` del final.

**El teclado dentro del modal en la app** ya tiene precedente (`NicknameModal`
tiene un `<input>` y funciona), y `lib/teclado.js` ignora a propósito los campos
dentro de un `role="dialog"`. Riesgo bajo, pero el modal es centrado
(`items-center justify-center`) y con el teclado subido puede desplazarse: se
verifica con `npm run test:layout`.

### `src/components/FaldonApp.jsx`

Recibe `user` y `streak` desde `EndScreen`.

- **Sin cuenta** → faldón de REGISTRO: kicker propio, cuerpo con el argumento real
  (`streak > 1` nombra la racha; con 0 o 1 va el genérico, igual que ya hace el CTA
  de `EndScreen`), CTA = `onOpenLogin`. Evento
  `app_promo_shown { surface: 'faldon_final', auth: 'anon' }`.
- **Con cuenta** → el faldón de Play de hoy, sin cambios.
  `app_promo_shown { surface: 'faldon_final', auth: 'user' }`.

Al registrarse desde ahí, `EndScreen` re-renderiza con `user` y aparece la oferta
de Play: **la cadena se cierra sola**, sin navegación extra.

**Dos claves de descarte, no una.** `cd_app_faldon_no` se reserva para el faldón de
Play; el de registro lleva la suya (`cd_registro_faldon_no`). Rechazar «regístrate»
no puede enterrar la oferta de Play para cuando ya tenga cuenta.

### `src/lib/edicionApp.js`

- `debeOfrecerFaldon()` no cambia de firma: sigue decidiendo «¿le sirve la app y es
  buen momento?». Quién ve cuál de las dos caras lo decide `FaldonApp` con `user`.
- Se añade `faldonRegistroDescartado()` / `marcarFaldonRegistroDescartado()`,
  gemelas de las que ya existen.
- La cabecera del módulo documenta que la app **no hereda el progreso anónimo**, que
  es el porqué de todo el encadenado.

### `src/components/MyStats.jsx`

**Corrección a lo dicho en la discusión: la puerta del perfil ya hacía lo correcto.**
Solo se pinta con cuenta real (rama de `MyStats.jsx:245`), o sea que la cadena ya
estaba ahí. Lo único que le falta es el denominador:

- Añadir `app_promo_shown { surface: 'perfil' }` en un `useEffect` cuando
  `ofreceApp` y el modal esté abierto. Hoy mide clics sin impresiones.

### `src/components/Garage.jsx`

El `AuthWall` (línea 1859) anuncia «Continuar con Google» con su logo pero lo que
hace es abrir un modal con dos métodos. Pasa a `common.signIn` sin el glifo de
Google. Es literalmente el «no es del todo intuitivo» del origen de esta spec.

### `src/lib/analytics.js` y sus llamadores

Eventos nuevos, con su bloque de convención en la cabecera del módulo:

```
login_prompt_shown { surface }            endscreen | ranking | garage | sumario
login_method       { method }             google | email
login_code_sent    { vinculando }         true si el tipo es email_change
login_verified     { result }             ok | bad_code | expired | error
login_success      { method, vinculado }
login_dismiss      { surface }
```

Embudo completo: `shown → method → code_sent → verified → success`.

`login_success` se emite desde **`useAuthSession`**, no desde el modal: es el único
sitio que ve el éxito de Google en web (la página se va al redirigir) y ya detecta
la transición sola — su `lastUserIdRef` guarda `${id}-${anon}`, que cambia al
vincular. `vinculado` = el `id` anterior era el mismo (conservó el progreso).

`surface` se pasa a `openLogin(surface)` desde los **cuatro** llamadores que ya
existen: `EndScreen` (CTA fantasma del final, vía `Configurator`), `Ranking` (pie de
la tabla), `Garage` (el `AuthWall`) y `SumarioModal` (la portadilla de perfil, que
para un anónimo abre el login). **No hay superficie `perfil`**: `MyStats` solo se
monta con cuenta real, así que el anónimo llega siempre por el sumario. `perfil` sí
existe, pero en la otra familia de eventos (`app_promo_*`), y son cosas distintas.

### `docs/correo-magic-link.md` + dashboard de Supabase

**Dos plantillas, no una** — este es el arreglo del tercer problema:

| Plantilla | La dispara | Hoy |
|---|---|---|
| **Magic Link** | `signInWithOtp` (jugador sin sesión anónima) | Personalizada |
| **Change Email Address** | `updateUser({ email })` (jugador anónimo: **el caso normal**) | De fábrica, en inglés |

Las dos pasan a llevar el mismo diseño y **`{{ .Token }}` como protagonista**, sin
`{{ .ConfirmationURL }}`. El documento se reescribe para dejar claro que son dos y
por qué la segunda es la que más se envía.

Comprobar además en el dashboard el ajuste **«Secure email change»**: con un
anónimo no hay correo antiguo que confirmar, así que debería mandar un solo correo,
pero hay que verlo en vivo.

### `src/i18n/locales/{es,en}.json`

Claves nuevas bajo `app.*` para: título y cuerpo del paso del código, etiqueta y
marcador del campo, CTA de verificar, reenviar (con y sin cuenta atrás), cambiar de
correo, y los errores (`codeInvalid`, `codeExpired`). Más las del faldón de
registro. Se retiran `emailSentTitle` / `emailSentBody` / `emailSentHint` /
`emailNoPassword`, que dejan de tener consumidor.

---

## Manejo de errores

| Caso | Qué ve el jugador |
|---|---|
| Correo mal formado | Toast, sin salir del paso 1 (validación laxa de hoy, `EMAIL_RE`). |
| Rate limit al pedir código | El mensaje de esperar que ya existe (`emailRateLimited`), no «inténtalo de nuevo». |
| El correo ya es de otra cuenta | `updateUser` falla → se cae a `signInWithOtp` en silencio, igual que hoy, y se entra a la cuenta existente. |
| Código incorrecto | Error bajo el campo, el campo se vacía y mantiene el foco. `login_verified { result: 'bad_code' }`. |
| Código caducado | Mensaje propio que invita a reenviar (no el mismo que «incorrecto»: la acción que resuelve es distinta). |
| Fallo de red al verificar | Toast genérico, el código se conserva en el campo. |
| Google falla | Sin cambios (`aviso` / `authCallback.js`). |

Principio heredado de la regla 21: **degradar no es inventarse el estado**. Si
`verifyOtp` falla, no se cierra el modal ni se finge sesión.

---

## Pruebas

- **`src/lib/auth.test.js`** (amplía el patrón `vi.doMock` que ya usa): que
  `emailLoginDisponible()` sea `true` en nativo con el flag; que `pedirCodigo`
  devuelva `tipo: 'email_change'` con sesión anónima y `'email'` sin ella; que el
  fallo de `updateUser` caiga a `signInWithOtp` devolviendo `'email'`; que
  `verificarCodigo` pase el `type` recibido y no uno calculado.
- **`src/components/FaldonApp.test.jsx`**: las dos caras según `user`; que el
  descarte del faldón de registro NO oculte el de Play; que las claves de descarte
  sean independientes.
- **`LoginModal`**: recorrido de los dos pasos, reenvío bloqueado durante la cuenta
  atrás, y que el `tipo` que llega a `verificarCodigo` sea el que devolvió
  `pedirCodigo`.
- **Suites del repo**: `npm test` (incluye `test:estetica`), `npm run build`,
  `npm run test:layout`.
- **En el Preview, a mano** — lo que ningún test cubre: pedir código como anónimo
  con racha, verificarlo, y comprobar que **la racha sobrevive**; pedirlo sin
  sesión; código caducado; y que llegan los dos correos con el diseño correcto y a
  bandeja de entrada, no a spam.

---

## Entrega

Toca `src/` → viaja en el APK → **regla 13** (directo a `main`, sin PR) y **regla
17** (`chore(android): v56/1.10.0`; minor por flujo nuevo, viniendo de v55/1.9.0).

**Desviación aprobada de la regla 13.** Un cambio de auth no se verifica con tests
unitarios: `verifyOtp` real, la entrega del correo y «Secure email change» solo se
ven en vivo. Como **media entrega es web, y eso un Preview sí lo ejercita**, el
orden es: rama → Preview → verificación manual del flujo web contra Supabase de
verdad → merge a `main` → versión → `npm run cap:sync` en el checkout principal.
Un paso más del que pide la regla, aceptado porque un fallo silencioso aquí deja
sin entrar a todo el mundo.

**Cambios de dashboard, fuera del repo** (van en el runbook del documento del
correo, no en el código): las dos plantillas y el ajuste de «Secure email change».
Sin ellos el flujo funciona pero el correo llega feo, así que van ANTES de mergear.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| `email_change` se comporta distinto de lo documentado con anónimos | Es lo primero que se prueba en el Preview. Si no vale, el respaldo es entrar por `signInWithOtp` **perdiendo el progreso anónimo** — peor producto, pero puerta abierta. |
| «Secure email change» pide confirmar dos correos | Se desactiva o se documenta. Con anónimo no debería aplicar. |
| El teclado descoloca el modal centrado en la app | `test:layout` + revisión en el Preview con el navegador en móvil. |
| Quitar el enlace empeora el escritorio | Aceptado y escrito. Si los datos dijeran lo contrario, devolverlo es editar una plantilla, no código. |
| La instrumentación no dice nada porque nadie abre el modal | Es precisamente lo que queremos saber. Si sale eso, la siguiente entrega es el argumento, no el mecanismo. |
