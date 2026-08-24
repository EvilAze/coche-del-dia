# Cambio de emergencia del coche del día

**Fecha:** 2026-08-25
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

Sale un coche que no tocaba —típicamente porque se olvidó reprogramar el
calendario— y hay que sustituirlo **con la jornada ya empezada**.

Hoy eso no se puede hacer desde el panel: la fila «Hoy» de `SchedulePanel`
tiene el botón deshabilitado (`disabled={item.isToday}`, con el título «El
coche de hoy no se puede cambiar»). Curiosamente **el backend sí lo permite**:
el `POST /api/admin/schedule` solo rechaza `date < today`, así que la única
cerradura es la UI. Eso es exactamente lo contrario del criterio del proyecto
(«el botón deshabilitado es cortesía, esto es la cerradura»), y este diseño lo
corrige de paso.

Pero el botón es la parte fácil. Lo caro es lo que se rompe al cambiar el
coche a media jornada:

- `user_guesses` está clavada por `(user_id, car_id, date)`, y tanto
  `get-daily-car` como `validate-guess` filtran por `car_id`. Cambiar el coche
  le da a cada usuario logueado **un tablero a cero y cinco intentos nuevos**:
  el día se puede rejugar.
- La caché del proxy de imagen, el preload de Edge Config y la miniatura de
  compartir siguen apuntando al coche viejo.

## Requisito que manda sobre todo lo demás

**Quien ya jugó no puede volver a jugar.** Y la forma elegida de conseguirlo
no es cerrarle la jornada ni migrarle los intentos, sino **congelarla**.

## Comportamiento

El coche del día deja de ser «el que dice `daily_cars`» y pasa a ser **«el
tuyo»**. Un cambio de emergencia no reescribe el día: **abre una revisión**.

| Quién | Qué ve tras el cambio |
|---|---|
| Logueado que ya jugó (a medias o terminado) | El **coche viejo** hasta medianoche: termina su partida, se le revela el viejo, puntúa y suma racha |
| Logueado que no ha empezado | Coche nuevo, cinco intentos |
| Anónimo que ya jugó | El **coche viejo**, igual |
| Anónimo con cero intentos | Coche nuevo |

Nadie rejuega. Nadie pierde una partida empezada. El coche saliente **vuelve
al bombo** y saldrá otro día (era válido: solo no era el de hoy).

## Arquitectura

### El pin del logueado, y por qué no es el obvio

La fila de `user_guesses` **ya guarda el `car_id`**: el pin estaba escrito
desde siempre, solo que nadie lo miraba. Pero el pin ingenuo —«busca su fila
de hoy y usa su `car_id`»— **está mal**, y el fallo sería silencioso:

> Las partidas de **repesca** se guardan en la MISMA tabla, con `date` = hoy y
> un `car_id` que no es el del día (`api/_lib/repesca/validate.js`). No hay
> columna `mode`: el único modo de distinguirlas es comparar el `car_id` con el
> del día, que es justo lo que hace el anti-trampas en
> `lib/admin-handlers/audit.js`.

Es decir, el pin ingenuo habría clavado a algunos usuarios **al coche de su
repesca**. La regla correcta es:

> su fila de hoy **cuyo `car_id` esté en {coche vigente} ∪ {salientes de hoy}**

Determinista, y las repescas quedan fuera solas.

### `coche_de_hoy(p_date)`: conocer los salientes sin pagar latencia

La regla anterior obliga a conocer los salientes también en el camino de los
logueados, así que ya no es gratis. La salida sin coste es una RPC nueva que
devuelve `(car_id, prev_car_ids)`: hace `perform pick_daily_car(p_date)` y lee
la fila. **Un solo round-trip, igual que ahora** — no añade latencia al primer
paint, que es el único request bloqueante del juego.

No toca el sorteo: la temática de temporada sigue viviendo dentro de
`pick_daily_car`, intacta. Es un envoltorio.

