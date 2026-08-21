// src/admin/SeasonsPanel.jsx
// Panel admin de Temporadas Temáticas: crear/editar/borrar los periodos con
// antelación, su temática (label es/en) y el FILTRO que la hace real. Lista +
// formulario. Habla con /api/admin/seasons. El no-solape lo valida la BD
// (constraint gist); aquí mostramos el 409 legible que devuelve el handler.
//
// El filtro es la diferencia entre anunciar un tema y cumplirlo: mientras el
// label solo pinta el banner, `theme_filter` restringe de qué coches puede
// tirar pick_daily_car esos días. El contador de pool que hay bajo el
// formulario es la red de seguridad operativa — avisa de una temática
// imposible ANTES de programarla, no a mitad de temporada en producción.
//
// La validación de verdad vive en api/_lib/season-theme.js (servidor). Aquí
// solo componemos el objeto y pintamos: no replicamos reglas para no crear
// otro par de ficheros que mantener en sync.

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

// Días que dura una temporada, ambos extremos incluidos. Es el número de
// coches que necesita el pool para no repetir ninguno.
function seasonDays(startsAt, endsAt) {
  if (!startsAt || !endsAt) return 0;
  const a = Date.parse(`${startsAt}T00:00:00Z`);
  const b = Date.parse(`${endsAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Los campos de lista se teclean separados por comas (o saltos de línea al
// pegar desde una hoja de cálculo). El servidor vuelve a normalizar esto.
function parseList(raw) {
  return String(raw || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Form → objeto theme_filter. Solo incluye las claves con contenido: una
// clave vacía debe DESAPARECER, no viajar como lista vacía (que en SQL no
// casaría con nada y dejaría el pool a cero).
function buildThemeFilter(form) {
  const filter = {};
  for (const key of ["tags", "pais", "make"]) {
    const list = parseList(form[key]);
    if (list.length > 0) filter[key] = list;
  }
  if (String(form.year_from).trim()) filter.year_from = Number(form.year_from);
  if (String(form.year_to).trim()) filter.year_to = Number(form.year_to);
  return Object.keys(filter).length > 0 ? filter : null;
}

// theme_filter guardado → campos del form (el camino inverso, al editar).
function formFromFilter(filter) {
  const f = filter && typeof filter === "object" ? filter : {};
  return {
    tags: Array.isArray(f.tags) ? f.tags.join(", ") : "",
    pais: Array.isArray(f.pais) ? f.pais.join(", ") : "",
    make: Array.isArray(f.make) ? f.make.join(", ") : "",
    year_from: f.year_from != null ? String(f.year_from) : "",
    year_to: f.year_to != null ? String(f.year_to) : "",
  };
}

// Resumen compacto para las filas de la lista: "Italia · 1980-1989 · #grupo-b".
// null si la temporada no tiene temática (y entonces la fila lo dice, porque
// una temporada sin filtro sorteando de todo el catálogo es información que
// el admin necesita ver de un vistazo).
function themeSummary(filter) {
  if (!filter || typeof filter !== "object") return null;
  const parts = [];
  if (Array.isArray(filter.pais)) parts.push(filter.pais.join(" / "));
  if (Array.isArray(filter.make)) parts.push(filter.make.join(" / "));
  if (filter.year_from != null || filter.year_to != null) {
    parts.push(`${filter.year_from ?? "…"}-${filter.year_to ?? "…"}`);
  }
  if (Array.isArray(filter.tags)) parts.push(filter.tags.map((t) => `#${t}`).join(" "));
  return parts.length > 0 ? parts.join(" · ") : null;
}

const EMPTY_FORM = {
  id: "",
  number: "",
  label_es: "",
  label_en: "",
  // Quién presenta la temporada (colaboraciones). Vacío = temporada normal:
  // la línea de la pista del juego no cambia.
  presenta_es: "",
  presenta_en: "",
  starts_at: "",
  ends_at: "",
  // Filtro temático, como texto de formulario (ver buildThemeFilter).
  tags: "",
  pais: "",
  make: "",
  year_from: "",
  year_to: "",
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

// Aviso del pool: traduce {total, unseen} + días a la única pregunta que
// importa al programar una temporada — «¿da el catálogo para esto?».
//
// Los tres estados problemáticos son distintos y se avisan distinto:
//   · total 0     → el filtro no casa con NADA. pick_daily_car caería al
//                   catálogo completo y la temática sería mentira. Es un error.
//   · unseen < d  → hay tema, pero no da para todos los días sin repetir.
//                   Es un aviso, no un bloqueo: repetir dentro del tema es una
//                   decisión legítima si el tema es estrecho a propósito.
//   · unseen >= d → cubierto.
function PoolNotice({ filter, pool, days }) {
  const base = "mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed";

  if (filter === null) {
    return (
      <p className={`${base} border-border bg-black/20 text-muted`}>
        Sin temática: el juego sorteará de todo el catálogo y el nombre de la
        temporada será solo decoración del banner.
      </p>
    );
  }
  if (pool.pending) {
    return (
      <p className={`${base} animate-pulse border-border bg-black/20 text-muted`}>
        Contando coches del tema...
      </p>
    );
  }
  if (pool.error) {
    return (
      <p className={`${base} border-amber-400/40 bg-amber-400/10 text-amber-300`}>
        No se pudo contar el pool ({pool.error}). Puedes guardar igualmente.
      </p>
    );
  }
  if (!pool.data) return null;

  const { total, unseen } = pool.data;

  if (total === 0) {
    return (
      <p className={`${base} border-red-400/40 bg-red-400/10 text-red-300`}>
        Ningún coche casa con este filtro. La temporada caería al catálogo
        completo: revisa las etiquetas o amplía el rango.
      </p>
    );
  }
  if (days > 0 && unseen < days) {
    return (
      <p className={`${base} border-amber-400/40 bg-amber-400/10 text-amber-300`}>
        {total} coches en el tema, {unseen} sin salir nunca. Para {days} días
        faltan {days - unseen}: se repetirán coches ya vistos (siempre dentro
        del tema).
      </p>
    );
  }
  return (
    <p className={`${base} border-accent/40 bg-accent/5 text-accent`}>
      {total} coches en el tema, {unseen} sin salir nunca
      {days > 0 ? ` — cubre los ${days} días sin repetir.` : "."}
    </p>
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
  // Preview del pool: { total, unseen } | null. `pending` mientras se pide,
  // para no pintar un número viejo como si fuera el del filtro que estás
  // tecleando ahora mismo.
  const [pool, setPool] = useState({ data: null, pending: false, error: null });

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
      ...EMPTY_FORM,
      number: String(maxNum + 1),
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
      presenta_es: s.presenta_es ?? "",
      presenta_en: s.presenta_en ?? "",
      starts_at: s.starts_at ?? "",
      ends_at: s.ends_at ?? "",
      ...formFromFilter(s.theme_filter),
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

  // Filtro serializado: es la dependencia del efecto de preview. Serializar en
  // vez de depender del objeto evita re-pedir el pool en cada tecla que no
  // cambie el filtro (p.ej. escribir el label).
  const themeFilter = useMemo(() => buildThemeFilter(form), [
    form.tags,
    form.pais,
    form.make,
    form.year_from,
    form.year_to,
  ]);
  const themeKey = JSON.stringify(themeFilter);
  const days = seasonDays(form.starts_at, form.ends_at);

  // Preview del pool con debounce. Se pide SOLO si hay filtro: sin temática el
  // pool es el catálogo entero y el número no aporta nada.
  useEffect(() => {
    if (!formOpen || themeFilter === null) {
      setPool({ data: null, pending: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setPool((p) => ({ ...p, pending: true, error: null }));
    const timer = setTimeout(async () => {
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
          body: JSON.stringify({ preview: true, theme_filter: themeFilter }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        setPool({ data: body.pool || null, pending: false, error: null });
      } catch (err) {
        if (!cancelled) {
          // El preview es una ayuda, nunca un bloqueo: si falla, se dice y ya.
          setPool({ data: null, pending: false, error: err?.message || "Error" });
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [themeKey, formOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
          presenta_es: form.presenta_es,
          presenta_en: form.presenta_en,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
          // null = temporada sin restricción: sortea de todo el catálogo.
          theme_filter: themeFilter,
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
          temporada cuyo rango incluye hoy y sortea SOLO entre los coches que
          casan con su filtro; las asignaciones manuales del Calendario siguen
          mandando por encima.
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
            {/* Colaboraciones. Se pinta durante la partida, al final del filete
                de la línea de pista, así que va en versalitas y corto: dos o
                tres palabras. Vacío = temporada sin patrocinio y esa línea
                queda como siempre. */}
            <Field label="Presenta (ES)">
              <input
                value={form.presenta_es}
                placeholder="USPI · POWERART"
                maxLength={40}
                onChange={(e) => setForm((f) => ({ ...f, presenta_es: e.target.value }))}
                className={inputCls}
              />
            </Field>
            <Field label="Presenta (EN)">
              <input
                value={form.presenta_en}
                placeholder="USPI · POWERART"
                maxLength={40}
                onChange={(e) => setForm((f) => ({ ...f, presenta_en: e.target.value }))}
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

            <div className="rounded-xl border border-border bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-accent">
                Temática real
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Restringe de qué coches sortea el juego estos días. Se combinan
                con Y; dentro de cada campo, varios valores separados por comas
                suman (O).
              </p>

              <div className="mt-3 flex flex-col gap-3">
                <Field label="Etiquetas">
                  <input
                    value={form.tags}
                    placeholder="grupo-b, rally"
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Países">
                    <input
                      value={form.pais}
                      placeholder="Italia, Francia"
                      onChange={(e) => setForm((f) => ({ ...f, pais: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Marcas">
                    <input
                      value={form.make}
                      placeholder="Ferrari"
                      onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Año desde">
                    <input
                      type="number"
                      value={form.year_from}
                      placeholder="1980"
                      onChange={(e) =>
                        setForm((f) => ({ ...f, year_from: e.target.value }))
                      }
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Año hasta">
                    <input
                      type="number"
                      value={form.year_to}
                      placeholder="1989"
                      onChange={(e) => setForm((f) => ({ ...f, year_to: e.target.value }))}
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>

              <PoolNotice filter={themeFilter} pool={pool} days={days} />
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
        /* Las temporadas no se borran al cerrarse: se acumulan una por semana,
           así que en un año esta lista son cincuenta tarjetas entre el botón de
           «Nueva temporada» y el final de la página. Con techo y scroll propio,
           el panel mide lo mismo en la T4 que en la T60. */
        <ul className="grid max-h-[34rem] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
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
                    {/* Que una temporada NO tenga filtro es información, no
                        ausencia de información: significa que su tema es solo
                        el rótulo. Por eso se dice en vez de dejar el hueco. */}
                    {themeSummary(s.theme_filter) ? (
                      <p className="mt-1 truncate text-[11px] text-accent">
                        {themeSummary(s.theme_filter)}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-amber-400/80">
                        Sin filtro — sortea de todo el catálogo
                      </p>
                    )}
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
