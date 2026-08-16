-- 2026-08-zoom-span-ratio.sql
-- El span del zoom pasa de RESTA FIJA a RATIO CONSTANTE, y los zoom_base
-- tuneados a mano se reajustan para que la dificultad no dé un salto.
--
-- ── QUÉ ESTABA MAL ────────────────────────────────────────────────────────
-- Hasta ahora el intento 5 era `zoom_base - 2.0`. Al ser una resta fija sobre
-- bases distintas, el revelado TOTAL dependía del base:
--
--   base 3.2 → intento 5 = 1.2×  → abre ×2.67 en total
--   base 3.7 → intento 5 = 1.7×  → abre ×2.18
--   base 6.0 → intento 5 = 4.0×  → abre ×1.50
--
-- O sea que un coche marcado como difícil no era solo "más difícil": su curva
-- era MUDA. A base 6.0 el jugador pasaba de ver el 2.8% del área al 6.3% en
-- cinco intentos, con pasos de ×1.08 — imperceptibles. No es que fallara: es
-- que no percibía que el juego le estuviera dando nada, y se iba.
--
-- Ahora zoom_5 = base / ZOOM_SPAN, con ZOOM_SPAN = 3.7/1.7 ≈ 2.1765 constante.
-- Todo coche revela el mismo factor total y el zoom_base significa UNA cosa
-- (cuánto se cierra el teaser inicial) en vez de dos a la vez.
--
-- ── POR QUÉ ESE VALOR DE SPAN ─────────────────────────────────────────────
-- 3.7/1.7 es exactamente el span histórico del base por defecto. Al escribir
-- esto, 367 de los 441 coches del catálogo están en 3.7 (el default, nunca
-- tocado): anclando ahí, el 83% del catálogo NO se mueve ni un píxel y la
-- migración solo afecta a los ~74 ajustados a mano.
--
-- ── QUÉ CONSERVA LA MIGRACIÓN ─────────────────────────────────────────────
-- No se pueden conservar los dos extremos a la vez (cambiar esa relación es
-- justo el objetivo). Se conserva la DIFICULTAD GLOBAL del coche: la media
-- geométrica de sus 5 niveles de zoom, que es el total de información que
-- entrega la ronda. Despejando:
--
--   base_nuevo = base_viejo · (SPAN / span_viejo) ^ K
--   span_viejo = base_viejo / (base_viejo - 2.0)
--   K = media de ((i-1)/4)^ZOOM_EASE para i=1..5 = 0.4518102  (EASE = 1.3)
--
-- El efecto neto en los coches difíciles es el que se buscaba: mantienen su
-- dificultad media pero dejan de estar mudos al final. Un 6.0 pasa a 7.10, y
-- su intento 5 abre del 25.0% al 30.7% del lado menor mientras el teaser se
-- cierra del 16.7% al 14.1%.
--
-- El residuo que quede lo corrige el bucle DDA (recompute_car_difficulty), que
-- es un controlador proporcional sobre el zoom_base ACTUAL y por tanto es
-- agnóstico a la forma de la curva.
--
-- Coherencia (CLAUDE.md #7): api/_lib/zoom.js y src/lib/zoom.js.
-- Orden recomendado: ejecutar este SQL ANTES de desplegar el código. Al revés
-- tampoco rompe (clampZoomBase acota en JS), solo deja unas horas con los
-- coches tuneados algo más fáciles de la cuenta.

begin;

-- ── 1. Ensanchar el rango ─────────────────────────────────────────────────
-- El rango viejo [3.2, 6.0] estaba definido por lo que la RESTA producía en el
-- intento 5. Con el ratio, los extremos significan otra cosa:
--   2.8× → intento 1 muestra 35.7% del lado, intento 5 el 77.7% (fácil)
--   7.5× → intento 1 muestra 13.3%, intento 5 el 29.0% (difícil)
-- El techo sube a 7.5 porque migrar un 6.0 exige 7.10 (ver tabla de arriba) y
-- hay que dejar holgura por encima; el suelo baja a 2.8 por simetría, para que
-- el admin conserve margen hacia el lado fácil.
alter table public.cars
  drop constraint if exists cars_zoom_base_range;
alter table public.cars
  add constraint cars_zoom_base_range
  check (zoom_base >= 2.8 and zoom_base <= 7.5);

-- ── 2. Reajustar los zoom_base tuneados ───────────────────────────────────
-- Los que están en el default se dejan intactos de forma EXPLÍCITA: con el
-- span anclado en 3.7/1.7 la fórmula les devolvería 3.7 igualmente, pero
-- excluirlos evita que un redondeo en coma flotante los mueva a 3.6999998 y
-- ensucie el "83% del catálogo sin tocar" que sostiene toda la migración.
update public.cars
-- A 1 decimal, que es el `step` del slider del admin (ZoomBaseField) y lo que
-- muestra su etiqueta: así el valor migrado cae en la rejilla y mover el slider
-- no lo desplaza de golpe. La pérdida de fidelidad es de décimas de porcentaje.
set zoom_base = round(
      (zoom_base * power((3.7 / 1.7) / (zoom_base / (zoom_base - 2.0)), 0.4518102))::numeric,
      1
    )
where zoom_base is not null
  and zoom_base <> 3.7
  -- Guard: la fórmula divide por (base - 2.0). Cualquier fila que ya estuviera
  -- fuera del rango viejo por lo que sea no se toca a ciegas.
  and zoom_base > 2.0;

-- Red de seguridad por si alguna fila venía ya fuera de rango: acótala en vez
-- de dejar que reviente el CHECK de arriba.
update public.cars set zoom_base = 2.8 where zoom_base < 2.8;
update public.cars set zoom_base = 7.5 where zoom_base > 7.5;

-- ── 3. Invalidar las sugerencias del DDA ──────────────────────────────────
-- suggested_zoom_base son propuestas calculadas contra la curva vieja: si el
-- admin las aplicase ahora estaría metiendo un valor de la escala anterior en
-- la nueva. Se limpian y el cron de warm-daily las repuebla en la siguiente
-- pasada con la telemetría acumulada (que sigue siendo válida).
update public.cars
set suggested_zoom_base = null
where suggested_zoom_base is not null;

comment on column public.cars.zoom_base is
  'Zoom lógico del intento 1 (dificultad). El intento 5 es zoom_base/2.1765 (span constante). Rango [2.8, 7.5], default 3.7. Ver api/_lib/zoom.js.';

commit;

-- ── 4. DESPUÉS: poner al día el controlador DDA ───────────────────────────
-- Sus parámetros p_zoom_min / p_zoom_max replican ZOOM_BASE_MIN / MAX. Los
-- defaults ya están corregidos en 2026-06-difficulty-observatory.sql, que es un
-- `create or replace` idempotente: RE-EJECÚTALO ENTERO tras este script. No se
-- copia aquí el cuerpo de la función a propósito — dos copias de la lógica del
-- DDA en dos ficheros es exactamente el tipo de duplicado que acaba divergiendo.
--
-- El cron ya no depende de esos defaults: warm-daily.js pasa el rango explícito
-- desde las constantes del motor de zoom. Solo aplican si lanzas la función a
-- mano desde el editor SQL.
--
-- Lo que NO se toca: p_gain (0.25) y p_step_cap (0.5). Con el span en ratio, un
-- mismo delta de base mueve el intento 5 algo menos que antes (antes la resta
-- fija lo movía de más), así que el controlador queda un pelín menos potente.
-- Es un controlador proporcional que corre cada noche y converge igual; se deja
-- estable a propósito para no meter dos cambios de dinámica a la vez y no poder
-- atribuir la deriva. Si en unas semanas se ve que tarda, sube p_gain.

-- ── VERIFICACIÓN ──────────────────────────────────────────────────────────
-- Distribución resultante. Lo esperado: la enorme mayoría sigue en 3.7 y nada
-- se sale de [2.8, 7.5].
--
--   SELECT round(zoom_base::numeric, 1) AS base, count(*)
--   FROM public.cars GROUP BY 1 ORDER BY 1;
--
-- Que el default siga intacto (debe dar exactamente el recuento de antes):
--
--   SELECT count(*) FROM public.cars WHERE zoom_base = 3.7;
--
-- Que nadie quede fuera de rango (debe dar 0):
--
--   SELECT count(*) FROM public.cars
--   WHERE zoom_base < 2.8 OR zoom_base > 7.5;
--
-- Los extremos que verá el jugador, por coche (útil para revisar los difíciles):
--
--   SELECT make, model, year, zoom_base,
--          round((100.0 / zoom_base)::numeric, 1)            AS pct_intento_1,
--          round((100.0 / (zoom_base / 2.1765))::numeric, 1) AS pct_intento_5
--   FROM public.cars
--   WHERE zoom_base <> 3.7
--   ORDER BY zoom_base DESC;
