# La hoja abre en modo lista, y la palanca del teclado

**Fecha:** 2026-08-27
**Ámbito:** app Android (`esApp()`), hoja de selección del cupón
**Entrega:** v59 / 1.10.3 — cambios de app, van directos a `main` (regla 13)

---

## De qué va esto

Tres cosas que no encajaban en la hoja de selección de marca/modelo, y una cuarta
—la grande— que se aplaza a propósito hasta tener una respuesta del móvil.

1. **El índice A-Z arrastra la hoja entera** (bug).
2. **La hoja abre con el teclado subido**, y el teclado se come la lista que el
   índice A-Z vino a hacer navegable.
3. **La fotografía encoge una cantidad distinta en cada móvil** cuando sube el
   teclado. Es la queja de fondo, y su causa es nativa, no de CSS.
4. *(Aplazado)* **Dos modos, lista y teclado, que ocupan lo mismo.** Se diseña
   cuando el spike de esta entrega conteste dos preguntas.

Lo que sale ahora es un **spike con dos arreglos dentro**: la palanca que puede
resolver (3), medida en un APK real, más los arreglos de (1) y (2), que son
independientes de ella y están terminados.

---

## 1 — El índice A-Z deja de arrastrar la hoja

### El fallo

Bajar el dedo por la tira A-Z hace **dos cosas a la vez**: salta de letra *y*
arrastra la hoja entera, con la fotografía siguiéndola. Pasado el 28% del alto,
cierra la hoja.

### Por qué

Colisión de gestos, introducida por el orden en que se construyeron las piezas:

```
4cd0ca1  el índice A-Z de la hoja se recorre con el dedo
a522054  la hoja se arrastra para cerrarla, y la foto viaja con ella   ← después
a4e4235  la hoja tiene recorrido, y la foto lo recorre con ella        ← después
```

- `useArrastreHoja` engancha `touchstart`/`touchmove` en **toda** `.pm-hoja`.
- `.pm-indice` usa *pointer events* y `touch-action: none`. Eso le quita el
  scroll al navegador, pero **los eventos táctiles siguen burbujeando** hasta la
  hoja.
- En `onStart`, `scrollerBajo(e.target)` sube desde el botón de la letra buscando
  un ancestro con `overflow-y: auto|scroll`. No encuentra ninguno: `.pm-indice`
  no scrollea, y `.pm-lista-caja` y `.pm-hoja-cuerpo` son `overflow: hidden`.
  `.pm-lista` es **hermana**, no ancestro. Devuelve `null` → `permitido = true`.

### El arreglo

`useArrastreHoja` gana una regla: **no reclama un gesto que nace dentro de algo
que ya es dueño de su vertical.** En `onStart`, antes de medir nada:

```js
// Hay elementos que ya son dueños de su gesto vertical (el índice A-Z de la
// lista, que se recorre con el dedo). Sus toques burbujean hasta aquí igual,
// así que hay que devolvérselos: si no, bajar por el índice salta de letra Y
// arrastra la hoja, y pasado el umbral se la lleva por delante.
if (e.target instanceof Element && e.target.closest("[data-gesto-propio]")) {
  permitido = false;
  return;
}
```

Y `.pm-indice` declara `data-gesto-propio`.

**Por qué un atributo y no leer `touch-action` con `getComputedStyle`:** el
`touch-action: none` del índice ya *es* esa declaración, pero interrogar estilos
calculados en cada `touchstart` es caro y se rompe solo en cuanto alguien
reorganice el CSS. Un atributo se lee en el JSX y sale en el inspector. Es
además la misma idea que ya sigue `scrollerBajo`: «esto de aquí no es asunto de
este gesto».

**No hay caso hermano latente:** `.pm-decadas` (la tira de décadas del año) es
`overflow-x: auto`, y aunque el `overflow-y` calculado pase a `auto` por el
emparejamiento del CSS, `desbordaEnVertical` lo descarta antes por su
`scrollHeight <= clientHeight`. No colisiona.

---

## 2 — La hoja abre en modo lista

### Lo que cambia

Fuera el `useLayoutEffect` del autofoco y la constante `UMBRAL_AUTOFOCO` de
`SelectorLista.jsx`. El buscador **sigue visible arriba**, como una fila inerte
que dice «también puedes escribir»; tocarlo levanta el teclado.

Y el índice A-Z pasa a depender del **foco del buscador**, no solo de si hay
texto tecleado:

| Estado | Lista | Índice A-Z |
|---|---|---|
| Sin foco, sin texto | agrupada por inicial | **sí** |
| Con foco, sin texto | agrupada por inicial | no |
| Con texto | plana, filtrada | no |

