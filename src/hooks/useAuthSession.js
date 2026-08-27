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
import { esCuentaReal, leerLoginEnCurso } from "../lib/auth";
import { track } from "../lib/analytics";

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

  // ¿Acaba de entrar, AHORA MISMO? Lo enciende reportarLogin y lo apaga quien
  // lo consume (App, para ofrecer la firma una sola vez). No es lo mismo que
  // `user`: `user` está puesto en cada carga de página de alguien logueado, y
  // esto solo en la carga o el instante en que la sesión NACIÓ. Esa diferencia
  // es justo la que separa ofrecer la firma de volver a ser un peaje.
  const [recienEntrado, setRecienEntrado] = useState(false);

  // Gate de re-sincronización: onAuthStateChange dispara TOKEN_REFRESHED
  // cada vez que el browser recupera el foco de la pestaña, con un user
  // de igual id pero referencia nueva. Sin este ref, cada vuelta a la
  // pestaña refetchea profile + streak (y arriba en useGame, dispara el
  // re-init de la partida → pantalla "Aparcando coche"). Sentinel
  // undefined = "nunca sincronizado" para distinguir del null = "sesión
  // anónima ya procesada".
  const lastUserIdRef = useRef(undefined);

  useEffect(() => {
    /**
     * ¿Esta sincronización es una ENTRADA? Y si lo es, ¿por qué camino y
     * conservando el progreso anónimo o no?
     *
     * Dos caminos, porque el redirect de Google en web borra la evidencia:
     *
     *  - HIDRATACIÓN (`previo === undefined`): la sesión ya estaba al cargar.
     *    Solo cuenta como entrada si esta pestaña dejó una nota antes de irse a
     *    Google (ver lib/auth.js). Sin nota es alguien que ya venía logueado, y
     *    contarlo convertiría cada recarga en un registro nuevo.
     *  - TRANSICIÓN: la sesión cambió con la página abierta — código de 6 cifras
     *    o Google nativo. Aquí la nota, si la hubiera, está rancia (un redirect
     *    que no llegó a nada): se consume igual para que no contamine el
     *    siguiente login de la pestaña.
     */
    function reportarLogin(sessionUser, previo) {
      const marca = leerLoginEnCurso();
      if (!esCuentaReal(sessionUser)) return;

      if (previo === undefined) {
        if (!marca) return;
        track("login_success", {
          method: marca.method,
          vinculado: marca.anonId === sessionUser.id,
        });
        setRecienEntrado(true);
        return;
      }

      // Ya era cuenta real antes: esto es un refresco de token, no una entrada.
      if (typeof previo === "string" && previo.endsWith("-false")) return;

      const proveedores = sessionUser.app_metadata?.providers || [];
      track("login_success", {
        method: proveedores.includes("google") ? "google" : "email",
        // Mismo id que la sesión anónima anterior = conservó racha y Archivo.
        // Es LA métrica de esta entrega: no cuánta gente entra, sino cuánta
        // entra sin dejarse por el camino lo que ya llevaba jugado.
        vinculado: previo === `${sessionUser.id}-true`,
      });
      setRecienEntrado(true);
    }

    async function syncUser(session) {
      const sessionUser = session?.user ?? null;
      const nextId = sessionUser?.id ?? null;
      const nextAnon = sessionUser?.is_anonymous ?? false;
      const nextKey = nextId ? `${nextId}-${nextAnon}` : null;

      if (lastUserIdRef.current === nextKey) return;
      // `undefined` = primera pasada de esta carga de página. Distinguirlo de
      // `null` (sesión ya procesada, sin usuario) es lo que separa «acabo de
      // entrar» de «llegué ya logueado», y sin esa distinción login_success
      // contaría una entrada por cada recarga.
      const previo = lastUserIdRef.current;
      lastUserIdRef.current = nextKey;
      reportarLogin(sessionUser, previo);

      // `user` = CUENTA REAL. Una sesión anónima tiene JWT y fila en auth.users,
      // pero para la interfaz sigue siendo un visitante sin registrar: el header
      // le ofrece ENTRAR, el EndScreen le ofrece guardar su progreso y el ranking
      // no le habla. Mantener esa equivalencia es lo que permitió introducir las
      // sesiones anónimas sin repasar los ~59 sitios que preguntan `if (user)`.
      const cuentaReal = esCuentaReal(sessionUser);
      setUser(cuentaReal ? sessionUser : null);

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
    setRecienEntrado(false);
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
    recienEntrado,
    setRecienEntrado,
    resetAuth,
  };
}
