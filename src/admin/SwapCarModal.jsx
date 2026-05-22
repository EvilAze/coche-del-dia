// src/admin/SwapCarModal.jsx
// Modal del calendario para reemplazar el coche asignado a una fecha
// futura. Dos vías:
//   1. Elegir un coche existente del catálogo → POST /api/admin/schedule
//      con date+car_id. El backend libera la fecha anterior del coche si
//      la tenía y rechaza si el coche ya salió en el pasado.
//   2. Crear uno nuevo → onCreateNew(date) hace que AdminTools cambie al
//      tab Añadir con assignToDate=date. Al guardar allí, se asignará
//      automáticamente.

import { useEffect, useMemo, useState } from "react";
import ModalShell from "../components/ModalShell";
import CloseButton from "../components/CloseButton";
import { supabase } from "../supabaseClient";
import { useCatalog } from "../data/catalog";

export default function SwapCarModal({
  open,
  date,
  currentCarId,
  onClose,
  onCreateNew,
  onSwapped,
}) {
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];

  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(null); // id del coche siendo enviado

  // Resetea estado al abrir/cerrar.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      setIsSubmitting(false);
      setPicking(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = [...CARS]
      .filter((c) => String(c.id) !== String(currentCarId))
      .sort((a, b) =>
        `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`)
      );
    if (!q) return base;
    return base.filter((c) =>
      `${c.marca} ${c.modelo} ${c.anio}`.toLowerCase().includes(q)
    );
  }, [CARS, query, currentCarId]);

  async function handlePick(carId) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setPicking(carId);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");
      const res = await fetch("/api/admin/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ date, car_id: carId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      if (typeof onSwapped === "function") onSwapped(date, body.car);
      onClose();
    } catch (err) {
      console.error("[SwapCarModal] swap:", err);
      setError(err?.message || "No se pudo cambiar el coche.");
    } finally {
      setIsSubmitting(false);
      setPicking(null);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      backdropClassName="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-sm"
      panelClassName="relative flex w-full max-w-md max-h-[90vh] flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-bg-primary shadow-2xl"
    >
      <div className="absolute right-2 top-2 z-10">
        <CloseButton onClick={onClose} disabled={isSubmitting} />
      </div>

      <header className="border-b border-border px-5 py-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
          Cambiar coche del día
        </p>
        <h2 className="mt-1 font-display text-xl tracking-widest text-white">
          {date}
        </h2>
      </header>

      <div className="border-b border-border px-5 py-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar marca, modelo o año..."
          disabled={isSubmitting}
          className="
            h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3
            text-sm text-white outline-none placeholder:text-white/30
            focus:border-accent disabled:cursor-not-allowed disabled:opacity-50
          "
        />
      </div>

      <ul className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <li className="px-2 py-6 text-center text-xs uppercase tracking-widest text-muted">
            {query ? "Ningún coche encaja con la búsqueda" : "Catálogo vacío"}
          </li>
        ) : (
          filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handlePick(c.id)}
                className="
                  flex w-full items-center justify-between gap-3 rounded-lg
                  px-2 py-2.5 text-left transition
                  hover:bg-white/5
                  disabled:cursor-not-allowed disabled:opacity-50
                "
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">
                    {c.marca} {c.modelo}
                  </p>
                  <p className="text-[11px] uppercase tracking-widest text-muted">
                    {c.anio} · {c.pais}
                  </p>
                </div>
                {picking === c.id && (
                  <span className="text-[10px] uppercase tracking-widest text-accent">
                    Asignando…
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      {error && (
        <div
          role="alert"
          className="mx-3 mb-2 rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => typeof onCreateNew === "function" && onCreateNew(date)}
          className="
            w-full rounded-xl border border-accent/40 bg-accent/10 px-4 py-3
            text-sm font-semibold uppercase tracking-[0.18em] text-accent
            transition hover:border-accent hover:bg-accent/20
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          + Crear coche nuevo
        </button>
      </footer>
    </ModalShell>
  );
}
