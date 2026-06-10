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
import { getMyProfile, getMyStreak } from "../lib/statsService";

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
      const nextUser = session?.user ?? null;
      const nextId = nextUser?.id ?? null;
      if (lastUserIdRef.current === nextId) return;
      lastUserIdRef.current = nextId;

      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setStreak(0);
        setCheckingProfile(false);
        return;
      }

      setCheckingProfile(true);

      try {
        // Paralelizamos: el profile y el streak son lecturas independientes.
        // Promise.all → cualquiera de los dos puede fallar sin afectar al
        // otro porque getMyStreak ya devuelve 0 en error y getMyProfile
        // tira → lo cazamos en el catch general.
        const [nextProfile, nextStreak] = await Promise.all([
          getMyProfile(nextUser.id),
          getMyStreak(nextUser.id),
        ]);
        setProfile(nextProfile);
        setStreak(nextStreak);
      } catch (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
        setStreak(0);
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
    setUser(null);
    setProfile(null);
    setStreak(0);
    setCheckingProfile(false);
  }

  return {
    user,
    profile,
    setProfile,
    checkingProfile,
    streak,
    setStreak,
    resetAuth,
  };
}
