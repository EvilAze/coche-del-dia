// src/admin/SchedulePanel.jsx
// Panel del calendario admin: 14 días empezando por hoy, mostrando qué
// coche está programado cada día y permitiendo editar o hacer swap.
//
// Pide /api/admin/schedule (GET) en cada montaje y cuando refreshKey
// cambia (el shell lo incrementa tras guardar en Edit/Add o tras un swap).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const WEEKDAY_FMT = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  timeZone: "Europe/Madrid",
});
const DATE_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Madrid",
});

function formatDate(yyyyMmDd) {
  // Construimos el Date a mediodía UTC para evitar que el TZ pase la
  // fecha al día anterior en Madrid (offset +1/+2).
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: WEEKDAY_FMT.format(dt),
    short: DATE_FMT.format(dt),
  };
}

export default function SchedulePanel({
  refreshKey = 0,
  onEditCar,
  onSwapCar,
}) {
  const [days, setDays] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [randomizing, setRandomizing] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Sin sesión");
        const res = await fetch("/api/admin/schedule", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setDays(Array.isArray(body.days) ? body.days : []);
        setToday(body.today || null);
      } catch (err) {
        if (!cancelled) {
          console.error("[SchedulePanel] fetch:", err);
          setError(err?.message || "No se pudo cargar el calendario.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefresh]);

  const items = useMemo(
    () =>
      days.map((d, idx) => ({
        ...d,
        ...formatDate(d.date),
        isToday: d.date === today,
        offset: idx,
      })),
    [days, today]
  );

  async function handleRandomize() {
    const ok = window.confirm(
      "¿Seguro que quieres aleatorizar los coches de los próximos 6 días? Esto reemplazará cualquier coche programado para el futuro."
    );
    if (!ok) return;

    setRandomizing(true);
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
        body: JSON.stringify({ randomize: true }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      setLocalRefresh((prev) => prev + 1);
    } catch (err) {
      console.error("[SchedulePanel] randomize:", err);
      setError(err?.message || "No se pudo aleatorizar el calendario.");
    } finally {
      setRandomizing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">
          Calendario (14 días)
        </h2>
        <p className="mt-1 text-xs text-muted">
          Los coches futuros ya están fijados — el orden aleatorio no cambia
          al previsualizar. Edita lo que necesites o haz swap.
        </p>
      </header>

      <button
        type="button"
        onClick={handleRandomize}
        disabled={loading || randomizing}
        className="
          w-full rounded-xl border border-accent/40 bg-accent/5 px-4 py-3
          text-sm font-semibold uppercase tracking-[0.18em] text-accent
          transition hover:border-accent hover:bg-accent/10
          disabled:cursor-not-allowed disabled:opacity-40
          flex items-center justify-center gap-2
        "
      >
        {randomizing ? "🎲 Aleatorizando..." : "🎲 Aleatorizar próximos 6 días"}
      </button>

      {loading && (
        <p className="animate-pulse text-xs uppercase tracking-widest text-muted">
          Cargando calendario...
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.date}
              className={`overflow-hidden rounded-2xl border ${
                item.isToday
                  ? "border-accent/60 bg-accent/5"
                  : "border-border bg-bg-secondary/40"
              }`}
            >
              <div className="flex gap-3 p-3">
                {/* Thumbnail */}
                <div className="h-20 w-28 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-black/40">
                  {item.car?.image_url ? (
                    <img
                      src={item.car.image_url}
                      alt={`${item.car.marca} ${item.car.modelo}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-widest text-muted">
                      Sin foto
                    </div>
                  )}
                </div>

                {/* Datos */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-display text-sm uppercase tracking-[0.18em] ${
                        item.isToday ? "text-accent" : "text-white"
                      }`}
                    >
                      {item.isToday ? "Hoy" : item.weekday}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted">
                      {item.short}
                    </span>
                  </div>
                  {item.car ? (
                    <>
                      <p className="mt-1 truncate text-sm text-white">
                        {item.car.marca} {item.car.modelo}
                      </p>
                      <p className="text-xs text-muted">
                        {item.car.anio} · {item.car.pais}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Sin coche asignado.</p>
                  )}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex border-t border-border">
                <button
                  type="button"
                  disabled={!item.car}
                  onClick={() =>
                    item.car && typeof onEditCar === "function" && onEditCar(item.car.id)
                  }
                  className="
                    flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-white
                    transition hover:bg-white/5
                    disabled:cursor-not-allowed disabled:opacity-40
                  "
                >
                  Editar coche
                </button>
                <div className="w-px bg-border" aria-hidden="true" />
                <button
                  type="button"
                  disabled={item.isToday}
                  onClick={() =>
                    typeof onSwapCar === "function" &&
                    onSwapCar(item.date, item.car?.id || null)
                  }
                  className="
                    flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-accent
                    transition hover:bg-accent/10
                    disabled:cursor-not-allowed disabled:opacity-40 disabled:text-muted
                  "
                  title={item.isToday ? "El coche de hoy no se puede cambiar" : undefined}
                >
                  Cambiar coche
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
