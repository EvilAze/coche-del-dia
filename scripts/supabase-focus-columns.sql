-- supabase-focus-columns.sql
-- =============================================================================
-- Añade un punto focal (focus_x, focus_y) por coche para que el crop del
-- servidor (api/daily-image.js) pueda usar ese punto en lugar del centro
-- geométrico cuando recorta los niveles de zoom progresivos.
--
-- Sin esto, el crop siempre estaba en (50%, 50%) — si el coche aparecía
-- descentrado en la foto, el primer intento del jugador mostraba cielo,
-- asfalto o un trozo de fondo en lugar de una porción útil del coche. Con
-- estas columnas el admin puede ajustar el foco por coche y dosificar la
-- dificultad manualmente sin tener que recortar la imagen original.
--
-- Rango esperado: [0.0, 1.0]. (0, 0) = esquina superior-izquierda;
-- (1, 1) = esquina inferior-derecha; (0.5, 0.5) = centro (default).
-- =============================================================================

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS focus_x DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS focus_y DOUBLE PRECISION NOT NULL DEFAULT 0.5;

-- CHECK para evitar valores fuera de rango por error de admin u otro
-- consumidor que se salte la validación del endpoint. Tolerante a (0, 1)
-- inclusive: matemáticamente legal (el clamp del servidor encaja el crop
-- contra el borde si no cabe más).
ALTER TABLE public.cars
  DROP CONSTRAINT IF EXISTS cars_focus_x_range,
  DROP CONSTRAINT IF EXISTS cars_focus_y_range;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_focus_x_range CHECK (focus_x >= 0 AND focus_x <= 1),
  ADD CONSTRAINT cars_focus_y_range CHECK (focus_y >= 0 AND focus_y <= 1);

-- =============================================================================
-- Notas de despliegue
-- =============================================================================
-- 1. Este script es idempotente: las dos columnas y los constraints usan
--    IF NOT EXISTS / DROP IF EXISTS, así que puedes correrlo varias veces
--    sin romper nada.
-- 2. Coches preexistentes quedan en (0.5, 0.5) → comportamiento idéntico
--    al de antes. No hace falta backfill.
-- 3. Permisos: como `cars` ya tiene SELECT permitido para anon/auth tras
--    el hardening, este SELECT no expone nada sensible (un par de floats
--    no permite identificar el coche del día). Si quieres extra paranoia
--    puedes revocar SELECT(focus_x, focus_y) para anon/auth — pero no es
--    necesario: el frontend público solo consume las imágenes crop ya
--    procesadas, nunca lee estas columnas directamente.