Una frase: **la tira A-Z vive mientras no haya teclado.**

Implementación: `grupos` (el dato) no se toca. Lo que se condiciona es pintar el
`<nav className="pm-indice">`, con un booleano de foco (`onFocus`/`onBlur` del
campo) y un `&&`.

### Por qué

El argumento que defiende el autofoco en la cabecera de `SelectorLista` se apoya
en una premisa que dejó de ser cierta: «dentro de la hoja el teclado no cuesta
nada». Cuesta, desde que la hoja se recortó para no tapar la foto.

El cromo de la hoja, medido sobre el CSS (`index.css`): tirador 11px
(`3px` + `8px` de margen), cabecera ~49px (~67 cuando lleva apunte: modelo y
año), buscador ~57px. **117px antes de la primera fila**, y una fila son 52.

Con el teclado arriba en un 360x780 la hoja se queda en 300px (`test:layout`), o
sea **183px de lista: tres filas y media** — sobre ochenta marcas. El índice A-Z
existe precisamente para hacer navegable esa lista, y con tres filas y media a la
vista no sirve para nada: apuntar a una letra de 10px para ver tres marcas es
peor que arrastrar. Compiten por el mismo hueco y el teclado gana siempre.

Y en el mismo caso la fotografía baja de 336x252 a 232x174, que es la queja de
(3). Las dos mitades del problema salen del mismo sitio.

### El foco como señal, no `visualViewport`

En la app no hay teclado físico, así que **campo enfocado ≡ teclado arriba**, sin
medir nada. Y bajar el teclado sin elegir ya funciona: el IME de Android se come
el «atrás» mientras está subido, así que atrás = teclado abajo, atrás otra vez =
hoja cerrada (`useHistoryClose`).

### Documentación que arrastra

- **CLAUDE.md regla 18(e)** documenta el autofoco («el buscador **sí** se
  autoenfoca, pero solo con más de 12 opciones»). Hay que reescribirla.
- **La cabecera de `SelectorLista.jsx`** dedica cuatro párrafos a defender lo
  contrario de lo que va a hacer. Se reescribe con el motivo nuevo.
- **El comentario de `.pm-buscar` en `index.css`** ya dice «NO se autoenfoca».
  Lleva meses mintiendo; vuelve a ser verdad y se le añade el porqué.
- **`GuessForm.app.test.jsx`** rellena el catálogo hasta 12 marcas *solo* para
  cruzar el umbral del autofoco (`MARCAS_RELLENO`, y su comentario lo dice). El
  relleno se queda —hace falta para pasar de `UMBRAL_INDICE` y que aparezca el
  índice— pero su comentario cambia de motivo, y se añade una prueba de que al
  abrir la hoja **el buscador NO tiene el foco**.

---

## 3 — La palanca: que Android deje de encoger el WebView

### El hallazgo

La fotografía no encoge por culpa del CSS. Encoge porque **el WebView se
redimensiona** al subir el teclado: la ventana pasa de 780 a 490, el pliego se
recompone y le da a la foto 246 de ancho en vez de 336, y *después*
`escenarioApartado` le aplica el `scale`. **Dos causas apiladas, y la primera es
nativa.**

Y quien redimensiona **no** es `adjustResize` (en API 35+ se ignora con
edge-to-edge) ni `@capacitor/keyboard` (su `resize` es *iOS only*;
`setResizeMode` en Android es `call.unimplemented()`). Es **el propio Capacitor**,
en su plugin `SystemBars`:

```java
// @capacitor/android 8.4.1 — SystemBars.java:199-208, initWindowInsetsListener()
ViewCompat.setOnApplyWindowInsetsListener((View) getBridge().getWebView().getParent(), (v, insets) -> {
    Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
    boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
    v.setPadding(0, 0, 0, keyboardVisible ? imeInsets.bottom : 0);
```

Le mete al padre del WebView un `padding-bottom` igual a la altura del teclado.

### La palanca

```json
"SystemBars": { "style": "DEFAULT", "insetsHandling": "disable" }
```

Con `"disable"`, `initWindowInsetsListener()` sale por su primera línea: no hay
oyente, no hay padding, **no hay redimensión**. `100dvh` sigue valiendo 780, el
pliego no se recompone, la foto se queda en 336x252 y el teclado se dibuja
encima.

### El riesgo, y por qué es asumible

`"disable"` apaga también `injectSafeAreaCSS()`, que es quien publica
`--safe-area-inset-*`, y deja de aplicar el padding de las barras del sistema.
Pero los 14 usos de `index.css` están escritos con respaldo:

