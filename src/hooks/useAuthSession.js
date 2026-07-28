// src/hooks/useAuthSession.js
// Sesión de usuario + datos derivados (perfil, racha) para el shell de la app.
// Extraído de App.jsx para que el componente raíz no mezcle la lógica de
// autenticación con la de UI (modales, imagen, etc.): una responsabilidad
// por hook.
//
// Devuelve también setProfile/setStreak porque hay flujos que actualizan
// estos datos desde fuera del ciclo de auth (NicknameModal al guardar nick,
// useGame cuando el score persistido trae el currentStreak nuevo).

import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { getMyProfile, getMyStreak, getMySeasonRank } from "../lib/statsService";
import { esCuentaReal, marcarCuentaReal } from "../lib/auth";

export function useAuthSession() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  // Racha actual del usuario logueado, visible como badge del header.
  // 0 (o null si anónimo) = no se pinta el badge. Se sincroniza en dos
  // momentos: (1) al hacer login, leemos de Supabase; (2) cuando una
  // partida acaba, el score que devuelve useGame ya incluye el nuevo
  // currentStreak — el caller lo aplica vía setStreak sin refetch.
  const [streak, setStreak] = useState(0);
  // Puesto en el ranking de la TEMPORADA del usuario logueado, para la píldora
  // de estado del header. null = anónimo o aún sin puesto esta temporada (sin
  // puntos / sin nick) → la píldora cae a solo-racha. Shape: { rank, total } | null.
  // Se sincroniza en login junto a profile+streak, y App lo refresca tras un
  // resultado persistido (ganar sube puntos de la temporada → puede cambiar el puesto).
  const [rank, setRank] = useState(null);

  // Gate de re-sincronización: onAuthStateChange dispara TOKEN_REFRESHED
  // cada vez que el browser recupera el foco de la pestaña, con un user
  // de igual id pero referencia nueva. Sin este ref, cada vuelta a la
  // pestaña refetchea profile + streak (y arriba en useGame, dispara el
  // re-init de la partida → pantalla "Aparcando coche"). Sentinel
  // undefined = "nunca sincronizado" para distinguir del null = "sesión
  // anónima ya procesada".
  const lastUserIdRef = useRef(undefined);

  useEffect(() => {
    async function syncUser(session) {
      const sessionUser = session?.user ?? null;
      const nextId = sessionUser?.id ?? null;
      const nextAnon = sessionUser?.is_anonymous ?? false;
      const nextKey = nextId ? `${nextId}-${nextAnon}` : null;

      if (lastUserIdRef.current === nextKey) return;
      lastUserIdRef.current = nextKey;

      // `user` = CUENTA REAL. Una sesión anónima tiene JWT y fila en auth.users,
      // pero para la interfaz sigue siendo un visitante sin registrar: el header
      // le ofrece ENTRAR, el EndScreen le ofrece guardar su progreso y el ranking
      // no le habla. Mantener esa equivalencia es lo que permitió introducir las
      // sesiones anónimas sin repasar los ~59 sitios que preguntan `if (user)`.
      const cuentaReal = esCuentaReal(sessionUser);
      setUser(cuentaReal ? sessionUser : null);
      // Marca síncrona para el primer render del siguiente arranque (la usa
      // Configurator para colocar la faja sin salto de altura).
      marcarCuentaReal(cuentaReal);

      if (!sessionUser) {
        setProfile(null);
        setStreak(0);
        setRank(null);
        setCheckingProfile(false);
        return;
      }

      // Anónimo: SÍ tiene racha —es justo lo que la sesión anónima le compra, y
      // lo que da sentido al «no pierdas lo que llevas» del final de partida—
      // pero no tiene perfil ni puesto: sin display_name no entra en la tabla
      // (las SQL de temporada filtran `display_name IS NOT NULL`). Le pedimos
      // solo la racha; las otras dos lecturas serían dos viajes para dos nulos.
      if (!cuentaReal) {
        setProfile(null);
        setRank(null);
        setCheckingProfile(false);
        try {
          setStreak(await getMyStreak(sessionUser.id));
        } catch {
          setStreak(0);
        }
        return;
      }

      setCheckingProfile(true);

      try {
        // Paralelizamos: profile, streak y rank son lecturas independientes.
        // Promise.all → cualquiera puede fallar sin afectar a las otras porque
        // getMyStreak y getMySeasonRank ya devuelven su valor neutro (0 / null)
        // en error; solo getMyProfile tira → lo cazamos en el catch general.
        const [nextProfile, nextStreak, nextRank] = await Promise.all([
          getMyProfile(sessionUser.id),
          getMyStreak(sessionUser.id),
          getMySeasonRank(sessionUser.id),
        ]);
        setProfile(nextProfile);
        setStreak(nextStreak);
        setRank(nextRank);
      } catch (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
        setStreak(0);
        setRank(null);
      } finally {
        setCheckingProfile(false);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      syncUser(session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUser(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Reset optimista tras un signOut explícito (p.ej. desde MyStats): no
  // esperamos al evento SIGNED_OUT de Supabase para limpiar la UI. El
  // listener de arriba hará después su pasada idempotente (gate por id).
  function resetAuth() {
    lastUserIdRef.current = null;
    marcarCuentaReal(false);
    setUser(null);
    setProfile(null);
    setStreak(0);
    setRank(null);
    setCheckingProfile(false);
  }

  return {
    user,
    profile,
    setProfile,
    checkingProfile,
    streak,
    setStreak,
    rank,
    setRank,
    resetAuth,
  };
}
