// src/App.jsx
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { getMyProfile, getMyStreak } from "./hooks/useStats";

import CarImage from "./components/CarImage";
import GuessLog from "./components/GuessLog";
import GuessForm from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import Header from "./components/HeaderSandwich";
import CloseButton from "./components/CloseButton";

// Modales lazy: viven todos detrás de un clic, así que NO entran en el bundle
// inicial. Se descargan la primera vez que se abren y, una vez montados, se
// mantienen (ver `mounted` más abajo) para que las animaciones de salida de
// ModalShell/AnimatePresence sigan funcionando.
const Ranking = lazy(() => import("./components/Ranking"));
const Garage = lazy(() => import("./components/Garage"));
const MyStats = lazy(() => import("./components/MyStats"));
const AchievementsModal = lazy(() => import("./components/AchievementsModal"));
const NicknameModal = lazy(() => import("./components/NicknameModal"));
import LanguageStrip from "./components/LanguageStrip";
import ModalShell from "./components/ModalShell";
import { useGame } from "./hooks/useGame";
import { useEscape } from "./hooks/useEscape";
import { useDayRollover } from "./hooks/useDayRollover";
import { useT } from "./i18n";

function LockedRevealCard() {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-accent/40 bg-bg-primary/85 p-4
        text-center shadow-xl shadow-black/50 backdrop-blur-md
        animate-fade-in
      "
    >
      <div className="mb-1 flex items-center justify-center gap-2 text-accent">
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span className="font-display text-xs uppercase tracking-[0.18em]">
          {t("app.lockedCar")}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-snug text-white/90">
        {t("app.lockedCarDescription")}
      </p>

      <button
        type="button"
        onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
        className="
          mt-3 flex w-full items-center justify-center gap-2
          rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black
          transition-transform hover:scale-[1.02] active:scale-[0.98]
        "
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        {t("common.continueWithGoogle")}
      </button>
    </div>
  );
}