```css
padding-top: calc(1rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));
```

La variable de Capacitor primero, `env()` nativo después — y `index.html` lleva
`viewport-fit=cover`. En un WebView moderno el respaldo debería sostenerse. **Si
no se sostiene, se ve de un vistazo**: el contenido se mete bajo la barra de
estado.

### Las dos observaciones del spike

Se hacen a simple vista, sin instrumentos, en el APK v59:

1. **Abrir MARCA y tocar el buscador: ¿la fotografía conserva su tamaño?**
   → *sí* = la palanca muerde y (4) se puede diseñar.
   → *no* = la palanca no es esta y (4) cambia entero.
2. **Mirar arriba y abajo en cualquier pantalla: ¿se respetan la barra de estado
   y la de gestos?**
   → *sí* = el respaldo de `env()` aguanta y la palanca sale gratis.
   → *no* = hay que recuperar los insets por otra vía antes de seguir.

**Marcha atrás:** revertir la clave de `capacitor.config.json`. Una línea, sin
migración ni estado persistido.

---

## 4 — Aplazado: dos modos que ocupan lo mismo

No entra en esta entrega. Se apunta aquí para que el spike se lea con su
propósito puesto.

**La idea:** la hoja es una banda fija —mismo borde superior, mismo alto, misma
foto— y lo que cambia entre modo lista y modo teclado es la **densidad de lo que
hay dentro**, no el rectángulo.

**El presupuesto real (360x780, medido con `test:layout`):** con la foto intacta,
la hoja ocupa `y=274..780` (506px) y el teclado tapa desde 490 → **216px a la
vista**. Con el cromo del modo lista (los 117px de arriba) quedan **99px: dos
filas, inviable**. Retirando tirador y cabecera —que no pintan nada mientras
tecleas: no vas a arrastrar, y acabas de tocar el buscador *de esa lista*— quedan
**159px ≈ 3 filas**, que cubren cualquier búsqueda de dos o tres letras sobre un
catálogo cerrado de ochenta marcas.

**Dos detalles que ya se sabe que hay que resolver, y no son pequeños:**

- **La banda tiene que pasar de `max-height` a alto fijo mientras la hoja está
  abierta.** Hoy `.pm-hoja` es `max-height`, así que su alto lo pone el contenido:
  filtras a tres resultados, la hoja encoge y `useEscenarioApartado` mueve la
  foto — justo lo que se venía a impedir. El alto se congela al abrir, **por
  paso**, que es la misma llave (`clave`) que ya usa `useArrastreHoja` (la hoja
  del año es corta a propósito y un alto fijo la dejaría en papel en blanco).
- **El cambio de modo es una variable CSS, no una maqueta nueva.** El oyente del
  teclado publica su altura en `--pm-teclado` y el cuerpo de la hoja encoge por
  debajo. La caja de la hoja no se entera: su parte de abajo queda detrás del
  teclado. Nada se mueve porque no hay nada que mover.

**Descartado explícitamente:** el recorte flotante (`PhotoPeek`) arriba a la
derecha durante la selección. Ya se probó y se descartó; no volver a proponerlo.

---

## Verificación

| Suite | Qué cubre aquí |
|---|---|
| `npm test` | `test:estetica` + `test:unit` + seguridad. `GuessForm.app.test.jsx` es la única que ejecuta de verdad la rama `esApp()`. |
| `npm run build` | El CSS compila y el bundle sale entero (ver memoria: un build verde sin `.env` puede emitir un bundle sin `createRoot`). |
| `npm run test:layout` | La composición hoja + foto en seis pantallas. **No cambia en esta entrega**, pero queda avisado: simula el teclado **encogiendo la ventana**, que es exactamente lo que dejaría de pasar si la palanca muerde. En cuanto se confirme, hay que enseñarle el modo nuevo o deja de medir la realidad. |

**Prueba nueva en `GuessForm.app.test.jsx`:** al abrir la hoja de MARCA, el
buscador **no** tiene el foco. Es la promesa de (2) y es la única red que la
protege antes de un APK.

---

## Entrega

Cambios de app (`src/`, `capacitor.config.json`) → **directo a `main`, sin PR**
(regla 13). `npm test` y `npm run build` en verde **antes** de empujar. Después,
`git pull && npm run cap:sync` en el checkout principal (regla 17: sin eso el APK
sale con la compilación anterior).

- `versionCode` **59** (58 es el último subido)
- `versionName` **1.10.3** — parche: arreglos y una clave de configuración, sin
  pantalla nueva.
