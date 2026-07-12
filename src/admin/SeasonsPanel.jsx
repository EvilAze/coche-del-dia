// src/admin/SeasonsPanel.jsx
// Panel admin de Temporadas Temáticas: crear/editar/borrar los periodos con
// antelación y su temática (label es/en). Lista + formulario. Habla con
// /api/admin/seasons. El no-solape lo valida la BD (constraint gist); aquí
// mostramos el 409 legible que devuelve el handler.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const DATE_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

// Hoy en Madrid como YYYY-MM-DD (mismo corte que el juego).
function todayMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(yyyyMmDd, n) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function fmt(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// Estado de una temporada respecto a hoy.
function seasonStatus(s, today) {
  if (today < s.starts_at) return { label: "Futura", cls: "text-muted border-border" };
  if (today > s.ends_at)
    return s.closed_at
      ? { label: "Cerrada", cls: "text-muted border-border" }
      : { label: "Terminada", cls: "text-amber-400 border-amber-400/40" };
  return { label: "Activa", cls: "text-accent border-accent/50" };
}

const EMPTY_FORM = {
  id: "",
  number: "",
  label_es: "",
  label_en: "",
  starts_at: "",
  ends_at: "",
};

const inputCls =
  "w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-accent";

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</span>
      {children}
    </label>
  );
}

export default function SeasonsPanel() {
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [refresh, setRefresh] = useState(0);

  const today = useMemo(() => todayMadrid(), []);

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
        const res = await fetch("/api/admin/seasons", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setSeasons(Array.isArray(body.seasons) ? body.seasons : []);
      } catch (err) {
        if (!cancelled) {
          console.error("[SeasonsPanel] fetch:", err);
          setError(err?.message || "No se pudieron cargar las temporadas.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const editing = Boolean(form.id);
  const formOpen = editing || form.number !== "" || form.starts_at !== "";

  // Prefill de "nueva temporada": contigua a la última (inicio = último fin + 1),
  // 2 semanas por defecto, número = máx + 1.
  function startNew() {
    setFormError(null);
    const maxNum = seasons.reduce((mx, s) => Math.max(mx, s.number || 0), 0);
    const latestEnd = seasons.reduce((mx, s) => (s.ends_at > mx ? s.ends_at : mx), "");
    const starts = latestEnd ? addDays(latestEnd, 1) : today;
    setForm({
      id: "",
      number: String(maxNum + 1),
      label_es: "",
      label_en: "",
      starts_at: starts,
      ends_at: addDays(starts, 13),
    });
  }

  function editSeason(s) {
    setFormError(null);
    setForm({
      id: s.id,
      number: String(s.number ?? ""),
      label_es: s.label_es ?? "",
      label_en: s.label_en ?? "",
      starts_at: s.starts_at ?? "",
      ends_at: s.ends_at ?? "",
    });
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  const canSave =
    form.number !== "" &&
    form.label_es.trim() &&
    form.label_en.trim() &&
    form.starts_at &&
    form.ends_at &&
    form.ends_at >= form.starts_at &&
    !saving;

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");
      const res = await fetch("/api/admin/seasons", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: form.id || undefined,
          number: Number(form.number),
          label_es: form.label_es,
          label_en: form.label_en,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setForm(EMPTY_FORM);
      setRefresh((k) => k + 1);
    } catch (err) {
      console.error("[SeasonsPanel] save:", err);
      setFormError(err?.message || "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function del(s) {
    if (
      !window.confirm(
        `¿Borrar la Temporada ${s.number} (${s.label_es})? Se perderán sus medallas de podio.`
      )
    )
      return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");
      const res = await fetch("/api/admin/seasons", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: s.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (form.id === s.id) setForm(EMPTY_FORM);
      setRefresh((k) => k + 1);
    } catch (err) {
      console.error("[SeasonsPanel] delete:", err);
      setError(err?.message || "No se pudo borrar.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">Temporadas</h2>
        <p className="mt-1 text-xs text-muted">
          Programa los periodos con antelación y su temática. El juego usa la
          temporada cuyo rango incluye hoy; el catálogo del tema lo curas en el
          Calendario.
        </p>
      </header>

      {formOpen ? (
        <div className="rounded-2xl border border-accent/40 bg-accent/5 p-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-accent">
            {editing ? `Editar Temporada ${form.number}` : "Nueva temporada"}
          </p>
          <div className="flex flex-col gap-3">
            <Field label="Número">
              <input
                type="number"
                min="1"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Temática (ES)">
              <input
                value={form.label_es}
                placeholder="Grupo B"
                onChange={(e) => setForm((f) => ({ ...f, label_es: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Temática (EN)">
              <input
                value={form.label_en}
                placeholder="Group B"
                onChange={(e) => setForm((f) => ({ ...f, label_en: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inicio">
                <input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Fin (incl.)">
                <input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {formError && (
            <p className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={!canSave}
              onClick={save}
              className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.16em] text-bg-primary transition hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-xl border border-border px-4 py-2.5 text-sm uppercase tracking-[0.16em] text-muted transition hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startNew}
          className="w-full rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-accent transition hover:border-accent hover:bg-accent/10"
        >
          + Nueva temporada
        </button>
      )}

      {loading && (
        <p className="animate-pulse text-xs uppercase tracking-widest text-muted">
          Cargando temporadas...
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && seasons.length === 0 && (
        <p className="text-xs text-muted">Aún no hay temporadas. Crea la primera.</p>
      )}

      {!loading && !error && seasons.length > 0 && (
        <ul className="flex flex-col gap-2">
          {seasons.map((s) => {
            const st = seasonStatus(s, today);
            return (
              <li
                key={s.id}
                className="rounded-2xl border border-border bg-bg-secondary/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm uppercase tracking-[0.16em] text-white">
                        T{s.number}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-white">{s.label_es}</p>
                    <p className="text-xs text-muted">
                      {fmt(s.starts_at)} → {fmt(s.ends_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => editSeason(s)}
                      className="rounded-lg px-2 py-1 text-[10px] uppercase tracking-widest text-white transition hover:bg-white/5"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => del(s)}
                      className="rounded-lg px-2 py-1 text-[10px] uppercase tracking-widest text-red-400 transition hover:bg-red-400/10"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
