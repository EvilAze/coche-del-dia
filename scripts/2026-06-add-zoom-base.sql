-- 2026-06-add-zoom-base.sql
-- Zoom inicial por coche (dificultad ajustable).
--
-- SUPERSEDIDO EN PARTE por scripts/2026-08-zoom-span-ratio.sql: el span dejó de
-- ser una resta fija (`base - 2.0`) y pasó a ser un ratio constante, y con ello
-- el rango cambió de [3.2, 6.0] a [2.8, 7.5]. NO re-ejecutes este fichero tal
-- cual: su CHECK restauraría el rango viejo y rechazaría los coches migrados.
-- Se conserva como registro histórico del alta de la columna.
--
-- Hasta ahora el escalonado de zoom era global: intento 1 = 3.7×, bajando 0.5
-- por intento hasta 1.7× en el intento 5. Algunos coches son demasiado
-- reconocibles ya en el intento 1, así que añadimos un "zoom base" por coche:
-- el zoom lógico del intento 1. Los saltos siguen siendo de 0.5
-- (intento i → base - 0.5*(i-1)). Subir el base = empezar más cerca y revelar
-- menos en todos los intentos.
--
-- Default 3.7 = comportamiento histórico EXACTO. Rango [3.2, 6.0]:
--   3.2× → intento 5 muestra ~83% (algo más fácil que antes).
--   6.0× → intento 5 muestra ~25% (bastante más difícil).
-- Nunca revela el 100% durante la partida (el servidor acota el crop).
--
-- Coherencia: la fórmula vive en api/_lib/zoom.js y src/lib/zoom.js.

alter table public.cars
  add column if not exists zoom_base real not null default 3.7;

-- Acota el valor a un rango sano (coherente con ZOOM_BASE_MIN/MAX en el código).
alter table public.cars
  drop constraint if exists cars_zoom_base_range;
alter table public.cars
  add constraint cars_zoom_base_range
  check (zoom_base >= 3.2 and zoom_base <= 6.0);

-- CLAUDE.md #3: toda columna nueva legible por el catálogo necesita GRANT
-- explícito o /api/list-cars rompe bajo RLS por-columna.
grant select (zoom_base) on public.cars to anon, authenticated;

comment on column public.cars.zoom_base is
  'Zoom lógico del intento 1 (dificultad). Los intentos bajan 0.5 cada uno. Default 3.7. Ver api/_lib/zoom.js.';
