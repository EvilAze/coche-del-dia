// src/App.jsx
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

import Configurator from "./components/configurator/Configurator";
import LoginModal from "./components/LoginModal";
import ModalShell from "./components/ModalShell";
import { getMySeasonRank } from "./lib/statsService";
import { track } from "./lib/analytics";
import {
  leerErrorAuth,
  limpiarErrorAuth,
  esIdentidadYaVinculada,
} from "./lib/authCallback";
import { useGame } from "./hooks/useGame";
import { useAuthSession } from "./hooks/useAuthSession";
import { useModalState } from "./hooks/useModalState";
import { useEscape } from "./hooks/useEscape";
import { useHistoryClose } from "./hooks/useHistoryClose";
import { useDayRollover } from "./hooks/useDayRollover";
import { useT } from "./i18n";
import { apiUrl } from "./lib/apiUrl";
import { isNative, rearmIfEnabled } from "./lib/notifications";
import { reminderCopy } from "./lib/reminderCopy";

// Modales lazy: viven todos detrás de un clic, así que NO entran en el bundle
// inicial. Se descargan la primera vez que se abren y, una vez montados, se
// mantienen (ver `mounted` más abajo) para que las animaciones de salida de
// ModalShell/AnimatePresence sigan funcionando.
const Ranking = lazy(() => import("./components/Ranking"));
const Garage = lazy(() => import("./components/Garage"));
const MyStats = lazy(() => import("./components/MyStats"));
const AchievementsModal = lazy(() => import("./components/AchievementsModal"));
const NicknameModal = lazy(() => import("./components/NicknameModal"));
const HowToPlayModal = lazy(() => import("./components/HowToPlayModal"));

