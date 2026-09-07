// @vitest-environment jsdom
//
// src/App.smoke.test.jsx
// EL COMPONENTE QUE SOSTIENE LA APP, MONTADO UNA VEZ.
//
// POR QUÉ EXISTE, con fecha y todo: el 8 de septiembre de 2026 salió a
// producción un `useEffect` colocado ARRIBA del fichero que leía `status`, una
// const desestructurada de `useGame` más abajo. El array de dependencias se
// evalúa durante el render, así que tocaba la variable antes de su
// inicializador: `ReferenceError: Cannot access 'status' before initialization`
// en el PRIMER render, siempre, en web y en app. Lo que veía el jugador era
// «Algo falló en la rotativa» con la aplicación entera sin montar.
//
// Y lo que hay que aprender no es el descuido, es por dónde pasó: es un error
// de EJECUCIÓN, así que `npm run build` lo compila tan contento y el linter no
// tiene nada que decir. Con 72 suites y 813 pruebas, `App.jsx` —el fichero del
// que cuelga todo— era el único sin una sola. Desde que los cambios de app van
// directos a `main` sin PR (regla 13), esta suite es la ÚNICA red antes de
// producción; un agujero justo ahí es el agujero caro.
//
// QUÉ PRUEBA, Y QUÉ NO. No prueba el juego: para eso están las suites de
// useGame, del cupón y del layout. Prueba que App SE MONTA — que su cuerpo se
// ejecuta entero, con todos sus efectos, sin lanzar. Es una prueba de humo, y
// las pruebas de humo cazan exactamente esta familia: zonas muertas
// temporales, hooks fuera de orden, desestructuraciones de undefined.
//
// Por eso los mocks son de FRONTERA (red, Supabase, Capacitor) y los hijos
// pesados se sustituyen por sellos: lo que tiene que correr de verdad es el
// cuerpo de App, no lo que pinta.

import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const estadoJuego = {
  car: { img: "/api/daily-image?z=1", marca: null, modelo: null, anio: null },
  isLoading: false,
  initError: null,
  retryInit: vi.fn(),
  isSubmitting: false,
  guesses: [],
  pendingGuess: null,
  justRevealedIndex: -1,
  attempts: 0,
  status: "playing",
  zoom: 1,
  hintIndex: 0,
  totalHints: 5,
  score: null,
  maxAttempts: 5,
  submitGuess: vi.fn(),
  buildShareText: () => "",
};

async function montar(sobreescribe = {}) {
  vi.resetModules();

  // ── Fronteras ────────────────────────────────────────────────────────────
  // supabaseClient LANZA si faltan las envs, así que sin este mock no hay
  // prueba posible (y es justo lo que documenta la memoria del proyecto sobre
  // builds verdes que emiten bundles rotos).
  vi.doMock("./supabaseClient", () => ({
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  }));
  vi.doMock("./lib/analytics", () => ({ track: vi.fn(), plataforma: () => "web" }));
  vi.doMock("./lib/statsService", () => ({ getMySeasonRank: async () => null }));
  vi.doMock("./lib/sesionDiaria", () => ({ registrarSesionDiaria: vi.fn() }));
  vi.doMock("./lib/edicionApp", () => ({ comprobarAppInstalada: () => false }));
  vi.doMock("./lib/notifications", () => ({ isNative: () => false, rearmIfEnabled: vi.fn() }));

  // ── Los hooks de estado ──────────────────────────────────────────────────
  // Se mockean para que la prueba no dependa de la red ni del reloj, pero su
  // FORMA es la real: si algún día `useGame` deja de devolver `status`, esto
  // deja de parecerse a producción y hay que actualizarlo aquí.
  vi.doMock("./hooks/useGame", () => ({
    useGame: () => ({ ...estadoJuego, ...sobreescribe }),
  }));
  vi.doMock("./hooks/useAuthSession", () => ({
    useAuthSession: () => ({
      user: null, setUser: vi.fn(), profile: null, setProfile: vi.fn(),
      streak: 0, setStreak: vi.fn(), checkingProfile: false,
      necesitaNick: false, repescaAlert: false, setRepescaAlert: vi.fn(),
      rank: null, setRank: vi.fn(), handleSignedOut: vi.fn(),
    }),
  }));
  vi.doMock("./hooks/useDayRollover", () => ({ useDayRollover: () => false }));

  // ── Los hijos pesados, reducidos a un sello ──────────────────────────────
  // El escenario, la foto y el cupón tienen sus propias suites. Aquí solo
  // interesa que App llegue a pintarlos y con qué.
  vi.doMock("./components/configurator/Configurator", () => ({
    default: ({ status }) => <div data-testid="juego">{status}</div>,
  }));
  vi.doMock("./components/LoginModal", () => ({ default: () => null }));
  vi.doMock("./components/ModalShell", () => ({
    default: ({ open, children }) => (open ? <div>{children}</div> : null),
  }));
  vi.doMock("./i18n", () => ({
    useT: () => ({ t: (k) => k, tn: (k) => k, locale: "es" }),
  }));

  const { default: App } = await import("./App.jsx");
  return render(<App />);
}

describe("App se monta", () => {
  beforeEach(() => {
    // jsdom no trae matchMedia y algún camino de App/hijos lo consulta.
    if (!window.matchMedia) {
      window.matchMedia = () => ({
        matches: false, addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
      });
    }
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("renderiza sin lanzar (zona muerta temporal incluida)", async () => {
    // Cualquier excepción del cuerpo de App —una const leída antes de tiempo,
    // un hook mal ordenado— sale por aquí como un fallo del render.
    await montar();
    expect(screen.getByTestId("juego")).toBeDefined();
    expect(screen.getByTestId("juego").textContent).toBe("playing");
  });

  it("también con la partida terminada, que enciende otros efectos", async () => {
    // La rama que rompió: el prefetch del Archivo se dispara con la partida
    // cerrada, así que este caso ejecuta el efecto además de declararlo.
    await montar({ status: "won", attempts: 3, guesses: [] });
    expect(screen.getByTestId("juego").textContent).toBe("won");
  });
});