export default function App() {
  const { t, dateLocale } = useT();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [activeModal, setActiveModal] = useState(null);
  // Modales lazy ya montados al menos una vez. Una vez montado, un modal
  // permanece en el árbol para que su animación de salida (AnimatePresence)
  // pueda completarse al cerrarse.
  const [mounted, setMounted] = useState({});
  const mountModal = useCallback((key) => {
    setMounted((m) => (m[key] ? m : { ...m, [key]: true }));
  }, []);
  // Badge ámbar del icono del Garaje: true cuando hay repesca disponible
  // hoy y al menos un coche "missed" (ya fue coche del día y no se ganó).
  // Lo calculamos con una llamada ligera a /api/garage tras login.
  const [repescaAlert, setRepescaAlert] = useState(false);
  // Racha actual del usuario logueado, visible como badge del header.
  // 0 (o null si anónimo) = no se pinta el badge. Se sincroniza en dos
  // momentos: (1) al hacer login, leemos de Supabase; (2) cuando una
  // partida acaba, el score que devuelve useGame ya incluye el nuevo
  // currentStreak — lo aplicamos sin refetch.
  const [streak, setStreak] = useState(0);
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
        setActiveModal(null);
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

  function openRanking() {
    mountModal("ranking");
    setActiveModal("ranking");
  }

  function openGarage() {
    mountModal("garage");
    setActiveModal("garage");
  }

  function openProfile() {
    mountModal("profile");
    setActiveModal("profile");
  }

  function openAchievements() {
    mountModal("achievements");
    setActiveModal("achievements");
  }

  // Login va por ModalShell inline (no lazy), no necesita mountModal.
  function openLogin() {
    setActiveModal("login");
  }

  function closeModal() {
    setActiveModal(null);
  }

  function handleSignedOut() {
    setUser(null);
    setProfile(null);
    setCheckingProfile(false);
    setActiveModal(null);
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
    }
  }, [user, score?.persisted, score?.currentStreak]);

  // Reset del gate de revelado al volver a "playing" (nueva partida sin
  // recargar, p.ej. tras day-rollover si algún día lo hiciéramos sin reload).
  // Mantiene la coherencia: el scroll automático solo debe ocurrir una vez
  // por partida terminada.
  useEffect(() => {
    if (status === "playing") setRevealReady(false);
  }, [status]);

  const today = new Date().toLocaleDateString(dateLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const dataReady = !isLoading && !!car;

  // Preload del daily-image en cuanto conocemos la URL. CarImage va a
  // renderizar su <picture> en el mismo ciclo, así que la ganancia neta
  // es de pocos ms — pero el navegador trata `<link rel=preload>` con
  // prioridad alta desde el primer byte, así que el fetch arranca antes
  // de pasar por el reconciliador de React. Imagesrcset/imagesizes deben
  // coincidir EXACTAMENTE con los del <picture> de CarImage para que el
  // browser reuse el resource cuando CarImage monte (si difieren, doble
  // descarga). El AVIF es el path feliz; navegadores antiguos ignorarán
  // el preload AVIF y caerán al <img> JPEG fallback de CarImage sin
  // penalización.
  useEffect(() => {
    if (!car?.img) return;
    if (typeof document === "undefined") return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.type = "image/avif";
    link.imageSrcset = `${car.img}&f=avif&w=640 640w, ${car.img}&f=avif&w=1280 1280w, ${car.img}&f=avif&w=1920 1920w`;
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
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-bg-primary font-body text-white">


      <Header
        user={user}
        onOpenRanking={openRanking}
        onOpenGarage={openGarage}
        onOpenProfile={openProfile}
        onOpenLogin={openLogin}
        repescaAlert={repescaAlert}
        streak={streak}
      />

      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-3 pb-10 pt-4 sm:px-4">
        <main className="w-full min-w-0">
          {/* Dateline: la fecha del reto, centrada sobre la imagen. Vive aquí
              (no en el header) para aligerar la cabecera y dar contexto justo
              donde está el coche a adivinar. */}
          <p className="mb-3 text-center text-[10px] uppercase tracking-[0.28em] text-muted">
            {today}
          </p>

          {/* CarImage siempre montado: cuando car es null, internamente cae
              al skeleton (animate-pulse sobre bg-bg-secondary/60) con el
              mismo aspect-ratio 1:1 y borde que tendrá la imagen final.
              Cuando car llega, src cambia y el LQIP base64 entra como
              fondo blureado, luego el AVIF crossfade encima. Cero overlay
              que ocultar y cero tiempo muerto entre estados. */}
          <CarImage
            src={car?.img ?? null}
            blurData={car?.blurData ?? null}
            zoom={zoom}
            hintIndex={hintIndex}
            totalHints={totalHints}
            status={status}
            showHintLabel={false}
            blurred={status === "lost" && !user}
            onRevealLoad={handleRevealLoad}
            overlay={
              status === "lost" && !user ? (
                <LockedRevealCard />
              ) : null
            }
          />

          {/* Sin leyenda ✓/✕: son símbolos universalmente reconocibles. Toda
              ayuda textual aquí es ruido para un juego diario rápido. La
              imagen sirve de pista visual implícita (más zoom out por intento). */}


          {/* Todo el bloque bajo la imagen (filas de intentos + separador +
              formulario/resultado) entra como una sola unidad con un
              fade-in suave cuando llega la data. El `key="content"` fuerza
              el remount del wrapper al pasar de !dataReady → dataReady,
              así la animación de entrada se dispara una sola vez. La
              imagen va aparte: tiene su propio crossfade LQIP → AVIF.

              Gateado por dataReady para evitar:
              (a) Renderizar ResultPanel con car=null y pinchar al leer
                  car.marca durante el loading inicial de un usuario
                  logueado que ya cerró la partida.
              (b) Flash de GuessForm "playing" antes de que llegue el
                  estado real del server. */}
          {dataReady ? (
            <div key="content" className="animate-fade-in">
              <GuessLog
                guesses={guesses}
                pendingGuess={pendingGuess}
                justRevealedIndex={justRevealedIndex}
                attempts={attempts}
                maxAttempts={maxAttempts}
              />

              {(guesses.length > 0 || pendingGuess) && (
                <div className="my-4 h-px bg-border" />
              )}

              {status === "playing" ? (
                <GuessForm
                  onSubmit={submitGuess}
                  isSubmitting={isSubmitting}
                  guesses={guesses}
                />
              ) : (
                <ResultPanel
                  status={status}
                  car={car}
                  attempts={attempts}
                  maxAttempts={maxAttempts}
                  shareText={buildShareText(streak)}
                  guesses={guesses}
                  streak={streak}
                  score={score}
                  user={user}
                  onOpenLogin={openLogin}
                  revealReady={revealReady}
                />
              )}
            </div>
          ) : (
            // Reserva visual mientras llega el estado de la partida:
            // misma altura aprox que GuessForm (3 inputs + botón) para
            // que no haya CLS cuando el contenido real entra. Vacío a
            // propósito — el skeleton del recuadro de imagen ya da
            // suficiente señal de "cargando", duplicarla aquí ensucia.
            <div className="min-h-[12.5rem]" aria-hidden="true" />
          )}
        </main>

        {/* Footer mínimo con enlace a Política de Privacidad. Necesario
            para la verificación de la pantalla de consentimiento de
            Google OAuth — exige que la home enlace explícitamente al
            documento legal. Lo dejamos discreto para no romper el juego
            pero perfectamente visible y rastreable. */}
        <footer className="mt-8 flex flex-col items-center gap-2 border-t border-border/60 pt-4 pb-2 text-[10px] uppercase tracking-[0.22em] text-muted">
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a
              href="/privacidad"
              className="transition-colors hover:text-accent"
            >
              {t("app.footerPrivacy")}
            </a>
          </nav>
          <p className="text-[9px] tracking-[0.18em] text-muted/70">
            © {new Date().getFullYear()} El Coche del Día
          </p>
        </footer>
      </div>

      <ModalShell
        open={activeModal === "login"}
        onClose={closeModal}
        backdropClassName="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        panelClassName="relative w-full max-w-sm rounded-2xl border border-border bg-bg-primary p-6 text-center shadow-2xl"
      >
        <div className="absolute right-2 top-2">
          <CloseButton onClick={closeModal} />
        </div>

        <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
          {t("app.loginModalTitle")}
        </h2>
        <p className="mb-8 text-sm text-muted">
          {t("app.loginModalDescription")}
        </p>

        <button
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
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
          Un único Suspense (fallback null) cubre el lapso de descarga del
          chunk en la primera apertura. */}
      <Suspense fallback={null}>
        {mounted.ranking && (
          <Ranking
            open={activeModal === "ranking"}
            onClose={closeModal}
            user={user}
            onOpenLogin={openLogin}
          />
        )}

        {mounted.garage && (
          <Garage
            open={activeModal === "garage"}
            onClose={closeModal}
            user={user}
            onOpenLogin={openLogin}
            onOpenAchievements={openAchievements}
          />
        )}

        {mounted.profile && (
          <MyStats
            open={activeModal === "profile"}
            onClose={closeModal}
            onSignedOut={handleSignedOut}
            onOpenAchievements={openAchievements}
          />
        )}

        {mounted.achievements && (
          <AchievementsModal
            open={activeModal === "achievements"}
            onClose={closeModal}
          />
        )}

        {mounted.nickname && (
          <NicknameModal
            open={nicknameOpen}
            onSaved={(nextProfile) => {
              setProfile(nextProfile);
              setActiveModal(null);
            }}
          />
        )}
      </Suspense>

      {/* Day rollover: no dismissable por backdrop ni por ESC. Lo único
          que puede hacer el usuario es recargar la página. Si dejamos
          cerrar el modal, seguiría jugando con el coche de ayer y todos
          los intentos darían respuesta inconsistente. */}
      <ModalShell
        open={staleDay}
        onClose={() => {}}
        dismissOnBackdrop={false}
        backdropClassName="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        panelClassName="relative w-full max-w-sm rounded-2xl border border-accent/40 bg-bg-primary p-6 text-center shadow-2xl"
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
