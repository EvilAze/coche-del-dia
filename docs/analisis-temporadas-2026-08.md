# ¿Las Temporadas Temáticas nos están haciendo bien o mal?

**Fecha del análisis:** 15 de agosto de 2026
**Datos:** producción (Supabase), 9 de mayo – 15 de agosto de 2026
**Pregunta que lo motiva:** ¿seguimos con temporadas o pasamos a coches
totalmente aleatorios?

---

## Aviso sobre la muestra, antes de nada

27 jugadores registrados activos en los últimos 28 días, ~12 al día, más un
número parecido de dispositivos anónimos. **Nada de lo que sigue es
estadísticamente significativo**, y el verano es un confusor enorme. Lo que se
lee aquí es *dirección* y *estructura*, no significación. Las conclusiones
estructurales (aritmética de catálogo) son firmes; las de comportamiento son
indicios.

Cuando una comparación puede hacerse sobre **los mismos jugadores** en dos
periodos, se hace así: es lo único que quita de en medio los cambios de
composición de la audiencia, que a esta escala dominan cualquier media.

---

## Las dos mecánicas que van juntas y no deberían

Bajo el nombre «Temporadas» conviven dos cosas independientes:

1. **El ciclo de la clasificación** — reset cada 1-2 semanas, podio congelado,
   cuenta atrás. Cuesta cero coches de catálogo.
2. **El filtro temático del sorteo** (`seasons.theme_filter`) — restringe de qué
   pool sale el coche del día. Cuesta catálogo, curación y dificultad.

Los datos las puntúan al revés. Conviene separarlas antes de decidir nada.

---

## 1. El ciclo de clasificación: lo único que sube

Aperturas del ranking por partida jugada (evento `ranking_open` contra
`daily_stats.total_games`):

| Periodo | Aperturas/partida |
|---|---|
| Pre-temporadas (14 jun – 12 jul) | 0,45 |
| T1 Grupo B | 0,45 |
| T2 Clásicos de España | 0,67 |
| T3 Le Mans | 0,78 |
| T3, última semana | 1,06 |

Casi el doble. **Matiz honesto:** la píldora de puesto de la cabecera cambió en
agosto, así que el 1,06 de la última semana está contaminado por ese cambio de
UI. El salto de 0,45 a 0,78 es anterior y se sostiene.

Lo que **no** ha pasado, y merece decirse porque era el miedo razonable:

- **El reset no expulsa a nadie.** Última partida registrada por semana: 1, 4 y 1
  jugadores en las semanas de arranque de T1, T2 y T3, contra 6 en la semana
  pre-temporadas del 6 de julio. No hay pico en las fronteras.
- **Los campeones siguen.** Los cuatro que subieron al podio de T1/T2 seguían
  jugando el 15 de agosto, con rachas vivas de 97, 48, 13 y 3 días.

---

## 2. El filtro temático: no hace el juego más difícil, lo hace más polarizado

Esta es la parte que las medias del panel escondían.

### La medida limpia: los mismos 18 jugadores, antes y durante

Los 18 registrados que jugaron tanto en la etapa pre-temporadas como en T3:

| | Pre (1 jun – 12 jul) | T3 Le Mans (27 jul – 15 ago) |
|---|---|---|
| Aciertos **a la primera** | 13% | **32%** |
| Aciertos en ≤2 intentos | 40% | 54% |
| Intentos medios para ganar | 2,84 | **2,27** |
| Tasa de acierto | 86% | 87% |

Mes a mes, los mismos 18: 13% → 11% → 16% (pre) → **20%** (T1+T2) → **31%** →
**34%**. No es una curva de aprendizaje suave: es un escalón en la frontera de
temporada que sigue subiendo dentro de T3.

Repartido por jugador en T3, entre los 11 que juegan de forma regular:

```
85%  70%  53%  50%  40%  30%  7%  5%  5%  5%  0%
```

