// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Es el GEMELO de MyStats: el mismo carnet (cabecera, nombre con sello y banda
// de datos), pero adaptado a "ver a otro":
//   - Sin email (privado, no se expone).
//   - Sin botón Sign out, sin idioma, sin "puertas" a Archivo/Ranking
//     (esas navegan a TUS secciones; en un perfil ajeno no aplican).
//
// El carnet ya NO se dibuja aquí: vive en components/carnet/, compartido con
// MyStats. Los dos perfiles se despegaron una vez (este se quedó con el avatar
// de degradado menta del tema anterior mientras el propio migraba a papel) y la
// causa era tener dos copias del mismo objeto. Ahora es una: el mismo documento
// con otras cuatro casillas en la banda —aquí no hay puesto (la RPC pública no
// expone posición), hay aciertos—.
//
// AQUÍ HUBO UNA PLANCHA DE CROMOS con los logros conseguidos, y se retiró con el
// sistema entero. El motivo no fue estético: los logros de marca y de país
// salían de los MISMOS datos que El Archivo (los coches ganados cruzados con el
// catálogo), así que eran el álbum contado por segunda vez y peor — el Archivo
// lleva nº de edición, rareza, cuándo lo ganaste y en cuántos intentos. Dos
// superficies para un trabajo, y la buena es la otra. De aquel sistema
// sobrevive el sello del tier, que sí resume algo de un vistazo y sigue en el
// carnet (lib/collectionTier.js).
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
import ModalShell from "./ModalShell";
import PodiumMedals from "./PodiumMedals";
import Carnet, {
  CarnetCabecera,
  CarnetNombre,
  CarnetCifras,
  SelloTier,
} from "./carnet/Carnet";

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

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("publicProfile.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-5"
    >
      {state.error ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="pm-kicker">{t("publicProfile.publicLabel")}</p>
            <CloseButton onClick={onClose} className="-mr-2 -mt-2" />
          </div>
          <p className="text-sm text-rojo">{state.error}</p>
          {/* Misma salida que el resto de superficies con datos. Aquí importa
              incluso más: al perfil ajeno se llega desde la tabla, así que un
              fallo sin reintento obliga a cerrar, volver a buscar la fila y
              tocarla otra vez. */}
          <button
            type="button"
            onClick={() => setReintento((n) => n + 1)}
            className="pm-btn pm-btn--ghost mt-3 !w-auto px-6 !py-2 !text-[11px]"
          >
            {t("offline.retry")}
          </button>
        </>
      ) : (
        <>
          {/* El carnet hace de cabecera del modal, igual que en MyStats: el
              título «Perfil» que había encima repetía lo que dice el propio
              carnet y se comía 60px de alto. */}
          <Carnet className="shrink-0" aria-busy={cargando}>
            <CarnetCabecera
              kicker={t("publicProfile.publicLabel")}
              trailing={<CloseButton onClick={onClose} />}
            />

            <CarnetNombre
              nombre={nickname}
              cargando={cargando}
              // La antigüedad («Lector desde…») es del carnet PROPIO: la RPC
              // pública no expone la fecha de alta, y tampoco debería. Aquí el
              // renglón de acreditación lo llena lo único público que dice algo
              // de esta persona como lectora: su archivo.
              apunte={tn("publicProfile.portadas", portadas, { count: portadas })}
              sello={
                <SelloTier
                  tier={tier.tier}
                  label={selloTier}
                  title={t("myStats.tierLabel")}
                />
              }
            />

            {/* La banda: puntos · aciertos · racha · máxima. Sin puesto — la RPC
                pública no expone posición en la clasificación. */}
            <CarnetCifras
              items={[
                {
                  label: t("publicProfile.statPoints"),
                  value: cargando ? "—" : (stats?.total_points ?? 0),
                },
                {
                  label: t("myStats.statWins"),
                  value: cargando ? "—" : (stats?.total_wins ?? 0),
                  apunte:
                    !cargando && repescaWins > 0
                      ? tn("publicProfile.winsFromRepesca", repescaWins, {
                          count: repescaWins,
                        })
                      : null,
                },
                {
                  label: t("myStats.statStreak"),
                  value: cargando ? "—" : (stats?.current_streak ?? 0),
                  tono: onStreak ? "oro" : "",
                },
                {
                  label: t("myStats.statMaxStreak"),
                  value: cargando ? "—" : maxStreak,
                },
              ]}
            />
          </Carnet>

          {cargando ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <div className="scrollbar-premium -mx-5 min-h-0 flex-1 overflow-y-auto px-5 pt-4">
              {/* Lo que queda bajo el carnet son los PODIOS, y solo si los
                  tiene: el wrapper se colapsa con empty:hidden y el modal se
                  queda en el carnet a secas. Aquí iba también la plancha de
                  cromos con sus logros; se fue con el sistema (ver cabecera).
                  Que un podio sí se quede y una medalla de marca no, es la
                  distinción entera: el podio lo ganaste CONTRA alguien en un
                  mes concreto, la medalla te la daba el propio hecho de seguir
                  jugando. */}
              <div className="mb-4 empty:hidden">
                <PodiumMedals userId={userId} />
              </div>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}
