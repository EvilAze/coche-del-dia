// src/admin/AdminTools.jsx
// Shell unificado de las herramientas de administración. Sustituye a las
// rutas separadas /admin/edit-car, /admin/add-car y /preview por una sola
// página /admin-tools con 4 tabs (Calendario, Editar, Añadir, Preview).
//
// Responsabilidades de este componente:
//   1. Único gate de sesión + whitelist de email. Antes vivía duplicado en
//      cada panel.
//   2. Estado compartido entre tabs: tab activo, coche seleccionado,
//      fecha objetivo para asignación pendiente, contador de refresco
//      del calendario.
//   3. Aplicar noindex + título de pestaña (también centralizado).
//   4. Sincronizar el estado mínimo con la URL (?tab=…&id=…&date=…) para
//      que F5 no resetee el contexto del admin.

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import SchedulePanel from "./SchedulePanel";
import SeasonsPanel from "./SeasonsPanel";
import EditCarPanel from "./EditCarPanel";
import AddCarPanel from "./AddCarPanel";
import PreviewPanel from "./PreviewPanel";
import AnalyticsPanel from "./AnalyticsPanel";
import AuditPanel from "./AuditPanel";
import MensajesPanel from "./MensajesPanel";
import SwapCarModal from "./SwapCarModal";
import EstadoStrip from "./EstadoStrip";

const ADMIN_EMAILS = ["ievilaze@gmail.com"];

const TABS = [
  { id: "schedule", label: "Calendario" },
  { id: "seasons", label: "Temporadas" },
  { id: "edit", label: "Editar" },
  { id: "add", label: "Añadir" },
  { id: "preview", label: "Preview" },
  { id: "analytics", label: "Analítica" },
  { id: "audit", label: "Auditoría" },
  { id: "mensajes", label: "Buzón" },
];

function readInitialState() {
  if (typeof window === "undefined") {
    return { tab: "schedule", selectedCarId: "", assignToDate: null };
  }
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam : "schedule";
  return {
    tab,
    selectedCarId: params.get("id") || "",
    assignToDate: params.get("date") || null,
  };
}

function writeUrlState({ tab, selectedCarId, assignToDate }) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (tab && tab !== "schedule") params.set("tab", tab);
  if (selectedCarId) params.set("id", selectedCarId);
  if (assignToDate) params.set("date", assignToDate);
  const qs = params.toString();
  const next = `/admin-tools${qs ? `?${qs}` : ""}`;
  // replaceState para no inflar el historial cada vez que cambia el tab.
  window.history.replaceState(null, "", next);
}