Para los dos primeros —los de las rachas de 97 y 48 días— el juego está
resuelto antes de empezar.

### Por qué la media no lo enseñaba

| Distribución del resultado | Pre | T3 Le Mans |
|---|---|---|
| Gana a la 1ª | 14% | **23%** |
| Gana a la 3ª o 4ª (la zona buena) | 34% | **28%** |
| Pierde | 14% | **19%** |

Las dos colas engordan y el centro se vacía. El veterano resuelve de un tiro; el
recién llegado se estrella. En T3 el anónimo gana el 76% y el registrado el 85%.
La media de los dos parece «normal» y no lo es.

### Controles: no es el zoom, no es la veteranía

1. **Zoom.** Los coches de T3 tienen `zoom_base` medio **4,44** frente a **4,12**
   de la etapa anterior: recorte *más* difícil. El confusor va en dirección
   contraria al efecto medido.
2. **Veteranía.** La mejora no es progresiva, es un escalón en la frontera.
3. **Marcas famosas.** Sí es parte del mecanismo, y lo explica en vez de
   salvarlo (ver abajo).

### La fuga la produce el pool, no el rótulo

Durante los 20 días medidos de T3, la palabra «Le Mans» **no aparecía en ninguna
parte de la pantalla de juego** (el sello del masthead se había retirado el 12
de agosto y el nombre solo vivía en el modal de clasificación). Aun así:

- El primer tiro acierta la **marca** el 53% de las veces (45% pre-temporadas).
- El primer tiro acierta el **país** el 70% de las veces (54% pre-temporadas).
- El 87% de los primeros tiros usan una marca que está en el tema.

Al tercer prototipo de resistencia seguido, el jugador ya lo ha deducido.
Conclusión práctica: **anunciar la temporada no crea la fuga; solo cobra el
relato que ya estabas pagando.**

### Cuantificar la «adivinabilidad» de un pool

Tomando como prior con qué frecuencia el público teclea cada marca a lo largo de
todo el histórico, se puede medir la probabilidad de que la marca del día ya
esté en la punta de la lengua:

| Pool | P(marca del día) | P(país del día) | Concentración de marca |
|---|---|---|---|
| Catálogo entero (270 listos) | 2,3% | 13,9% | 0,021 |
| Le Mans | **4,0%** | 15,8% | 0,080 |
| Pelotillas atómicas (T4) | **2,0%** | 13,5% | 0,066 |

Le Mans **duplicaba** la probabilidad de acertar a ciegas respecto al catálogo
completo. Esta métrica es el filtro que debería pasar cualquier tema futuro.

### Y una trampa que hay que nombrar

**Una fuga de conocimiento no se compensa con dificultad visual.** Subir el zoom
en una temporada temática no le quita nada al veterano (ya sabe la respuesta) y
le quita lo único que tenía al recién llegado: empeora justo la polarización que
se quería corregir. El zoom (`cars.zoom_base`) sirve para calibrar el juego
entero; para eso está el observatorio DDA, que a 15 de agosto daba coste 3,41
contra un objetivo de 3,5.

---

## 3. El coste de catálogo: el filtro no alarga, fragmenta

- **162 coches** con imagen y sin usar = 5,4 meses de vida a 1/día.
- **Le Mans se agotó**: 24 coches etiquetados, los 24 jugados o programados,
  cero libres. La temporada se estiró a **24 días** (contra los 7-14 de diseño)
  hasta vaciar la despensa, y los tres últimos días se programaron con coches
  que ni siquiera tenían imagen (`image_ready = false`, `image_url` vacío) — o
  sea, tres días de `/api/daily-image` devolviendo 500. *(Se corrigió cortándola
  el día 15: se queda en 20 días jugados y cuatro coches sin gastar.)*