export default function App() {
  const { t, tn } = useT();
  // Sesión + perfil + racha: la lógica de auth vive en useAuthSession; aquí
  // solo consumimos el estado y los setters que necesitan otros flujos.
  const {
    user,
    profile,
    setProfile,
    checkingProfile,
    streak,
    setStreak,
    rank,
    setRank,
    resetAuth,
  } = useAuthSession();
  // Overlays globales: modal activo + mapa de modales lazy ya montados.
  const {
    activeModal,
    setActiveModal,
    mounted,
    // (`mountModal` ya no se usa aquí: lo consumía el auto-montaje del modal de
    // nick, que se abría solo. Ahora el nick se pide con `openModal`, que monta
    // y activa de una vez, como el resto.)
    openModal,
    closeModal,
  } = useModalState();
  // "?" de ayuda: pulsa sutilmente SOLO en la primera visita para invitar al
  // recién llegado, sin modal forzado (evita la fricción de entrada). Se apaga
  // al abrir el "cómo se juega".
  const [howtoPulse, setHowtoPulse] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("ccd_howto_seen")) setHowtoPulse(true);
    } catch {
      // localStorage puede fallar (modo privado/iframe): sin pulso, sin drama.
    }
  }, []);

  // ── VUELTA DE UN LOGIN FALLIDO ──────────────────────────────────────────
  // Si el flujo de OAuth vuelve con error, la URL lo trae y hasta ahora no lo
  // miraba nadie: supabase-js no encontraba tokens, la app se quedaba como
  // estaba y el jugador veía… nada. Ese silencio es lo que convirtió un fallo
  // concreto (vincular Google a una sesión anónima cuando esa cuenta ya es de
  // otro usuario) en un «no funciona» imposible de diagnosticar.
  //
  // Se lee UNA vez al arrancar, se limpia la URL —si no, recargar repite el
  // aviso y el enlace queda con el error pegado— y se abre el modal de login
  // con la explicación y la salida.
  const [avisoLogin, setAvisoLogin] = useState(null);
  useEffect(() => {
    const err = leerErrorAuth();
    if (!err) return;
    limpiarErrorAuth();
    console.warn("[auth] vuelta con error:", err.code, err.description);
    setAvisoLogin(esIdentidadYaVinculada(err) ? "identidad-ocupada" : "generico");
    setActiveModal("login");
  }, [setActiveModal]);

  // Detecta si venimos de repesca con ?garage=true y abre el garaje automáticamente
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("garage") === "true") {
        openModal("garage");
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
      }
    } catch (e) {
      console.error(e);
    }
  }, [openModal]);
  // Badge ámbar del icono del Garaje: true cuando hay repesca disponible
  // hoy y al menos un coche "missed" (ya fue coche del día y no se ganó).
  // Lo calculamos con una llamada ligera a /api/garage tras login.
  const [repescaAlert, setRepescaAlert] = useState(false);
  // `revealReady` = la imagen completa (sin crop) del coche del día ya ha
  // cargado tras terminar la partida. Lo enciende CarImage vía onRevealLoad.
  // ResultPanel lo usa para temporizar su scroll automático: espera a que
  // el jugador vea el coche entero antes de desplazar la vista al resultado.
  const [revealReady, setRevealReady] = useState(false);
  const handleRevealLoad = useCallback(() => setRevealReady(true), []);

  // Sin splash bloqueante. Antes había un GarageDoorSplash con duración
  // mínima de 1700 ms que el usuario fiel veía cada día (o cada sesión)
  // antes de poder jugar. La pieza era preciosa pero suponía un peaje
  // visible: ~25% del tiempo total que el jugador medio pasa en la web.
  //
  // Estrategia actual: app-shell instantáneo + skeleton del recuadro de
  // imagen mientras /api/get-daily-car resuelve. Header, contador de
  // intentos y formulario aparecen en el primer paint (~150-400 ms tras
  // la navegación), y el coche encaja en su sitio con el fade-in nativo
  // de CarImage (LQIP → AVIF) sin overlay que ocultar.
  //
  // Si en el futuro quieres recuperar la pieza de marca, hazlo como
  // intro opcional (link "Ver intro" en footer) o como animación de
  // arranque de PWA — no como bloqueo del primer paint.

  // Al perder la sesión (logout desde otra pestaña, token caducado…),
  // cerramos cualquier modal abierto: la mayoría muestran datos del usuario
  // que ya no existe. Antes esto vivía dentro del sync de auth; ahora la
  // sesión es responsabilidad de useAuthSession y la UI reacciona aquí.
  useEffect(() => {
    if (!user) closeModal();
  }, [user, closeModal]);

  // Al iniciar sesión, cerramos el modal de login y volvemos al juego. En web
  // el redirect de signInWithOAuth lo hacía implícito (recarga de página); en
  // la app el login NATIVO vuelve a la misma vista con la sesión ya creada,
  // así que el modal hay que cerrarlo aquí al detectar el usuario.
  useEffect(() => {
    if (user && activeModal === "login") closeModal();
  }, [user, activeModal, closeModal]);

  // Recordatorio "racha en peligro": cuando se conoce/actualiza la racha del
  // logueado (al loguear o tras terminar partida), reprogramamos la notificación
  // local diaria con copy personalizado (>=2 días → "no pierdas tu racha"; si no,
  // genérico). Solo nativo; rearmIfEnabled no-opea sin permiso del SO. Anónimos
  // tienen racha 0 → copy genérico.
  useEffect(() => {
    if (!isNative()) return;
    rearmIfEnabled(reminderCopy(t, tn, streak)).catch(() => {});
  }, [streak, t, tn]);

  // Radar de repesca: tras login, miramos si hay repesca disponible Y
  // al menos un coche "missed" en el catálogo. Una sola petición ligera;
  // se refresca cuando cambia el `user.id` (login/logout) y cuando se
  // cierra el modal del Garaje (por si acaba de jugarse una repesca).
  useEffect(() => {
    if (!user) {
      setRepescaAlert(false);
      return;
    }
    let cancelled = false;
    async function checkAlert() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch("/api/garage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // `repescaPoolSize` lo calcula el server: coches que ya fueron daily
        // y el usuario no ha ganado. Antes derivábamos esto en cliente
        // sumando `wasDaily && !unlocked`, pero exponer `wasDaily` por-coche
        // filtraba candidatos al coche del día (ver api/garage.js).
        const poolSize = Number(body.repescaPoolSize) || 0;
        setRepescaAlert(Boolean(body.repescaAvailable) && poolSize > 0);
      } catch (err) {
        // Fallar silenciosamente: el badge es decorativo, no crítico.
        console.error("[App] repesca alert check:", err);
      }
    }
    checkAlert();
    return () => {
      cancelled = true;
    };
    // Re-check cuando se cierra el modal del Garaje: el usuario puede haber
    // navegado a /repesca, jugado, y vuelto. activeModal === null tras eso.
  }, [user, activeModal]);

  // `source` = desde dónde se abrió (faja de la portada, faja pegada, final de
  // partida…). Sin él no hay forma de saber si ascender el ranking a sección
  // propia funcionó: el evento contaba aperturas, pero no de dónde venían.
  const openRanking = (source = "unknown") => {
    // Medir cuánto se usa la "palanca" del ranking. Dos sumideros:
    //   1) Umami (track): visible en el dashboard de Umami (free tier).
    //   2) Contador propio en Supabase: lo lee el panel admin de Analítica.
    //      La API de Umami es de pago, así que el panel NO puede leer de ahí;
    //      en su lugar incrementamos una RPC SECURITY DEFINER (no requiere
    //      permiso de escritura del cliente, corre como owner). Misma
    //      convención `auth` que garage_open.
    const auth = user ? "user" : "anon";
    track("ranking_open", { auth, source: typeof source === "string" ? source : "unknown" });
    // Fire-and-forget: jamás bloquear ni romper la apertura del ranking.
    supabase
      .rpc("increment_feature_event", { p_event: "ranking_open", p_auth: auth })
      .then(undefined, () => {});
    openModal("ranking");
  };
  const openGarage = () => openModal("garage");
  const openProfile = () => openModal("profile");
  const openAchievements = () => openModal("achievements");

  // LoginModal NO es lazy a propósito: es la puerta de entrada y un chunk que
  // descargar en ese momento se nota. No necesita mountModal.
  function openLogin() {
    setActiveModal("login");
  }

  function openHowTo() {
    try { localStorage.setItem("ccd_howto_seen", "1"); } catch { /* ignore */ }
    setHowtoPulse(false);
    openModal("howto");
  }

  function handleSignedOut() {
    resetAuth();
    closeModal();
  }

  // ── EL NICK YA NO ES UN PEAJE ─────────────────────────────────────────────
  // Antes, este componente abría NicknameModal SOLO en cuanto veía a un usuario
  // logueado sin display_name, y el modal no se podía cerrar: el jugador que
  // acababa de crear cuenta se topaba con un formulario obligatorio antes de
  // poder jugar. Y sobraba, porque el nick solo lo usa la clasificación (ver el
  // comentario largo de NicknameModal.jsx).
  //
  // Ahora `necesitaNick` no ABRE nada: solo informa a las dos pantallas donde la
  // firma significa algo —la clasificación y la victoria— para que ofrezcan
  // elegirla. El jugador que nunca mire el ranking nunca verá este modal.
  const necesitaNick = Boolean(user && !checkingProfile && !profile?.display_name);

  // A dónde volver tras guardar. El slot de modal activo es único, así que pedir
  // el nick desde el ranking lo cierra; sin esto, el jugador guardaba su firma y
  // se quedaba mirando el juego, lejos de la tabla que iba a ver.
  const [nickVolverA, setNickVolverA] = useState(null);
  const openNickname = useCallback(
    (volverA = null) => {
      setNickVolverA(volverA);
      openModal("nickname");
    },
    [openModal]
  );

  // Prefetch de los chunks de modales ligeros cuando el navegador está OCIOSO.
  // El bundle inicial sigue ligero (no se ejecutan al cargar), pero al pulsar
  // se abren al instante porque el chunk ya está en caché → preserva el flujo
  // premium sin penalizar el primer paint. Garaje se deja fuera a propósito
  // (chunk pesado por framer-motion; acción deliberada y menos frecuente).
  // Respetamos Save-Data: si el usuario pide ahorro de datos, no prefetcheamos.
  useEffect(() => {
    if (navigator.connection?.saveData) return;
    const prefetch = () => {
      import("./components/Ranking");
      import("./components/MyStats");
      import("./components/AchievementsModal");
      import("./components/NicknameModal");
    };
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(prefetch, 2500);
    return () => clearTimeout(t);
  }, []);

  useEscape(activeModal === "login", closeModal);

  // «Atrás» de Android / gesto del navegador: cierra el overlay activo en vez
  // de sacar al usuario de la web. Como `activeModal` es un único slot, una
  // sola línea cubre login, ranking, perfil, logros, cómo-se-juega y el nick.
  //
  // El Archivo queda FUERA a propósito: tiene niveles internos (detalle →
  // filtro → cerrar) y gestiona su propia cadena con useHistoryChain. Si lo
  // incluyéramos aquí habría dos entradas fantasma compitiendo por la misma
  // pulsación.
  //
  // NicknameModal ya NO es la excepción que era: cuando era obligatorio (ni
  // scrim ni Escape lo cerraban) tampoco debía cerrarse con la atrás, y además
  // vivía fuera de `activeModal`. Ahora es un modal normal en el slot, así que
  // esta línea lo cubre — y por eso el componente NO monta su propio trap.
  useHistoryClose(
    activeModal !== null && activeModal !== "garage",
    closeModal
  );

  // Day rollover: el usuario dejó la pestaña abierta cruzando medianoche.
  // El front muestra los datos de "ayer" pero el server ya valida contra
  // el coche de "hoy" — un nuevo intento devolvería respuestas raras y
  // rompería la sensación de partida. El modal pide recargar (no lo hacemos
  // automáticamente para no descartar input no enviado del usuario, p.ej.
  // un guess a medio escribir).
  const staleDay = useDayRollover();

  const {
    car,
    isLoading,
    initError,
    retryInit,
    isSubmitting,
    guesses,
    pendingGuess,
    justRevealedIndex,
    attempts,
    status,
    zoom,
    hintIndex,
    totalHints,
    score,
    maxAttempts,
    submitGuess,
    buildShareText,
  } = useGame();

  // Cuando una partida termina, /api/validate-guess persiste el resultado y
  // record_daily_result_v2 devuelve el currentStreak ya actualizado. Lo
  // recibimos vía `score` (de useGame) y lo aplicamos al header al instante,
  // sin un refetch extra a Supabase.
  // Solo actuamos si:
  //   - score viene de un POST persistido (score.persisted),
  //   - currentStreak está presente (puede ser 0 si perdió y se cortó).
  //
  // Ya NO se exige `user`. Desde las sesiones anónimas, el jugador sin cuenta
  // TAMBIÉN tiene racha: su partida se persiste con el JWT anónimo y
  // record_daily_result_v2 le devuelve su currentStreak como a cualquiera. Es
  // justo la cifra que el final de partida necesita para poder decirle «no
  // pierdas tu racha de N días» en vez de un genérico «guarda tu progreso».
  // `score.persisted` ya garantiza que hubo escritura real en servidor, así
  // que sirve de gate por sí solo.
  useEffect(() => {
    if (score?.persisted && typeof score.currentStreak === "number") {
      setStreak(score.currentStreak);
      // El puesto SÍ sigue siendo cosa de cuentas reales: un anónimo no sale en
      // la tabla (sin display_name), así que preguntar por su puesto es un viaje
      // para un null garantizado.
      //
      // El resultado persistido cambia mis puntos de la temporada → mi puesto
      // puede haber subido. Refrescamos la píldora de estado. Solo aplicamos si
      // llega un puesto real: así un fallo transitorio (null) NO borra el valor
      // bueno que ya tenía la píldora (evita el parpadeo "tengo puesto → nada").
      if (user) {
        getMySeasonRank(user.id).then((next) => {
          if (next) setRank(next);
        });
      }
    }
  }, [user, score?.persisted, score?.currentStreak]);

  // Reset del gate de revelado al volver a "playing" (nueva partida sin
  // recargar, p.ej. tras day-rollover si algún día lo hiciéramos sin reload).
  // Mantiene la coherencia: el scroll automático solo debe ocurrir una vez
  // por partida terminada.
  useEffect(() => {
    if (status === "playing") setRevealReady(false);
  }, [status]);

  const dataReady = !isLoading && !!car;

  // El cartel de "edición no disponible" solo cuando NO hay nada que enseñar.
  // Si el snapshot local trajo la partida de hoy, `car` existe y preferimos
  // pintar esa aunque el servidor no conteste: la fuente de verdad sigue siendo
  // el servidor, pero enseñar la partida cacheada es mejor que un cartel de
  // error sobre una pantalla que el usuario ya tenía resuelta.
  const showLoadError = !!initError && !car;

  // Preload del daily-image en cuanto conocemos la URL. CarImage va a
  // renderizar su <picture> en el mismo ciclo, así que la ganancia neta
  // es de pocos ms — pero el navegador trata `<link rel=preload>` con
  // prioridad alta desde el primer byte, así que el fetch arranca antes
  // de pasar por el reconciliador de React. Imagesrcset/imagesizes deben
  // coincidir EXACTAMENTE con los del <picture> de CarImage para que el
  // browser reuse el resource cuando CarImage monte (si difieren, doble
  // descarga). El AVIF es el path feliz; navegadores antiguos ignorarán
  // el preload AVIF y caerán al img JPEG fallback de CarImage sin
  // penalización.
  useEffect(() => {
    if (!car?.img) return;
    if (typeof document === "undefined") return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.type = "image/avif";
    // En nativo el preload debe apuntar al dominio de producción (igual que
    // CarImage), o el navegador descarga una URL que no existe en localhost.
    const preBase = apiUrl(car.img);
    link.imageSrcset = `${preBase}&f=avif&w=640 640w, ${preBase}&f=avif&w=1280 1280w, ${preBase}&f=avif&w=1920 1920w`;
    link.imageSizes = "(max-width: 480px) 200vw, (max-width: 1280px) 1280px, 1920px";
    link.fetchPriority = "high";
    document.head.appendChild(link);
    return () => {
      try {
        document.head.removeChild(link);
      } catch {
        // El link puede haber desaparecido si React limpió el head
        // (hot-reload, navegación rara). No es crítico.
      }
    };
  }, [car?.img]);

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Pantalla de juego rediseñada ("configurador premium", dir. Platino).
          Encapsula header, intro, escenario con HUD, intentos, formulario y el
          revelado cinematográfico. La lógica vive en useGame y llega por props.
          Los modales (login, ranking, garaje, perfil, day-rollover) siguen
          siendo overlays globales gestionados aquí abajo. */}
      <Configurator
        dataReady={dataReady}
        loadError={showLoadError ? initError : null}
        onRetryLoad={retryInit}
        isRetryingLoad={isLoading}
        car={car}
        status={status}
        zoom={zoom}
        hintIndex={hintIndex}
        totalHints={totalHints}
        guesses={guesses}
        pendingGuess={pendingGuess}
        justRevealedIndex={justRevealedIndex}
        attempts={attempts}
        maxAttempts={maxAttempts}
        tolerance={2}
        isSubmitting={isSubmitting}
        submitGuess={submitGuess}
        streak={streak}
        rank={rank}
        // La faja de clasificación necesita distinguir "aún no sé tu puesto" de
        // "no tienes puesto": sin esto, un jugador rankeado veía medio segundo
        // la invitación de «gana hoy y entras en la tabla» antes de que llegara
        // su cifra — mentira y salto de altura. `checkingProfile` nace en true,
        // así que el primer paint ya cae del lado prudente.
        rankCargando={checkingProfile}
        user={user}
        // Al ganar, el EndScreen ofrece elegir firma si aún no la tiene: es el
        // único momento en que el nick le sirve para algo inmediato (su
        // resultado entra en la tabla de hoy).
        necesitaNick={necesitaNick}
        onOpenNickname={openNickname}
        repescaAlert={repescaAlert}
        shareText={buildShareText(streak)}
        revealReady={revealReady}
        onRevealLoad={handleRevealLoad}
        onOpenProfile={openProfile}
        onOpenLogin={openLogin}
        onOpenRanking={openRanking}
        onOpenGarage={openGarage}
        onOpenHowTo={openHowTo}
        howtoPulse={howtoPulse}
      />


      <LoginModal
        open={activeModal === "login"}
        onClose={() => { setAvisoLogin(null); closeModal(); }}
        aviso={avisoLogin}
      />

      {/* Modales lazy: solo se montan tras su primera apertura (mounted.*) y,
          una vez montados, permanecen para conservar la animación de salida.
          Cada uno lleva su PROPIO <Suspense> a propósito (no uno compartido):
          si un modal lazy aún no tiene su chunk en caché, suspende mientras
          descarga. Con un Suspense compartido, esa suspensión reemplazaba por
          `fallback={null}` a TODOS los modales del boundary —incluido el
          Garaje, que estuviera a media animación de salida—. Al arrancar el
          Garaje del árbol en pleno exit, framer-motion (AnimatePresence) perdía
          el control de la salida y dejaba su backdrop `bg-black/85` colgado y
          opaco encima de todo, capturando los clics → la página parecía
          congelada y había que recargar (caso típico: abrir "Logros" desde el
          Garaje, que cierra el Garaje y monta el modal lazy a la vez).
          Aislando el Suspense por modal, la suspensión de uno nunca desmonta a
          otro: el Garaje completa su salida limpiamente. */}
      {mounted.ranking && (
        <Suspense fallback={null}>
          <Ranking
            open={activeModal === "ranking"}
            onClose={closeModal}
            user={user}
            onOpenLogin={openLogin}
            // Aquí es donde el nick significa algo: sin firma no se sale en la
            // tabla. Se ofrece dentro del ranking, no como puerta para entrar.
            necesitaNick={necesitaNick}
            onOpenNickname={() => openNickname("ranking")}
          />
        </Suspense>
      )}

      {mounted.garage && (
        <Suspense fallback={null}>
          <Garage
            open={activeModal === "garage"}
            onClose={closeModal}
            user={user}
            onOpenLogin={openLogin}
            onOpenAchievements={openAchievements}
          />
        </Suspense>
      )}

      {mounted.profile && (
        <Suspense fallback={null}>
          <MyStats
            open={activeModal === "profile"}
            onClose={closeModal}
            onSignedOut={handleSignedOut}
            onOpenAchievements={openAchievements}
            onOpenGarage={openGarage}
            onOpenRanking={openRanking}
            // El candado junto al nick pasa a ser un botón: ya se puede cambiar.
            onOpenNickname={() => openNickname("profile")}
          />
        </Suspense>
      )}

      {mounted.achievements && (
        <Suspense fallback={null}>
          <AchievementsModal
            open={activeModal === "achievements"}
            onClose={closeModal}
          />
        </Suspense>
      )}

      {mounted.nickname && (
        <Suspense fallback={null}>
          <NicknameModal
            open={activeModal === "nickname"}
            valorActual={profile?.display_name ?? null}
            onClose={closeModal}
            onSaved={(nextProfile) => {
              setProfile(nextProfile);
              // Devolvemos al jugador de donde venía (la clasificación, casi
              // siempre): guardó la firma PARA ver algo, no por el gusto de
              // rellenar un formulario.
              if (nickVolverA) {
                const destino = nickVolverA;
                setNickVolverA(null);
                openModal(destino);
              } else {
                setActiveModal(null);
              }
            }}
          />
        </Suspense>
      )}

      {mounted.howto && (
        <Suspense fallback={null}>
          <HowToPlayModal open={activeModal === "howto"} onClose={closeModal} />
        </Suspense>
      )}

      {/* Day rollover: no dismissable por backdrop ni por ESC. Lo único
          que puede hacer el usuario es recargar la página. Si dejamos
          cerrar el modal, seguiría jugando con el coche de ayer y todos
          los intentos darían respuesta inconsistente. */}
      <ModalShell
        open={staleDay}
        onClose={() => {}}
        dismissOnBackdrop={false}
        backdropClassName="modal-scrim fixed inset-0 z-[110] flex items-center justify-center p-4"
        panelClassName="modal-panel-flat relative w-full max-w-sm p-6"
      >
        {/* Sello de "edición caducada", esquina superior derecha. Sustituye al
            emoji 🚗 dentro de un disco de acento que había aquí: era el único
            modal que no llegó a migrar al sistema pm-, así que arrastraba a la
            vez el emoji (que cada SO dibuja a su manera y a su tamaño) y el
            lenguaje del tema neón anterior. El sello dice lo mismo sin dibujar
            un coche, y `sellar` le da el golpe de muñeca al estampar. */}
        <div className="absolute -top-2 right-4 animate-sellar">
          <span className="pm-sello" aria-hidden="true">
            {t("app.dayRolloverStamp")}
          </span>
        </div>

        <p className="pm-kicker">{t("app.dayRolloverKicker")}</p>
        <h2 className="pm-title mt-1.5">{t("app.dayRolloverTitle")}</h2>
        <p className="pm-body mt-2.5">{t("app.dayRolloverBody")}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="pm-btn mt-6"
        >
          {t("app.dayRolloverButton")}
        </button>
      </ModalShell>
    </div>
  );
}
