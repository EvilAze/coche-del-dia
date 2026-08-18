-- scripts/2026-08-buzon-de-mensajes.sql
-- UN BUZÓN DENTRO DEL JUEGO, LEÍBLE DESDE EL PANEL.
--
-- Aplicar en el SQL editor de Supabase. Idempotente.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ NO ES «LEER EL CORREO DE soporte@»
-- ---------------------------------------------------------------------------
-- El correo entrante del dominio lo gobierna ImprovMX (ver
-- docs/correo-magic-link.md), y ImprovMX no es un buzón: es un REENVIADOR. Coge
-- lo que llega a soporte@cochedeldia.com y lo empuja a una cuenta personal, sin
-- guardar nada. No hay ningún servidor nuestro donde esos correos existan, así
-- que «que el panel los enseñe» habría exigido cambiar los MX del dominio,
-- contratar un servicio de inbound y aceptar que los correos de la gente pasen a
-- vivir en esta base de datos.
--
-- Esto es lo otro: que el jugador pueda escribir DESDE la app, y que eso caiga
-- aquí. Cero infraestructura de correo, cero cambios de DNS, y con una ventaja
-- que el correo no tiene — el mensaje llega ya atado a un `user_id`, así que se
-- sabe quién escribe sin tener que preguntarlo ni cruzar direcciones a mano.
--
-- Lo que NO cubre, dicho claro: lo que llegue a soporte@ desde fuera de la app
-- sigue yendo solo al buzón personal. Esto no lo sustituye.

-- ============================================================================
-- [1] La tabla
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mensajes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE cubre el borrado REAL de una cuenta (el cron de limpieza de
  -- anónimas). El borrado a petición del jugador NO pasa por aquí: api/
  -- delete-account.js hace borrado BLANDO en GoTrue —la fila de auth.users se
  -- queda— y va tabla por tabla, así que allí hay que borrar esto a mano, igual
  -- que se hace con push_subscriptions. Está añadido en ese endpoint.
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'problema' | 'reporte' | 'sugerencia'. La allowlist la impone la RPC.
  tipo        text NOT NULL,
  cuerpo      text NOT NULL,
  -- Opcional y escrito por el jugador: hace falta para poder CONTESTARLE. Un
  -- anónimo no tiene email en auth.users, y un registrado puede querer que le
  -- respondan a otra dirección.
  email       text,
  plataforma  text,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  -- NULL = sin leer. Es la bandeja entera: no hace falta una columna de estado.
  leido_en    timestamptz
);

CREATE INDEX IF NOT EXISTS mensajes_sin_leer_idx
  ON public.mensajes (creado_en DESC) WHERE leido_en IS NULL;

COMMENT ON TABLE public.mensajes IS
  'Buzón del juego: lo que los jugadores escriben desde la app. Deny-all; se escribe por enviar_mensaje() y se lee con service_role desde el panel.';

-- Deny-all, mismo patrón que push_subscriptions. Que un jugador pudiera LEER
-- esta tabla sería publicar lo que ha escrito todo el mundo —incluidos los
-- reportes sobre otros jugadores, que es justo lo que no puede saberse—. La
-- única vía de escritura es la RPC de abajo; la de lectura, el panel con
-- service_role.
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mensajes FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- [2] La escritura: enviar_mensaje()
-- ============================================================================
-- RPC y no endpoint por la misma razón que feature_events: el plan Hobby de
-- Vercel tiene 12 funciones y ya andamos justos. Una RPC SECURITY DEFINER
-- escribe sin conceder GRANT de escritura al rol del cliente.
--
-- LAS TRES DEFENSAS, porque esto lo puede llamar cualquiera con la anon key:
--   · Sesión obligatoria. Los anónimos tienen una (signInAnonymously), así que
--     esto no deja fuera a nadie que pueda jugar; solo obliga a que haya un uid
--     al que atribuir el mensaje y sobre el que contar la cuota.
--   · Tipo de una allowlist. Sin esto la columna se llena de lo que quiera el
--     cliente y el panel deja de poder agrupar por nada.
--   · Cuota de 5 mensajes por cuenta y 24 h. Es la defensa real contra el
--     spam: sin ella, un bucle llena la tabla en un minuto. Cinco es holgado
--     para una persona con un problema de verdad y ridículo para un script.
--
-- Los límites de longitud van aquí y no solo en el formulario, por lo mismo que
-- el CHECK del nick: lo que valida el navegador no es una defensa (ver
-- scripts/2026-08-nick-validado-en-servidor.sql).
CREATE OR REPLACE FUNCTION public.enviar_mensaje(
  p_tipo       text,
  p_cuerpo     text,
  p_email      text DEFAULT NULL,
  p_plataforma text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_uid    uuid := auth.uid();
  v_cuerpo text := btrim(coalesce(p_cuerpo, ''));
  v_email  text := nullif(btrim(coalesce(p_email, '')), '');
  v_tipo   text := lower(btrim(coalesce(p_tipo, '')));
  v_plat   text := case when p_plataforma in ('app','web') then p_plataforma else 'web' end;
  v_recientes int;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'sin sesion' using errcode = '42501';
  end if;

  if v_tipo not in ('problema', 'reporte', 'sugerencia') then
    raise exception 'tipo no valido' using errcode = '22023';
  end if;

  -- 10 caracteres: por debajo de eso no es un mensaje, es un dedo en el teclado.
  -- 4000: cabe cualquier explicación larga y acota lo que puede crecer la fila.
  if length(v_cuerpo) < 10 or length(v_cuerpo) > 4000 then
    raise exception 'cuerpo fuera de rango' using errcode = '22023';
  end if;

  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'email no valido' using errcode = '22023';
  end if;

  select count(*) into v_recientes
  from public.mensajes
  where user_id = v_uid
    and creado_en > now() - interval '24 hours';

  if v_recientes >= 5 then
    raise exception 'cuota diaria agotada' using errcode = '54000';
  end if;

  insert into public.mensajes (user_id, tipo, cuerpo, email, plataforma)
  values (v_uid, v_tipo, v_cuerpo, v_email, v_plat)
  returning id into v_id;

  return v_id;
end;
$$;

REVOKE ALL ON FUNCTION public.enviar_mensaje(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje(text, text, text, text) TO anon, authenticated;

-- ============================================================================
-- [3] Verificación
-- ============================================================================
-- Esperado: tabla creada, RLS activado, sin policies (deny-all), la RPC
-- ejecutable por el cliente y la bandeja a cero.
SELECT comprobacion, estado FROM (
  SELECT 1 AS orden, 'Tabla mensajes' AS comprobacion,
    coalesce((SELECT CASE WHEN relrowsecurity THEN 'creada, RLS on' ELSE 'creada, RLS OFF' END
              FROM pg_class WHERE relname = 'mensajes' AND relkind = 'r'), 'FALTA') AS estado

  UNION ALL SELECT 2, 'Policies (deben ser 0)',
    (SELECT count(*)::text FROM pg_policy WHERE polrelid = 'public.mensajes'::regclass)

  UNION ALL SELECT 3, 'RPC enviar_mensaje',
    coalesce((SELECT 'ejecutable por el cliente' FROM information_schema.role_routine_grants
              WHERE routine_name = 'enviar_mensaje' AND grantee = 'authenticated' LIMIT 1),
             'SIN GRANT')

  UNION ALL SELECT 4, 'Mensajes sin leer',
    (SELECT count(*)::text FROM public.mensajes WHERE leido_en IS NULL)
) v
ORDER BY orden;
