// src/components/MyStats.jsx
// TU PERFIL (sistema «Asfalto») — quién eres, tus cifras y tus ajustes.
//
// LO QUE CAMBIÓ CON «ASFALTO», y por qué. La prensa lo componía como un CARNET
// de lector: cabecera con doble filete, el nombre en un recuadro y una banda de
// cuatro datos en cuerpo de agencia. Se leía como un documento, que era la
// idea, pero no se jugaba con él. Ahora es la pantalla de un jugador:
//
//   · TÚ ARRIBA: el monograma, la firma en titular, «Lector desde…» y tu rango
//     de coleccionista, con el lápiz para cambiar la firma a mano.
//   · CUATRO CIFRAS EN TARJETAS, no en una banda: la racha viva (en oro: es lo
//     que vale algo), la mejor racha, los aciertos sobre lo jugado y tu puesto
//     en la temporada, que lleva a la clasificación.
//   · CÓMO GANAS: la distribución de tus partidas por intentos, con la barra
//     más larga en tinta — la misma lectura que «Hoy en el mundo» del final de
//     partida, pero de ti.
//   · LOS AJUSTES COMO UNA LISTA DE VERDAD: tema (Noche, Día o Auto), idioma,
//     escribir al equipo y cerrar sesión. «Eliminar cuenta» va aparte, debajo
//     y en rojo: son dos acciones que empiezan igual («salir de aquí») y acaban
//     en sitios opuestos, y la distancia es lo que evita el toque equivocado.
//
// Las puertas al Archivo y a la Clasificación se retiraron de aquí: en el móvil
// están en la barra de pestañas y en el escritorio en la cabecera, y la tarjeta
// del puesto ya lleva a la clasificación.
//
// Lo que NO cambia y conviene no romper: el modal de borrado se monta como
// HERMANO de la superficie, no como hijo (ver el comentario al final).

import { useEffect, useState } from "react";
import { getProfileSummary, getMyDistribution, getCurrentSeason } from "../lib/statsService";
import { signOut } from "../lib/auth";
import { useEscape } from "../hooks/useEscape";
import { useHistoryChain } from "../hooks/useHistoryClose";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import Superficie from "./Superficie";
import DeleteAccountModal from "./DeleteAccountModal";
import PodiumMedals from "./PodiumMedals";
import { FilaTema, FilaIdioma, FilaAviso } from "./Ajustes";
import { Icon, I } from "./configurator/icons";
import { ordinal } from "./PuestoCifra";
import { debeOfrecerApp, urlPlay } from "../lib/edicionApp";
import { track } from "../lib/analytics";