Y **cae con gracia**: si la RPC falla o aún no está desplegada, el handler usa
`pick_daily_car` con `prev_car_ids = []`, que es exactamente el comportamiento
actual. El código puede llegar a producción antes que el SQL sin romper nada
(regla 9).

### El sello: una sola pieza para congelar anónimos y para avisar a los demás

Los anónimos no tienen fila: su partida vive en un token HMAC `{d, n, s}` más
`localStorage`. Para congelarlos hace falta algo en el token, y **no puede ser
el `car_id`** — el cliente lee el payload y eso filtraría la identidad del
coche del día cruzándola con `/api/list-cars` (regla 5).

**`sello` = HMAC truncado de `(car_id + fecha)` con `REPESCA_TOKEN_SECRET`.**
Opaco, no invertible sin el secreto, no dice qué coche es.

- `get-daily-car` lo devuelve a **todos** los clientes, y lo mete en el token
  anónimo: `{d, n, s}` pasa a `{d, n, s, c}`. Hay que tocarlo en las **dos
  copias** (`api/_lib/anon-session.js` y `api/_lib/edge/anon-session.js`), que
  comparten formato de wire.
- El cliente lo reenvía en `validate-guess`.
- Un token viejo sin `c` se trata como «vigente»: no se puede saber más, y el
  fallo seguro es no congelar a quien quizá no tenía partida.

### El resolvedor

`api/_lib/coche-de-hoy.js`, **función pura sin I/O**:
`resolverCocheDelUsuario({ carIdVigente, prevCarIds, filaUsuario, tokenAnon, selloCliente })`.

Recibe los sellos **ya calculados** (`sellosPorCarId`), no el secreto: el HMAC
es asíncrono en Edge (Web Crypto) y síncrono en Node, así que calcularlo dentro
rompería la pureza y obligaría a dos versiones. El endpoint calcula el sello del
coche vigente y el de cada saliente —como mucho un puñado— y se los pasa.

Pura porque la consumen **los dos runtimes**: `get-daily-car` es Edge y
`daily-image` / `validate-guess` son Node. Cada endpoint hace su I/O y le pasa
los datos ya leídos — mismo criterio que `schedule-free.js` o `compare-guess.js`,
y por el mismo motivo: es un guard sobre datos que no se pueden deshacer, y su
única garantía no puede ser una lectura atenta del `if`.

Reglas, en orden:

1. Logueado con fila de hoy y `car_id ∈ {vigente} ∪ prev` → **ese** (congelado
   si no es el vigente).
2. Anónimo con `n > 0` y `c` ∈ sellos de `prev` → **ese** (congelado).
3. Resto → coche vigente.
4. Cliente **sin partida** que manda un sello viejo (pestaña abierta desde
   antes del cambio, foto vieja en pantalla) → **409 `coche_cambiado`, sin
   gastar intento**, y la UI recarga. Sin esto, ese usuario responde sobre la
   foto vieja y se le puntúa contra el coche nuevo.

El sello **no abre ningún agujero**: para logueados manda la fila, no el
sello; y un anónimo con sello viejo lleva su `n` firmado en el mismo token, así
que no gana ni un intento extra. La regla 3 es la que cierra el caso del
logueado sin fila que reenviara un sello viejo: se le sirve el coche vigente.

### Endpoints que deben pasar por el resolvedor

- `api/get-daily-car.js` — imagen, estado guardado y `revealToken`.
- `api/daily-image.js` — hoy resuelve por su cuenta con `pick_daily_car`, así
  que le serviría la foto **nueva** a un congelado. También su
  `tryReadUserStatus`, que filtra por `car_id`.
- `api/validate-guess.js` — o validaría los intentos contra el coche que no es.

#### La caché del proxy de imagen no se contamina

