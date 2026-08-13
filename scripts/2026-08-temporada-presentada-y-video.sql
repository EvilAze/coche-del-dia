-- scripts/2026-08-temporada-presentada-y-video.sql
-- TEMPORADAS PRESENTADAS POR ALGUIEN, Y COCHES CON VÍDEO.
--
-- Nace de la temporada «USPI by PowerArt»: un ciclo cuyo pool son coches que
-- han salido en una sección de un canal de YouTube, con el vídeo de cada coche
-- como remate del panel de resultado. Pero NADA de lo que hay aquí menciona esa
-- temporada ni ese canal: son dos campos genéricos —quién presenta la temporada
-- y qué vídeo tiene un coche— que sirven para la siguiente colaboración sin
-- tocar código.
--
-- Aplicar en el SQL editor de Supabase, DESPUÉS de
-- 2026-07-temporadas-tematicas.sql. Idempotente (IF NOT EXISTS).
--
-- QUÉ TOCA:
--   [1] cars.video_id          — vídeo del coche (NO legible por el cliente)
--   [2] seasons.presenta_es/en — quién presenta la temporada (SÍ público)
--
-- EL POOL NO SE TOCA. La maquinaria de temporada temática ya existe y ya
-- funciona: se etiquetan los coches con `tags` y se crea la temporada con
-- `theme_filter = {"tags":["uspi"]}`. `pick_daily_car` sortea solo dentro de
-- ese pool desde 2026-07-temporadas-tematicas.sql. Aquí no hay lógica de
-- sorteo nueva, y por tanto ningún riesgo para el juego diario.
--
-- SE ENCIENDE CON DATOS, NO CON UN DEPLOY. Los dos campos nacen NULL y el
-- código está escrito para que NULL signifique «como hasta ahora»: sin
-- `presenta_*` la línea de la pista es la de siempre, y sin `video_id` el panel
-- de resultado enseña la fotografía de siempre. Así esto puede estar en
-- producción semanas antes de que la temporada arranque, y si la colaboración
-- se cae —o el día de mañana piden retirarla— se vacía el campo y desaparece,
-- sin desplegar y sin esperar a una revisión de Play. Es la regla 9 aplicada a
-- un acuerdo comercial: si el patrocinio no está, el juego no se entera.


-- ============================================================================
-- [1] cars.video_id — el vídeo del coche
-- ============================================================================
-- Solo el ID de YouTube (11 caracteres), nunca la URL entera: la URL invita a
-- pegar cosas distintas cada vez (con `?t=`, con `&list=`, acortada en youtu.be,
-- con parámetros de campaña) y el reproductor se monta desde el ID. El CHECK
-- rechaza precisamente eso — un pegado de URL completa no pasa.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS video_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cars_video_id_formato'
  ) THEN
    ALTER TABLE public.cars
      ADD CONSTRAINT cars_video_id_formato
      CHECK (video_id IS NULL OR video_id ~ '^[A-Za-z0-9_-]{11}$');
  END IF;
END $$;

-- ⚠️ AQUÍ TAMPOCO VA UN «GRANT SELECT (video_id)», Y ES DELIBERADO.
--
-- Segunda excepción a la regla 3 de CLAUDE.md, por la regla 5, y esta vez el
-- motivo es doble:
--
--   · EL VÍDEO ES LA RESPUESTA. Un ID de YouTube identifica el coche del día
--     tan bien como su nombre: quien lo lea antes de tiempo tiene la partida
--     resuelta sin gastar un intento.
--   · Y DELATARÍA EL POOL. La columna estará poblada exactamente en los coches
--     de la temporada, así que una columna legible es la lista de candidatos
--     del ciclo entero — el mismo razonamiento por el que `tags` no lleva grant.
--
-- No rompe /api/list-cars, que pide columnas explícitas y no incluye esta. El
-- panel admin la lee y la escribe por /api/admin/save-car, que va con
-- service_role. Si algún día alguien la mete en una query del cliente,
-- reventará con «permission denied» — y ese fallo ruidoso es exactamente lo que
-- queremos que pase.
--
-- EL CAMINO ÚNICO HASTA EL JUGADOR es el `reveal` de /api/validate-guess, que
-- solo se emite con la partida CERRADA. Ni la miniatura se adelanta: la portada
-- del reproductor es nuestra propia fotografía, porque la de YouTube
-- (img.youtube.com/vi/<id>/…) lleva el ID en la URL y pedirla desde la pantalla
-- de juego sería filtrarlo por la puerta de atrás.
COMMENT ON COLUMN public.cars.video_id IS
  'ID de YouTube (11 chars) del vídeo donde sale el coche. SIN grant al cliente: identifica el coche del día y delata el pool de la temporada (regla 5). Viaja solo en el reveal de validate-guess.';


