// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Es el GEMELO de MyStats, adaptado a "ver a otro":
//   - Sin email (privado, no se expone).
//   - Sin botón Sign out, sin idioma, sin "puertas" a Archivo/Ranking
//     (esas navegan a TUS secciones; en un perfil ajeno no aplican).
//
// Con «Asfalto» comparte con MyStats las mismas piezas (perf-*): la identidad
// con su monograma y su rango, y las cifras en tarjetas. Los dos perfiles se
// despegaron una vez por tener dos copias del mismo objeto; ahora son la misma
// pantalla con otras casillas —aquí no hay puesto (la RPC pública no expone
// posición), hay puntos—.
//
// AQUÍ HUBO UNA PLANCHA DE CROMOS con los logros conseguidos, y se retiró con el
// sistema entero. El motivo no fue estético: los logros de marca y de país
// salían de los MISMOS datos que El Archivo (los coches ganados cruzados con el
// catálogo), así que eran el álbum contado por segunda vez y peor — el Archivo
// lleva nº de edición, rareza, cuándo lo ganaste y en cuántos intentos. Dos
// superficies para un trabajo, y la buena es la otra. De aquel sistema
// sobrevive el rango de coleccionista, que sí resume algo de un vistazo
// (lib/collectionTier.js).
//
// Datos vienen de la RPC `get_public_profile` (ver scripts/supabase-
// public-profile-rpc.sql). Solo expone campos que ya son públicos en
// el leaderboard + lista de coches ganados.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { getPublicProfile } from "../lib/statsService";
import { collectorTier } from "../lib/collectionTier";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";
import Superficie from "./Superficie";
import PodiumMedals from "./PodiumMedals";
import { Icon, I } from "./configurator/icons";