`get-daily-car` sirve la foto como `/api/daily-image?d=<hoy>&v=<hash>`, donde
`v` es un `sha1(image_url:zoom_base)`. Como **el hash sale del coche**, un
congelado y un jugador nuevo piden **URLs distintas**: la caché compartida del
CDN nunca puede servirle la foto de uno al otro. Es la propiedad que hace viable
que una misma ruta devuelva coches distintos según quién pregunte, y hay que
mantenerla: si algún día `v` dejara de derivar del coche, esto se convierte en
una fuga.

`api/og-image.js` se queda con el coche vigente: es la miniatura pública de
compartir, no la partida de nadie.

### Almacenamiento

Una columna nueva: `daily_cars.prev_car_ids uuid[] not null default '{}'`. El
cambio de emergencia **añade el saliente** al array. Es por fecha, así que se
resetea solo al cambiar el día, y sirve además de rastro de qué se cambió.

`daily_cars` está revocada para `anon`/`authenticated` por el hardening, así
que no aplica la regla 3 (los `GRANT SELECT` son para `cars`). El script SQL
versionado lleva el esquema, nunca datos que acoten el sorteo (regla 20).

## Panel interno

- La fila **Hoy** de `SchedulePanel` deja de estar muerta. Botón aparte, en
  `rojo`, **«Cambio de emergencia»** — no el mismo botón que los días futuros:
  no es la misma acción y no debe parecerlo.
- Modal de confirmación que dice **lo que está en juego antes de pulsar**:
  cuántas partidas hay empezadas hoy (exacto para logueados vía `user_guesses`;
  aproximado para anónimos vía `guess_audit`, y si la cuenta falla **lo dice**
  en vez de mentir), que esos jugadores seguirán con el coche actual hasta
  medianoche, y que el saliente vuelve al bombo. Confirmación en dos pasos.
- Handler propio, `lib/admin-handlers/emergency-swap.js`, enrutado por
  `api/admin/[...slug].js`. No un flag del POST del calendario: el camino a hoy
  tiene que ser explícito y distinto.
- **Se cierra la puerta abierta**: el `POST /api/admin/schedule` pasa a
  rechazar `date === today` con 409. La emergencia queda como el único camino
  a hoy.
- Tras el cambio, reescribir el preload de Edge Config (reusando
  `writeEdgeConfig` de `api/_lib/cron/warm-daily.js`) para que la home no
  precargue la foto vieja. Falla en silencio (regla 9).
- `src/admin/` está exento de `test:estetica` (regla 16), pero el modal usa los
  tokens del tema igualmente.

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| **R1** | **CONFIRMADO Y ACOTADO (2026-08-25)**: `record_daily_result_v2` se re-deriva el coche con `v_car := public.pick_daily_car(v_today)`. Falla en **dos** puntos para un congelado: la lectura de `user_guesses` por ese `car_id` (`raise 'No game state for today'` → **gana y no se le registra ni puntos ni racha**) y, dentro del `if p_won`, la verificación del último intento contra `cars` por `v_car` (`raise 'Winning guess does not match real car'`) | Parche SQL versionado en **un solo punto**: resolver `v_car` al principio (ver abajo). Los dos fallos usan el mismo `v_car`, así que el resto del cuerpo no se toca |
| **R2** | El anti-trampas de `lib/admin-handlers/audit.js` descartará como «repescas» las partidas congeladas de ese día | Misma regla de una línea (`∪ prev_car_ids`), en el mismo lote |
| **R3** | `daily_stats` y el observatorio de dificultad atribuyen por `date → daily_cars`: las estadísticas de ese día quedan **mezcladas entre dos coches** | No se arregla, se avisa. Es un día suelto, no justifica un esquema nuevo |
| **R4** | El coche saliente vuelve al bombo: **quien lo jugó hoy lo verá repetido** cuando vuelva a salir | Decisión tomada. El modal dice cuánta gente lo jugó, para decidir con el dato delante |
| **R5** | El Archivo / Garaje de ese día mostrará el coche vigente; quien jugó el viejo lo tiene en su ficha vía `user_guesses.car_data` | Verificar `api/garage.js` durante la implementación. Si chirría, misma regla `∪ prev` |
| **R6** | La RPC nueva está en el **camino crítico del primer paint** | Es un envoltorio que no toca `pick_daily_car`, y el handler cae a `pick_daily_car` si falla. El test que suma la cadena de plazos (regla 21) cubre que no se pase de los 25 s del Edge |
| **R7** | `og-image` (`max-age=300`) servirá la miniatura vieja unos minutos al compartir | Se deja: se cura solo y no afecta a ninguna partida |