- **La curación se paró sola**: 26 coches etiquetados de 441, y 24 son Le Mans.
- **Cada eje se agota rápido**: Alemania 28 libres (2 temporadas de dos
  semanas), EE.UU. 25 (1,8), Italia 24 (1,7), Japón 20 (1,4), España **5** (0,4;
  T2 ya se comió los clásicos españoles, con 5 de sus 7 días en Seat).

Y una consecuencia de diseño que se pasa por alto: los temas que salen «gratis»
de los datos **matan una pista del juego**. `compare-guess.js` da tres señales:
marca, país (como `partial` del chip de marca) y año (correcto con margen ±2).
Un tema de país anula la segunda; uno de década, la tercera. Los únicos temas
sanos son transversales.

---

## 4. Lo que ninguno de los dos modelos arregla

- **1 usuario registrado nuevo por semana** desde mediados de julio (eran 4-5 en
  mayo-junio).
- **El top-10 hace el 79%** de las partidas de los últimos 28 días.
- **El 69% de los dispositivos anónimos** juegan un solo día y no vuelven.

Las Temporadas se diseñaron para resolver «el histórico es inalcanzable para un
recién llegado». Pero apenas hay recién llegados: el cuello de botella es la
adquisición y el primer día del que llega, no la equidad de la escalera. Y con
27 jugadores, ningún A/B podrá decidir nunca entre los dos modelos: la muestra
no da.

---

## Decisión

**Se mantiene el ciclo de temporadas. El filtro temático deja de ser el
comportamiento por defecto.**

Reglas para que un tema pueda activarse:

1. **Transversal obligatorio.** Debe cruzar marca, país y década. Nada de temas
   que sean un recorte de una sola columna (país, década, marca).
2. **No más adivinable que el catálogo.** P(marca del día) ≤ la del catálogo
   completo, con la métrica de la tabla de arriba.
3. **Pool ≥ 3× la duración.** Una semana pide 21 coches listos y sin usar.
4. **Nunca más de la mitad del pool.** Para que el tema se pueda repetir dentro
   de un año en vez de quemarse.
5. **Máximo 2 días de la misma marca** por temporada. La semana de los 5 Seat no
   debe poder existir.
6. **Una semana, no dos.** Una temporada que se estira deja de ser una
   temporada: la cuenta atrás pierde urgencia y el reset, significado.
7. **Siempre hay temporada siguiente.** Un hueco deja `current_season()` en NULL
   y con eso la clasificación aparece vacía y sin banner. Ha estado a punto de
   pasar dos veces.

**Las colaboraciones son la excepción que sí compensa.** Una temporada
presentada por un canal tiene valor fuera del juego —promoción, o sea
adquisición, que es el cuello de botella real—, y eso paga la fuga que una
semana temática produce. Van con el crédito visible sobre la foto
(`seasons.presenta_es`).

---

## Lo que se hizo tras este análisis

- `scripts/2026-08-temporada-4-pelotillas-atomicas.sql`: T4 «Pelotillas
  atómicas» (16-22 ago, 21 coches, 17 marcas, 8 países, 1963-2018) y T5
  «Temporada abierta» sin temática (23 ago – 5 sep) como red para que la
  escalera no se quede vacía. Le Mans se corta el 15 en vez del 19 para dejarle
  sitio: cierra con 20 días jugados y **cuatro coches sin gastar**, así que el
  tema deja de estar agotado y puede volver.
- La línea de temporada vuelve a la pantalla de juego, al final del filete que
  ya existía sobre la foto (`ZoomStage`, `lib/season.js#creditoTemporada`).

## Cómo reproducir las cifras

Los números salen de consultas de solo lectura sobre `seasons`, `daily_cars`,
`daily_stats`, `user_guesses`, `cars`, `feature_events` y `auth.users`
(`is_anonymous`). La partida es «del daily» cuando `user_guesses.car_id` coincide
con el `daily_cars.car_id` de esa fecha; si no, es repesca — el mismo criterio
que usa `get_season_leaderboard` para pagarlas a mitad de puntos y el que aplica
`lib/admin-handlers/analytics.js`.