// La tarjeta «Intentos para acertar». La barra más larga va en tinta (es tu
// número), el resto en gris, y las perdidas al final, más apagadas.
function Distribucion({ dist }) {
  const { t } = useT();
  if (!dist || dist.jugadas === 0) return null;
  const max = Math.max(1, ...dist.porIntento, dist.perdidas);
  const mejor = Math.max(...dist.porIntento);
  const pct = Math.round((dist.ganadas / dist.jugadas) * 100);
  const filas = [
    ...dist.porIntento.map((n, i) => ({ k: String(i + 1), n, fuerte: n > 0 && n === mejor })),
    { k: "x", n: dist.perdidas, perdidas: true },
  ];
  return (
    <section className="perf-tarjeta" aria-label={t("perfil.distribucion")}>
      <div className="perf-tarjeta-cab">
        <h3>{t("perfil.distribucion")}</h3>
        <span>{t("perfil.porcentaje", { pct })}</span>
      </div>
      <div className="perf-dist">
        {filas.map((f) => (
          <div key={f.k} className={"perf-dist-fila" + (f.fuerte ? " fuerte" : "") + (f.perdidas ? " perdidas" : "")}>
            <span className="perf-dist-k">
              {f.perdidas ? (
                <>
                  <Icon d={I.x} size={13} strokeWidth="2.2" />
                  <span className="sr-only">{t("perfil.perdidas")}</span>
                </>
              ) : (
                f.k
              )}
            </span>
            <span className="perf-dist-barra">
              <i style={{ width: `${(f.n / max) * 100}%` }} />
            </span>
            <span className="perf-dist-n">{f.n}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function MyStats({
  open,
  onClose,
  onSignedOut,
  onOpenRanking,
  onOpenNickname,
  onOpenContacto,
}) {
  const { t, tn, locale, dateLocale } = useT();
  const [borrarAbierto, setBorrarAbierto] = useState(false);
  const [reintento, setReintento] = useState(0);
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    stats: null,
    points: 0,
    rank: null,
    collection: null,
    tier: null,
    error: "",
  });
  // La distribución y la temporada van APARTE del resumen: si fallan (una
  // columna sin GRANT, una temporada sin configurar) el perfil se pinta igual
  // y solo falta esa tarjeta. Un perfil que no abre por un dato secundario
  // sería peor que un perfil con un hueco.
  const [dist, setDist] = useState(null);
  const [season, setSeason] = useState(null);

  useEffect(() => {
    if (!open) return;

    setState((current) => ({ ...current, loading: true, error: "" }));

    getProfileSummary()
      .then((data) => setState({ loading: false, error: "", ...data }))
      .catch((err) => {
        console.error("[MyStats] fallo cargando el perfil", err);
        setState((current) => ({
          ...current,
          loading: false,
          error: t("myStats.errorLoad"),
        }));
      });
    getMyDistribution()
      .then(setDist)
      .catch((err) => {
        console.error("[MyStats] fallo cargando la distribución", err);
        setDist(null);
      });
    getCurrentSeason()
      .then(setSeason)
      .catch(() => setSeason(null));
  }, [open, reintento]);

  async function handleSignOut() {
    const { error } = await signOut();

    if (error) {
      setState((current) => ({ ...current, error: t("myStats.errorSignOut") }));
      return;
    }

    onSignedOut?.();
    onClose?.();
  }

  // El modal de borrado se monta encima con su propio Escape: sin la condición,
  // una pulsación cerraría los dos.
  useEscape(open && !borrarAbierto, onClose);

  // La «atrás» de Android, con la misma cadena que el Escape.
  useHistoryChain(open, () => {
    if (borrarAbierto) {
      setBorrarAbierto(false);
      return true;
    }
    onClose?.();
    return false;
  });

  useEffect(() => {
    if (!open) setBorrarAbierto(false);
  }, [open]);

  const cargando = state.loading;
  const stats = state.stats;
  const sinFirma = !state.profile?.display_name;
  const nickname = state.profile?.display_name || t("myStats.noNickname");
  const email = state.user?.email || "";
  const inicial = sinFirma ? "·" : Array.from(nickname.trim())[0]?.toLocaleUpperCase() || "·";

  const tier = state.tier?.tier || null;
  const tierLabel = tier ? state.tier.label?.[locale] || state.tier.label?.es : null;

  const rachaViva = stats?.current_streak ?? 0;
  const maxStreak = stats?.max_streak ?? 0;
  const wins = stats?.total_wins ?? 0;
  const primerDia = !cargando && !wins && !maxStreak;

  // «Lector desde mayo de 2026»: el created_at de la cuenta, no del perfil.
  const alta = state.user?.created_at ? new Date(state.user.created_at) : null;
  const desde =
    alta && !Number.isNaN(alta.getTime())
      ? t("myStats.readerSince", {
          date: alta.toLocaleDateString(dateLocale, { month: "long", year: "numeric" }),
        })
      : null;

  // Cerrar el perfil antes de abrir otra superficie: dos hojas apiladas con sus
  // velos y sus Escape son el enredo que documenta ModalShell.
  function go(opener, source) {
    onClose?.();
    opener?.(source);
  }

  const ofreceApp = debeOfrecerApp();
  useEffect(() => {
    if (open && ofreceApp) track("app_promo_shown", { surface: "perfil" });
  }, [open, ofreceApp]);

  const guion = "—";
  const puesto = state.rank?.rank ? ordinal(state.rank.rank, locale) : guion;

  return (
    <>
    <Superficie
      open={open}
      onClose={onClose}
      label={t("prensa.perfil")}
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-[80] flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-[80] flex items-end justify-center"
      panelWeb="modal-panel-flat panel-seccion w-full max-w-sm max-h-full overflow-y-auto overscroll-contain p-5"
    >
      <div className="clas-cab">
        <h2 className="clas-titulo">{t("prensa.perfil")}</h2>
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      {state.error && !state.user ? (
        /* Con salida: un fallo que solo se diagnostica y no se puede
           reintentar se lee como una app rota. */
        <div className="clas-aviso">
          <p className="clas-aviso-texto rojo">{state.error}</p>
          <button type="button" onClick={() => setReintento((n) => n + 1)} className="pm-btn pm-btn--ghost">
            {t("offline.retry")}
          </button>
        </div>
      ) : !cargando && !state.user ? (
        <div className="clas-aviso">
          <p className="clas-aviso-texto">{t("myStats.promoLogin")}</p>
        </div>
      ) : (
        <>
          {/* ── Tú ── */}
          <section className="perf-id" aria-busy={cargando}>
            <span className="perf-avatar" aria-hidden="true">{cargando ? "" : inicial}</span>
            <span className="perf-id-texto">
              <b className={"perf-nick" + (sinFirma ? " sin" : "")}>{cargando ? guion : nickname}</b>
              {(sinFirma ? t("myStats.sinFirmaApunte") : desde) && !cargando && (
                <span className="perf-desde">{sinFirma ? t("myStats.sinFirmaApunte") : desde}</span>
              )}
              {tierLabel && (
                <span className={`perf-rango tier-${tier}`} title={t("myStats.tierLabel")}>
                  <Icon d={I.estrella} size={13} />
                  {t("garage.rango", { tier: tierLabel })}
                </span>
              )}
            </span>
            <button
              type="button"
              className="perf-editar"
              onClick={() => go(onOpenNickname)}
              aria-label={sinFirma ? t("myStats.pickNick") : t("myStats.changeNick")}
              title={sinFirma ? t("myStats.pickNick") : t("myStats.changeNick")}
            >
              <Icon d={I.lapiz} size={20} />
            </button>
          </section>

          {/* ── Tus cifras ── */}
          <section className="perf-cifras" aria-label={t("perfil.cifras")}>
            <div className={"perf-cifra" + (rachaViva > 0 ? " oro" : "")}>
              <span className="k">
                <Icon d={I.flame} size={13} />
                {t("myStats.statStreak")}
              </span>
              <span className="v">
                {cargando ? guion : rachaViva}
                {!cargando && <small>{tn("perfil.dias", rachaViva)}</small>}
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
              <span className="v">
                {cargando ? guion : wins}
                {!cargando && dist?.jugadas > 0 && <small>{t("perfil.deN", { n: dist.jugadas })}</small>}
              </span>
            </div>
            <button type="button" className="perf-cifra clic" onClick={() => go(onOpenRanking, "perfil")}>
              <span className="k">
                {season ? t("ranking.seasonKicker", { n: season.number }) : t("myStats.rankShort")}
                <Icon d={I.chevR} size={14} />
              </span>
              <span className="v">
                {cargando ? guion : puesto}
                {!cargando && Number.isFinite(state.rank?.points) && (
                  <small>
                    {state.rank.points} {t("myStats.ptsShort")}
                  </small>
                )}
              </span>
            </button>
          </section>

          <Distribucion dist={dist} />

          {/* Podios de temporada y de mes (solo si tiene alguno). */}
          <div className="perf-podios empty:hidden">
            <PodiumMedals userId={state.user?.id} />
          </div>

          {primerDia && <p className="perf-nota">{t("myStats.firstDay")}</p>}

          {/* ── Ajustes ── */}
          <section className="perf-ajustes" aria-label={t("myStats.settings")}>
            <h3 className="grupo-titulo">{t("myStats.settings")}</h3>
            <div className="grupo-lista">
              <FilaTema />
              <FilaIdioma />
              <FilaAviso abierto={open} />
              {/* La edición Android, permanente y sin caducidad: aquí no molesta
                  a nadie y recoge al que la busca a propósito. */}
              {ofreceApp && (
                <button
                  type="button"
                  className="grupo-fila"
                  onClick={() => {
                    track("app_promo_click", { surface: "perfil" });
                    window.open(urlPlay("perfil"), "_blank", "noopener,noreferrer");
                  }}
                >
                  <span className="grupo-fila-texto">
                    <b>{t("app.promoDoor")}</b>
                    <span>{t("myStats.appApunte")}</span>
                  </span>
                  <Icon d={I.chevR} size={18} className="grupo-chev" />
                </button>
              )}
              {/* Escribir al equipo, ANTES que cerrar sesión: quien baja hasta
                  aquí buscando «cómo aviso de esto» no quiere irse, quiere que
                  alguien lo lea. */}
              <button type="button" className="grupo-fila" onClick={() => onOpenContacto?.()}>
                <span className="grupo-fila-texto">
                  <b>{t("contacto.ajusteTitulo")}</b>
                  <span>{t("contacto.ajusteApunte")}</span>
                </span>
                <Icon d={I.chevR} size={18} className="grupo-chev" />
              </button>
              {/* El correo va aquí y no arriba: nadie abre su perfil para ver su
                  propio correo, pero al cerrar sesión sí importa cuál se cierra. */}
              <button type="button" className="grupo-fila" onClick={handleSignOut}>
                <span className="grupo-fila-texto">
                  <b>{t("common.signOut")}</b>
                  <span title={email}>{email || t("myStats.sessionAnon")}</span>
                </span>
                <Icon d={I.arrowR} size={18} className="grupo-chev" />
              </button>
            </div>

            {/* Solo con cuenta de verdad (`email` vacío = sesión anónima, que
                no tiene nada que borrar en servidor). Play exige que exista y
                que se encuentre; no exige que compita. */}
            {email && (
              <button type="button" className="perf-borrar" onClick={() => setBorrarAbierto(true)}>
                {t("deleteAccount.entry")}
              </button>
            )}
          </section>

          {state.error && <p className="perf-error">{state.error}</p>}
        </>
      )}
    </Superficie>

    {/* HERMANO de la superficie, no hijo: el panel de ModalShell lleva
        `transform` (la animación de entrada), y un `position: fixed` dentro de
        un ancestro con transform se posiciona contra ESE ancestro, no contra la
        ventana — anidarlo lo dejaría recortado en vez de centrado. */}
    <DeleteAccountModal open={borrarAbierto} onClose={() => setBorrarAbierto(false)} />
    </>
  );
}
