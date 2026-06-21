// src/App.jsx
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

import Configurator from "./components/configurator/Configurator";
import CloseButton from "./components/CloseButton";
import LanguageStrip from "./components/LanguageStrip";
import ModalShell from "./components/ModalShell";
import { useToast } from "./components/Toast";
import { getMyMonthlyRank } from "./lib/statsService";
import { track } from "./lib/analytics";
import { signInWithGoogle } from "./lib/auth";
import { useGame } from "./hooks/useGame";
import { useAuthSession } from "./hooks/useAuthSession";
import { useModalState } from "./hooks/useModalState";
import { useEscape } from "./hooks/useEscape";
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
  const toast = useToast();
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
    mountModal,
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

  const openRanking = () => {
    // Medir cuánto se usa la "palanca" del ranking. Dos sumideros:
    //   1) Umami (track): visible en el dashboard de Umami (free tier).
    //   2) Contador propio en Supabase: lo lee el panel admin de Analítica.
    //      La API de Umami es de pago, así que el panel NO puede leer de ahí;
    //      en su lugar incrementamos una RPC SECURITY DEFINER (no requiere
    //      permiso de escritura del cliente, corre como owner). Misma
    //      convención `auth` que garage_open.
    const auth = user ? "user" : "anon";
    track("ranking_open", { auth });
    // Fire-and-forget: jamás bloquear ni romper la apertura del ranking.
    supabase
      .rpc("increment_feature_event", { p_event: "ranking_open", p_auth: auth })
      .then(undefined, () => {});
    openModal("ranking");
  };
  const openGarage = () => openModal("garage");
  const openProfile = () => openModal("profile");
  const openAchievements = () => openModal("achievements");

  // Login va por ModalShell inline (no lazy), no necesita mountModal.
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

  // NicknameModal se abre solo (onboarding) cuando un usuario logueado no
  // tiene nick. Como es lazy, lo marcamos para montar en cuanto esa condición
  // se cumple.
  const nicknameOpen = Boolean(user && !checkingProfile && !profile?.display_name);
  useEffect(() => {
    if (nicknameOpen) mountModal("nickname");
  }, [nicknameOpen, mountModal]);

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
  //   - hay usuario logueado (los anónimos no tienen streak),
  //   - score viene de un POST persistido (score.persisted),
  //   - currentStreak está presente (puede ser 0 si perdió y se cortó).
  useEffect(() => {
    if (!user) return;
    if (score?.persisted && typeof score.currentStreak === "number") {
      setStreak(score.currentStreak);
      // El resultado persistido también cambia mis puntos del mes → mi puesto
      // puede haber subido. Refrescamos la píldora de estado. Solo aplicamos si
      // llega un puesto real: así un fallo transitorio (null) NO borra el valor
      // bueno que ya tenía la píldora (evita el parpadeo "tengo puesto → nada").
      getMyMonthlyRank(user.id).then((next) => {
        if (next) setRank(next);
      });
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
        user={user}
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


      <ModalShell
        open={activeModal === "login"}
        onClose={closeModal}
        backdropClassName="modal-scrim fixed inset-0 z-[100] flex items-center justify-center p-4"
        panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center"
      >
        <div className="absolute right-4 top-4 z-10">
          <CloseButton onClick={closeModal} />
        </div>

        <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
          {t("app.loginModalTitle")}
        </h2>
        <p className="mb-8 text-sm text-muted">
          {t("app.loginModalDescription")}
        </p>

        <button
          onClick={async () => {
            // En nativo (app) el login va por plugin; si falla (p.ej. falta
            // VITE_GOOGLE_WEB_CLIENT_ID o el usuario cancela con error), damos
            // feedback visible en vez de "no pasa nada". En web, signInWithOAuth
            // redirige y el error path no se alcanza normalmente.
            const { error } = (await signInWithGoogle()) || {};
            if (error) toast.push(t("app.loginError"), { type: "error" });
          }}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-black transition-transform hover:scale-105 active:scale-95"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          {t("common.continueWithGoogle")}
        </button>

        {/* Selector de idioma para usuarios anónimos. Antes vivía en el
            popover del header; al quitarlo, este modal (al que llega el
            anónimo desde el icono de perfil) es su nuevo hogar. */}
        <div className="mt-6 border-t border-border pt-4 text-left">
          <LanguageStrip />
        </div>
      </ModalShell>

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
            open={nicknameOpen}
            onSaved={(nextProfile) => {
              setProfile(nextProfile);
              setActiveModal(null);
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
        panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center ring-1 ring-accent/40"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-2xl">
          🚗
        </div>
        <h2 className="font-display text-xl tracking-widest text-accent">
          {t("app.dayRolloverTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t("app.dayRolloverBody")}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="
            mt-5 w-full rounded-lg bg-accent px-4 py-3
            font-display text-base tracking-widest text-bg-primary
            transition-transform hover:scale-[1.02] active:scale-[0.98]
          "
        >
          {t("app.dayRolloverButton")}
        </button>
      </ModalShell>
    </div>
  );
}
