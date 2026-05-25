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
import EditCarPanel from "./EditCarPanel";
import AddCarPanel from "./AddCarPanel";
import PreviewPanel from "./PreviewPanel";
import AnalyticsPanel from "./AnalyticsPanel";
import SwapCarModal from "./SwapCarModal";

const ADMIN_EMAILS = ["ievilaze@gmail.com"];

const TABS = [
  { id: "schedule", label: "Calendario" },
  { id: "edit", label: "Editar" },
  { id: "add", label: "Añadir" },
  { id: "preview", label: "Preview" },
  { id: "analytics", label: "Analítica" },
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
  const initial = readInitialState();
  const [tab, setTab] = useState(defaultTab || initial.tab);
  const [selectedCarId, setSelectedCarId] = useState(initial.selectedCarId);
  const [assignToDate, setAssignToDate] = useState(initial.assignToDate);
  const [refreshKey, setRefreshKey] = useState(0);

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

  // ---- Handlers de cross-tab navigation ----

  function goEditCar(carId) {
    setSelectedCarId(carId);
    setTab("edit");
  }

  function goPreviewCar(carId) {
    setSelectedCarId(carId);
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
    setRefreshKey((k) => k + 1);
  }

  function handleCarDeleted() {
    setSelectedCarId("");
    setRefreshKey((k) => k + 1);
  }

  function handleCancelAssign() {
    setAssignToDate(null);
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
            onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
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
      <div className="mx-auto w-full max-w-md px-4 pt-6">
        <header className="border-b border-border pb-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Admin
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-widest text-white">
            Herramientas
          </h1>
        </header>

        {/* Tabs */}
        <nav
          role="tablist"
          aria-label="Herramientas de administración"
          className="mt-4 grid grid-cols-4 gap-1 rounded-xl border border-border bg-bg-secondary/40 p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`
                  rounded-lg px-2 py-2 text-[11px] uppercase tracking-[0.14em]
                  transition
                  ${
                    active
                      ? "bg-accent text-bg-primary font-semibold"
                      : "text-muted hover:text-white"
                  }
                `}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <main className="py-6">
          {tab === "schedule" && (
            <SchedulePanel
              refreshKey={refreshKey}
              onEditCar={goEditCar}
              onSwapCar={openSwap}
            />
          )}
          {tab === "edit" && (
            <EditCarPanel
              selectedCarId={selectedCarId}
              onSelectCar={setSelectedCarId}
              onSaved={handleEditSaved}
              onDeleted={handleCarDeleted}
              onOpenPreview={goPreviewCar}
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
            />
          )}
          {tab === "analytics" && <AnalyticsPanel />}
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
