// src/admin/AuditPanel.jsx
// ---------------------------------------------------------------------
// Panel de auditoría anti-trampas. Consume /api/admin/audit, que lee la
// tabla oculta public.guess_audit y marca el patrón de "oráculo": la misma
// IP que sondea el coche de un día bajo una identidad (anónima u otra
// cuenta) y luego lo gana al PRIMER intento con una cuenta logueada.
// ---------------------------------------------------------------------

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const RANGE_OPTIONS = [
  { id: "7d",  label: "7 días" },
  { id: "14d", label: "2 sem" },
  { id: "30d", label: "30 días" },
  { id: "90d", label: "90 días" },
  { id: "all", label: "Todo" },
];

async function authFetch(path) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("No session");
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function shortDateTime(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// Pinta el estado de un campo (correct/partial/wrong) como pastilla.
function StatusDot({ status }) {
  const map = {
    correct: "bg-emerald-500/20 text-emerald-300",
    partial: "bg-amber-500/20 text-amber-300",
    wrong: "bg-white/5 text-muted",
  };
  return (
    <span className={`inline-block rounded px-1 text-[9px] uppercase ${map[status] || map.wrong}`}>
      {status || "—"}
    </span>
  );
}

export default function AuditPanel() {
  const [range, setRange] = useState("14d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    authFetch(`/api/admin/audit?range=${range}`)
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => { if (!cancelled) setError(err.message || "Error cargando auditoría"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="space-y-6">
      {/* Cabecera + selector de rango */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl tracking-widest text-white">Auditoría</h2>
          <p className="mt-1 text-xs text-muted">
            Patrón oráculo: misma IP sondea hoy y gana a la 1ª con otra cuenta.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-bg-secondary/40 p-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`rounded px-2 py-1 text-[10px] uppercase tracking-wider transition ${
                range === r.id ? "bg-accent text-bg-primary font-semibold" : "text-muted hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="animate-pulse text-sm uppercase tracking-widest text-muted">Cargando…</p>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data?.migrationPending && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-4 text-sm text-amber-200">
          La tabla de auditoría aún no existe. Aplica{" "}
          <code className="text-amber-100">scripts/supabase-guess-audit.sql</code> en el SQL
          Editor de Supabase y vuelve aquí.
        </div>
      )}

      {!loading && !error && data && !data.migrationPending && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Intentos registrados" value={data.totalRows} />
            <Stat label="Casos marcados" value={data.flags.length} accent={data.flags.length > 0} />
            <Stat label="Cuentas señaladas" value={data.flaggedWinners} accent={data.flaggedWinners > 0} />
          </div>

          {data.flags.length === 0 && (
            <div className="rounded-xl border border-border bg-bg-secondary/40 p-6 text-center text-sm text-muted">
              Nada sospechoso en este rango. (Necesita partidas jugadas con el logging activo.)
            </div>
          )}

          {/* Lista de casos */}
          <div className="space-y-4">
            {data.flags.map((f, i) => (
              <div
                key={`${f.date}-${f.ipHash}-${i}`}
                className="rounded-xl border border-red-400/30 bg-red-500/[0.03] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-display text-sm tracking-wider text-white">{f.date}</span>
                    <span className="ml-2 text-xs text-muted">
                      {f.car.marca} {f.car.modelo} {f.car.anio || ""}
                    </span>
                  </div>
                  <span className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-300">
                    ganó a la 1ª: {f.winnerEmail}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted">ip_hash {f.ipHash}…</p>

                {/* Timeline desde esa IP */}
                <div className="mt-3 space-y-1">
                  {f.timeline.map((t, j) => (
                    <div
                      key={j}
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1 text-[11px] ${
                        t.win ? "bg-emerald-500/[0.07]" : "bg-black/20"
                      }`}
                    >
                      <span className="text-muted">{shortDateTime(t.ts)}</span>
                      <span className={`font-semibold ${t.isAnon ? "text-amber-300" : "text-white"}`}>
                        {t.who}
                      </span>
                      <span className="text-muted">[{t.mode}]</span>
                      <span className="text-muted">int.{t.attempt}</span>
                      <span className="text-white/80">"{t.guess}"</span>
                      <StatusDot status={t.marca} />
                      <StatusDot status={t.modelo} />
                      <StatusDot status={t.anio} />
                      {t.win && (
                        <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold uppercase text-emerald-300">
                          win
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] leading-relaxed text-muted">
            Limitación: si el tramposo sondea desde otra red/IP (datos móviles vs wifi, VPN), el
            cruce por <code>ip_hash</code> no salta. Esto es auditoría indiciaria, no prueba
            absoluta.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-red-400/40 bg-red-500/5" : "border-border bg-bg-secondary/40"}`}>
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl ${accent ? "text-red-300" : "text-white"}`}>{value}</p>
    </div>
  );
}