### Parche de `record_daily_result_v2` (R1)

Va justo después de `v_car := public.pick_daily_car(v_today)`, y el resto del
cuerpo sigue igual sin enterarse:

```sql
-- Si el usuario tiene fila en una revisión ANTERIOR del día (cambio de
-- emergencia), esa es su partida: la jugó contra ese coche y contra ese coche
-- hay que verificarla. En un día normal prev_car_ids está vacío y esto no hace
-- nada.
select coalesce(prev_car_ids, '{}') into v_prev
  from public.daily_cars where date = v_today;

select car_id into v_car_congelado
  from public.user_guesses
 where user_id = v_user and date = v_today and car_id = any(v_prev)
 limit 1;

if v_car_congelado is not null then
  v_car := v_car_congelado;
end if;
```

No abre ningún agujero: `v_prev` solo contiene coches que **realmente fueron**
el coche del día, así que un coche de repesca no puede colarse por ahí a robar
los puntos y la racha de la diaria. Es la misma razón por la que el resolvedor
de JS acota el pin a `{vigente} ∪ prev` en vez de a «su fila de hoy».

**Desempate, y es el mismo en los dos sitios:** si existieran fila en `prev` y
fila en el vigente, gana la de `prev`. Por construcción no puede pasar (el pin
impide que se cree la segunda), pero la regla queda escrita para que SQL y JS no
diverjan si algún día pasa.

### Lo que se verificó en Supabase (2026-08-25)

Tres comprobaciones antes de dar el diseño por bueno:

- **`record_daily_result_v2` delega en `public.record_daily_result(p_won,
  p_attempt_number)`**, y esa función es **completamente ajena al coche**: su
  idempotencia va por `stats.last_played_date = hoy` y la racha por fechas.
  Ni `daily_cars` ni `car_id` en todo el cuerpo. **El radio de daño de R1
  termina en el envoltorio `_v2`.** Y esa idempotencia por fecha es además una
  red que ya estaba puesta: aunque alguien acabase con partida en dos
  revisiones del mismo día, solo puntúa una vez.
- **`pick_daily_car(p_date date, p_allow_drafts boolean)`** — firma confirmada;
  la envoltura `coche_de_hoy` tiene que respetarla.
- **`daily_cars` es `(date, car_id, created_at)`** — no hay ninguna columna
  reaprovechable, así que la migración de `prev_car_ids` es necesaria.

## Tests

`api/_lib/coche-de-hoy.test.js` sobre la función pura, que es donde vive toda
la lógica delicada:

- pin del logueado congelado;
- **repesca del mismo día que NO debe secuestrar el pin** (el fallo que motivó
  la regla del `∪ prev`);
- anónimo congelado por sello;
- anónimo con `n = 0` → coche vigente;
- sello viejo sin partida → `coche_cambiado`;
- **día normal sin `prev`** → comportamiento idéntico al actual.

Más `npm test`, `test:rls` y `test:attacks` como red de seguridad.

## Entrega

Toca `api/`, `scripts/`, `lib/` y `src/admin/` → **PR, no push directo a
`main`** (regla 13), y **sin subir versión de Android** (regla 17): nada de eso
viaja en el APK.

**Excepción a separar y avisar:** el retoque del cliente para reenviar el sello
y manejar el 409 toca `src/` fuera de `admin/`, y eso sí viaja en el APK. Va en
su propia entrega, con su `chore(android)` de versión.