export default function PublicProfile({ open, onClose, userId }) {
  const { t, tn, locale } = useT();
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  // Reintento manual. Contador y no callback: este efecto ya depende de `t`, y
  // meter la carga en un `useCallback` la ataría igual a su identidad.
  const [reintento, setReintento] = useState(0);

  useEscape(open, onClose);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setState({ loading: true, data: null, error: "" });

    // Una sola lectura. Antes esto era un Promise.all con loadCatalog(), que
    // hacía falta para calcular los logros del otro usuario: el catálogo
    // entero descargado en un perfil ajeno para pintar medallas. Se fue con
    // ellas.
    getPublicProfile(userId)
      .then((profile) => {
        if (cancelled) return;
        setState({ loading: false, data: profile, error: "" });
      })
      .catch((err) => {
        console.error("[PublicProfile]", err);
        if (cancelled) return;
        // Detectamos el caso específico de "RPC no existe" para dar un
        // mensaje útil en dev: la causa más común es haber olvidado
        // ejecutar scripts/supabase-public-profile-rpc.sql en Supabase.
        const msg = String(err?.message || "").toLowerCase();
        const rpcMissing =
          msg.includes("function") &&
          (msg.includes("does not exist") || msg.includes("not found"));
        setState({
          loading: false,
          data: null,
          error: rpcMissing
            ? t("publicProfile.errorRpcMissing")
            : t("publicProfile.errorLoad"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, userId, t, reintento]);

  const cargando = state.loading;
  const stats = state.data?.stats;
  const nickname =
    state.data?.profile?.display_name || t("publicProfile.noNickname");
  const onStreak = (stats?.current_streak ?? 0) > 0;
  const maxStreak = stats?.max_streak ?? 0;
  const portadas = state.data?.wonCarIds?.length || 0;

  // Cuántos de sus aciertos salieron de números atrasados. La cifra «Aciertos»
  // suma las dos cosas —coche del día y repesca— y sin decirlo se compara mal:
  // la repesca va a una por día contra el archivo pendiente, así que un lector
  // veterano acumula por una vía que un recién llegado no tiene. No se le resta
  // nada a nadie; solo se dice de dónde viene el número.
  // A 0 no se pinta: quien nunca ha repescado no necesita que se lo aclaren.
  const repescaWins = state.data?.repescaWins || 0;

  // Tier global de coleccionista derivado del nº de coches ganados (mismo
  // hilo de nivel que el Archivo y el Perfil propio). No viene de la RPC: lo
  // calculamos de wonCarIds, que sí es público, con el helper compartido.
  const tier = collectorTier(portadas);
  const selloTier = tier.tier ? tier.label?.[locale] || tier.label?.es : null;

  // El monograma, como en la clasificación de la que se viene: la misma
  // inicial en el mismo disco, para que se reconozca a quien se ha tocado.
  const inicial = state.data?.profile?.display_name
    ? Array.from(nickname.trim())[0]?.toLocaleUpperCase() || "·"
    : "·";
  const guion = "—";

  return (
    <Superficie
      open={open}
      onClose={onClose}
      label={t("publicProfile.title")}
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-hoja-sobre flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-hoja-sobre flex items-end justify-center"
      panelWeb="modal-panel-flat panel-seccion w-full max-w-sm max-h-full overflow-y-auto overscroll-contain p-5"
    >
      {/* La X en su fila: el perfil ajeno se abre ENCIMA de la clasificación y
          cerrarlo te devuelve a ella, así que no lleva el nombre de sección en
          grande — el titular es el jugador. */}
      <div className="pub-cab">
        <span className="pub-kicker">{t("publicProfile.publicLabel")}</span>
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      {state.error ? (
        /* Misma salida que el resto de superficies con datos. Aquí importa
           incluso más: al perfil ajeno se llega desde la tabla, así que un
           fallo sin reintento obliga a cerrar, volver a buscar la fila y
           tocarla otra vez. */
        <div className="clas-aviso">
          <p className="clas-aviso-texto rojo">{state.error}</p>
          <button type="button" onClick={() => setReintento((n) => n + 1)} className="pm-btn pm-btn--ghost">
            {t("offline.retry")}
          </button>
        </div>
      ) : (
        <>
          <section className="perf-id" aria-busy={cargando}>
            <span className="perf-avatar" aria-hidden="true">{cargando ? "" : inicial}</span>
            <span className="perf-id-texto">
              <b className="perf-nick">{cargando ? guion : nickname}</b>
              {!cargando && (
                <span className="perf-desde">
                  {tn("publicProfile.portadas", portadas, { count: portadas })}
                </span>
              )}
              {selloTier && (
                <span className={`perf-rango tier-${tier.tier}`} title={t("myStats.tierLabel")}>
                  <Icon d={I.estrella} size={13} />
                  {t("garage.rango", { tier: selloTier })}
                </span>
              )}
            </span>
          </section>

          {/* Sus cifras: las mismas tarjetas que las tuyas, sin puesto — la
              RPC pública no expone la posición en la clasificación. */}
          <section className="perf-cifras" aria-label={t("perfil.cifras")}>
            <div className={"perf-cifra" + (onStreak ? " oro" : "")}>
              <span className="k">
                <Icon d={I.flame} size={13} />
                {t("myStats.statStreak")}
              </span>
              <span className="v">
                {cargando ? guion : stats?.current_streak ?? 0}
                {!cargando && <small>{tn("perfil.dias", stats?.current_streak ?? 0)}</small>}
              </span>
            </div>
            <div className="perf-cifra">
              <span className="k">{t("myStats.streakBest")}</span>
              <span className="v">
                {cargando ? guion : maxStreak}
                {!cargando && <small>{tn("perfil.dias", maxStreak)}</small>}
              </span>
            </div>
            <div className="perf-cifra">
              <span className="k">{t("myStats.statWins")}</span>
              <span className="v">{cargando ? guion : stats?.total_wins ?? 0}</span>
              {!cargando && repescaWins > 0 && (
                <span className="perf-cifra-nota">
                  {tn("publicProfile.winsFromRepesca", repescaWins, { count: repescaWins })}
                </span>
              )}
            </div>
            <div className="perf-cifra">
              <span className="k">{t("publicProfile.statPoints")}</span>
              <span className="v">{cargando ? guion : stats?.total_points ?? 0}</span>
            </div>
          </section>

          {/* Los PODIOS, y solo si los tiene: el envoltorio se colapsa con
              empty:hidden. Un podio se ganó CONTRA alguien un mes o una
              temporada concretos: es lo único del perfil ajeno que cuenta una
              historia y no un total. */}
          {!cargando && (
            <div className="perf-podios empty:hidden">
              <PodiumMedals userId={userId} />
            </div>
          )}
        </>
      )}
    </Superficie>
  );
}