export default function AdminTools({ defaultTab }) {
  // Inicializadores perezosos: `readInitialState()` lee y parsea la URL, y
  // llamándolo en el cuerpo del componente se ejecutaba en CADA render para
  // tirar el resultado a la basura — sólo cuenta en el primero. Con la forma
  // `useState(() => …)` React lo llama una vez y ya.
  const [tab, setTab] = useState(() => defaultTab || readInitialState().tab);
  const [selectedCarId, setSelectedCarId] = useState(
    () => readInitialState().selectedCarId
  );
  const [assignToDate, setAssignToDate] = useState(
    () => readInitialState().assignToDate
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewOverrides, setPreviewOverrides] = useState(null);
  // Mensajes pendientes. Vive en el shell porque lo pinta la PESTAÑA, y una
  // bandeja cuyo aviso solo se ve estando dentro de ella no avisa de nada.
  // Lo rellena MensajesPanel al cargar; hasta entonces no se pinta ningún
  // número, que es mejor que pintar un 0 que quizá sea mentira.
  const [sinLeer, setSinLeer] = useState(null);

  // Modal de swap (vive en el shell para poder navegar al tab Add al
  // pulsar "Crear coche nuevo").
  const [swapState, setSwapState] = useState({
    open: false,
    date: null,
    currentCarId: null,
  });

  // Sesión.
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // noindex + título.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Admin · Herramientas";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Persistencia de estado en URL.
  useEffect(() => {
    writeUrlState({ tab, selectedCarId, assignToDate });
  }, [tab, selectedCarId, assignToDate]);

  // Limpiar overrides si cambia el coche seleccionado.
  useEffect(() => {
    setPreviewOverrides(null);
  }, [selectedCarId]);

  // ---- Handlers de cross-tab navigation ----

  function goEditCar(carId) {
    setSelectedCarId(carId);
    setTab("edit");
  }

  function goPreviewCar(carId, overrides) {
    setSelectedCarId(carId);
    setPreviewOverrides(overrides ? { carId, ...overrides } : null);
    setTab("preview");
  }

  function openSwap(date, currentCarId) {
    setSwapState({ open: true, date, currentCarId });
  }

  function closeSwap() {
    setSwapState((s) => ({ ...s, open: false }));
  }

  function handleSwapped() {
    // Forzamos refetch del calendario para que la nueva asignación se vea.
    setRefreshKey((k) => k + 1);
  }

  function handleCreateNewForDate(date) {
    setSwapState({ open: false, date: null, currentCarId: null });
    setAssignToDate(date);
    setTab("add");
  }

  function handleAddSaved(_car, assignedDate) {
    // Si se asignó a una fecha, refresca el calendario y vuelve allí.
    if (assignedDate) {
      setAssignToDate(null);
      setRefreshKey((k) => k + 1);
      setTab("schedule");
    } else {
      // Alta libre: refrescamos por si el coche acaba en alguno de los
      // 7 días futuros vía pick_daily_car (improbable a corto plazo,
      // pero el coste es cero).
      setRefreshKey((k) => k + 1);
    }
  }

  function handleEditSaved() {
    setPreviewOverrides(null);
    setRefreshKey((k) => k + 1);
  }

  function handleFormChange(carId, overrides) {
    setPreviewOverrides(overrides ? { carId, ...overrides } : null);
  }

  function handleCarDeleted() {
    setSelectedCarId("");
    setRefreshKey((k) => k + 1);
  }

  function handleCancelAssign() {
    setAssignToDate(null);
  }

  // Flechas para moverse entre pestañas. No es un adorno: al marcar las
  // inactivas con tabIndex=-1 (lo que pide el patrón tablist, para que Tab
  // salte la barra entera en vez de recorrer ocho botones) el teclado se
  // quedaría sin forma de llegar a ellas. Home/End van a los extremos, y la
  // lista da la vuelta porque una barra de 8 con dos filas no tiene «final»
  // visual que justifique un tope.
  function handleTabKeyDown(e) {
    const salto =
      e.key === "ArrowRight" ? 1 :
      e.key === "ArrowLeft" ? -1 :
      0;
    let destino = null;
    if (salto !== 0) {
      const i = TABS.findIndex((t) => t.id === tab);
      destino = TABS[(i + salto + TABS.length) % TABS.length];
    } else if (e.key === "Home") {
      destino = TABS[0];
    } else if (e.key === "End") {
      destino = TABS[TABS.length - 1];
    }
    if (!destino) return;
    e.preventDefault();
    setTab(destino.id);
    // El foco tiene que seguir al tab activo o el siguiente flechazo sale del
    // botón que acaba de quedarse con tabIndex=-1.
    document.getElementById(`tab-${destino.id}`)?.focus();
  }

  // ---- Gates ----

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary font-body text-white">
        <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
          Comprobando sesión...
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-secondary p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Zona interna
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-widest text-white">
            Acceso restringido
          </h1>
          <p className="mt-3 text-sm text-muted">
            Inicia sesión con la cuenta de administrador.
          </p>
          <button
            onClick={() =>
              supabase.auth.signInWithOAuth({
                provider: "google",
                // Volver a /admin-tools tras el OAuth (con su ?tab=… si lo había),
                // no a la raíz. Requiere que esta URL esté en los "Redirect URLs"
                // de Supabase (típicamente ya cubierta por el wildcard del dominio).
                options: { redirectTo: window.location.href },
              })
            }
            className="mt-5 h-12 w-full rounded-xl bg-accent font-display text-lg tracking-widest text-bg-primary transition hover:bg-accent-dark active:scale-[0.98]"
          >
            Continuar con Google
          </button>
        </div>
      </div>
    );
  }

  const currentEmail = (session.user?.email ?? "").toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(currentEmail);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-red-400/40 bg-bg-secondary p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-red-400">
            403 · Sin permisos
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-widest text-white">
            No autorizado
          </h1>
          <p className="mt-3 text-sm text-muted">
            La cuenta <span className="text-white">{currentEmail || "actual"}</span>{" "}
            no tiene acceso a esta herramienta.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
            }}
            className="mt-5 h-12 w-full rounded-xl border border-white/10 bg-black/40 font-display text-lg tracking-widest text-white transition hover:border-accent active:scale-[0.98]"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  // ---- Render del shell ----

  return (
    <div className="min-h-screen bg-bg-primary font-body text-white">
      {/* ANCHO: antes era `max-w-md lg:max-w-4xl`, o sea 448 px fijos hasta los
          1024 px de viewport. Eso dejaba un salto enorme —una tablet, un móvil
          en horizontal o una ventana a media pantalla se quedaban con un
          carril de 448 px y el resto en blanco— y, sobre todo, apretaba en un
          móvil las tablas de 6 y 8 columnas de Analítica y Auditoría. Ahora el
          contenedor crece por tramos, y el padding se afloja con él: en el
          móvil manda `px-3`, que devuelve 8 px de ancho útil a las tablas. */}
      <div className="mx-auto w-full max-w-md px-3 pt-6 sm:max-w-2xl sm:px-4 lg:max-w-4xl xl:max-w-6xl">
        <header className="border-b border-border pb-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Admin
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-widest text-white">
            Herramientas
          </h1>
        </header>

        {/* Estado del juego. Va en el shell y no en una pestaña porque las tres
            cosas que vigila se rompen despacio y por olvido: un aviso que hay
            que ir a buscar llega el día después. Comparte refreshKey con el
            calendario, que es lo que mueve estas cifras. */}
        <EstadoStrip refreshKey={refreshKey} />

        {/* Tabs. 8 pestañas en 3 columnas son 3 filas de nada en un móvil; con
            4 caben en dos filas limpias. El salto a 8 se hace en `lg`, que es
            donde el contenedor ya mide 4xl y el rótulo entero cabe sin
            apretarse. */}
        <nav
          role="tablist"
          aria-label="Herramientas de administración"
          onKeyDown={handleTabKeyDown}
          className="mt-4 grid grid-cols-4 gap-1 rounded-xl border border-border bg-bg-secondary/40 p-1 lg:grid-cols-8"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            // El rótulo se aprieta en móvil y se suelta a partir de `sm`:
            // «Calendario» y «Temporadas» en versalitas con 0.14em de tracking
            // no caben en un cuarto de pantalla de 360 px. `truncate` es la
            // red: antes que desbordar la rejilla y descuadrar la barra
            // entera, que corte.
            return (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                // La mitad que faltaba del patrón ARIA: el `role="tablist"` ya
                // estaba, pero sin `aria-controls` ni un `tabpanel` al otro
                // lado un lector de pantalla anuncia «pestaña» y no sabe decir
                // qué región cambia al pulsarla. `tabIndex` deja fuera del
                // tabulador las pestañas no activas, que es como se recorre un
                // tablist (flechas dentro, Tab para salir).
                aria-selected={active}
                aria-controls="admin-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`
                  truncate rounded-lg px-1 py-2 text-[10px] uppercase
                  tracking-tight transition
                  sm:px-2 sm:text-[11px] sm:tracking-[0.14em]
                  ${
                    active
                      ? "bg-accent text-bg-primary font-semibold"
                      : "text-muted hover:text-white"
                  }
                `}
              >
                {t.label}
                {t.id === "mensajes" && sinLeer > 0 && (
                  <span className="ml-1 font-mono">({sinLeer})</span>
                )}
              </button>
            );
          })}
        </nav>

        <main
          id="admin-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={-1}
          className="py-6"
        >
          {tab === "schedule" && (
            <SchedulePanel
              refreshKey={refreshKey}
              onEditCar={goEditCar}
              onSwapCar={openSwap}
            />
          )}
          {tab === "seasons" && <SeasonsPanel />}
          {tab === "edit" && (
            <EditCarPanel
              selectedCarId={selectedCarId}
              onSelectCar={setSelectedCarId}
              onSaved={handleEditSaved}
              onDeleted={handleCarDeleted}
              onOpenPreview={goPreviewCar}
              overrides={previewOverrides}
              onFormChange={handleFormChange}
            />
          )}
          {tab === "add" && (
            <AddCarPanel
              assignToDate={assignToDate}
              onCancelAssign={handleCancelAssign}
              onSaved={handleAddSaved}
            />
          )}
          {tab === "preview" && (
            <PreviewPanel
              selectedCarId={selectedCarId}
              onSelectCar={setSelectedCarId}
              overrides={previewOverrides}
            />
          )}
          {tab === "analytics" && <AnalyticsPanel />}
          {tab === "audit" && <AuditPanel />}
          {tab === "mensajes" && <MensajesPanel onSinLeer={setSinLeer} />}
        </main>
      </div>

      <SwapCarModal
        open={swapState.open}
        date={swapState.date}
        currentCarId={swapState.currentCarId}
        onClose={closeSwap}
        onCreateNew={handleCreateNewForDate}
        onSwapped={handleSwapped}
      />
    </div>
  );
}