-- ============================================================================
-- [2] seasons.presenta_es / presenta_en — quién presenta la temporada
-- ============================================================================
-- El renglón que se pinta al final del filete de la línea de pista, durante la
-- partida: «USPI · POWERART». Dos columnas y no una porque el resto de rótulos
-- de `seasons` ya viven en pares es/en y el sistema entero pasa por i18n; una
-- colaboración puede además querer nombrarse distinto en cada idioma.
--
-- Es texto LIBRE y curado a mano por el admin, no una plantilla: cada acuerdo
-- se escribe como se haya pactado («USPI · POWERART», «con la colaboración
-- de…»), y así el código no tiene que saber nada del trato.
ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS presenta_es text,
  ADD COLUMN IF NOT EXISTS presenta_en text;

-- Estas SÍ son públicas, al revés que theme_filter: se pintan en la pantalla de
-- juego, así que el cliente tiene que poder leerlas. `seasons` está en grants
-- por COLUMNA desde 2026-07-temporadas-tematicas.sql, y los grants de columna
-- se acumulan: basta con conceder las dos nuevas.
--
-- Que se lean no filtra nada: «USPI · POWERART» dice de qué va el ciclo, igual
-- que ya lo dice `label_es` («Grupo B»). Lo que sigue sin salir del servidor es
-- el filtro que define el POOL — la prosa es pública, la lista no.
GRANT SELECT (presenta_es, presenta_en) ON public.seasons TO anon, authenticated;

COMMENT ON COLUMN public.seasons.presenta_es IS
  'Atribución de la temporada en español (p.ej. "USPI · POWERART"). NULL = temporada sin patrocinio: la línea de pista se pinta como siempre.';


-- ============================================================================
-- [3] Encender la temporada (NO se ejecuta aquí — es la receta)
-- ============================================================================
-- Cuando haya luz verde, esto es todo lo que hay que correr. Ni un deploy.
--
--   -- 3.1 Etiquetar el pool (una vez por coche, o desde el panel admin).
--   UPDATE public.cars SET tags = array_append(tags, 'uspi')
--    WHERE id IN (…) AND NOT ('uspi' = ANY(tags));
--
--   -- 3.2 El vídeo de cada coche (desde el panel admin, coche a coche).
--   UPDATE public.cars SET video_id = 'dQw4w9WgXcQ' WHERE id = …;
--
--   -- 3.3 La temporada.
--   INSERT INTO public.seasons (number, label_es, label_en,
--                               presenta_es, presenta_en,
--                               starts_at, ends_at, theme_filter)
--   VALUES (8, 'Edición USPI', 'USPI Edition',
--           'USPI · POWERART', 'USPI · POWERART',
--           '2026-09-01', '2026-09-30', '{"tags":["uspi"]}'::jsonb);
--
-- ANTES DE 3.3, comprobar el pool con la función que ya existe:
--   SELECT * FROM season_pool_stats('{"tags":["uspi"]}'::jsonb);
-- Si el pool sale corto para los días de la temporada, se repiten coches; y una
-- temporada sin coches cae al catálogo entero (regla 9), que es seguro pero
-- convierte el nombre en decoración — que es justo lo que la temática vino a
-- arreglar.
