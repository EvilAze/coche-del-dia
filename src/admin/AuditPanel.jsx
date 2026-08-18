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

// Gemelo POST. Este panel era de solo lectura hasta que ganó la columna de
// acciones, así que antes no hacía falta.
async function authPost(path, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("No session");
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
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

// Porcentaje con 1 decimal. null/NaN → "—".
function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// Duración en humano: "12s", "1m 45s", "23m". null → "—".
function humanDur(sec) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 10 && s) return `${m}m ${s}s`;
  return `${m}m`;
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

// La celda de acción. Excluido se pinta en ámbar y no en rojo: el rojo de esta
// tabla ya significa «sospechoso» (ZScoreCell, ScoreBadge) y usarlo también
// para el estado de moderación haría que la fila entera pareciera una sola
// alarma. Aquí el color dice «tocado por un humano», no «peligro».
function ExclusionCell({ excluido, enCurso, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={enCurso}
      title={
        excluido
          ? "Fuera de las tablas públicas. Pulsa para readmitir."
          : "Sacar de clasificación, histórica, salón y podios futuros. Sigue jugando."
      }
      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider disabled:opacity-50 ${
        excluido
          ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
          : "bg-white/5 text-muted hover:bg-white/10 hover:text-white"
      }`}
    >
      {enCurso ? "…" : excluido ? "Excluido" : "Excluir"}
    </button>
  );
}

export default function AuditPanel() {
  const [range, setRange] = useState("14d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Moderación: userId en curso (para deshabilitar solo SU botón, no todos) y
  // el último aviso.
  const [modUserId, setModUserId] = useState(null);
  const [modEstado, setModEstado] = useState("");

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

  // Excluir de las tablas públicas / readmitir. Ver
  // scripts/2026-08-exclusion-de-clasificacion.sql: la cuenta sigue jugando y
  // sigue sumando, solo deja de salir en clasificación, histórica, salón y
  // podios futuros.
  //
  // El estado se parchea en local en vez de recargar: recargar la auditoría
  // vuelve a recorrer guess_audit entero, que en rango "Todo" son segundos, y
  // el único dato que ha cambiado es la pertenencia a una lista.
  async function alternarExclusion(suspect) {
    if (modUserId) return;
    const yaExcluido = (data?.excluidos || []).includes(suspect.userId);
    const accion = yaExcluido ? "readmitir-clasificacion" : "excluir-clasificacion";

    const ok = window.confirm(
      yaExcluido
        ? `Readmitir a ${suspect.email} en la clasificación?\n\n` +
            "Volverá a aparecer en las tablas públicas y a entrar en los podios."
        : `Excluir a ${suspect.email} de la clasificación?\n\n` +
            "Desaparece de la clasificación de temporada, de la histórica y del " +
            "salón de campeones, y deja de entrar en los podios que se sellen.\n\n" +
            "NO se le borra la cuenta, NO pierde puntos ni racha y puede seguir " +
            "jugando. Es reversible desde aquí mismo."
    );
    if (!ok) return;

    setModUserId(suspect.userId);
    setModEstado("");
    try {
      const r = await authPost("/api/admin/moderacion", {
        action: accion,
        userId: suspect.userId,
      });
      setData((d) => {
        if (!d) return d;
        const previos = d.excluidos || [];
        return {
          ...d,
          excluidos: r.excluido
            ? [...previos, suspect.userId]
            : previos.filter((id) => id !== suspect.userId),
        };
      });
      setModEstado(
        r.excluido
          ? `${suspect.email} fuera de las tablas públicas.`
          : `${suspect.email} readmitido.`
      );
    } catch (err) {
      setModEstado(`Error: ${err.message || "no se pudo aplicar"}`);
    } finally {
      setModUserId(null);
    }
  }

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

      {!loading && !error && data && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Intentos registrados" value={data.totalRows ?? 0} />
            <Stat label="Casos por IP" value={data.flags?.length ?? 0} accent={(data.flags?.length ?? 0) > 0} />
            <Stat label="Canarios" value={data.canaries?.length ?? 0} accent={(data.canaries?.length ?? 0) > 0} />
          </div>

          {/* Sección 1: Ranking de sospecha (siempre, sale de user_guesses) */}
          <section className="space-y-2">
            <h3 className="font-display text-sm uppercase tracking-[0.18em] text-white">
              Ranking de sospecha
            </h3>
            <p className="text-[10px] text-muted">
              Huella de oráculo: % de victorias clavando marca+modelo+año a la 1ª en frío.
              Independiente de la IP. Necesita ≥5 partidas daily en el rango.
            </p>
            {data.population && data.population.users > 0 && (
              <p className="text-[10px] text-muted">
                Línea base poblacional ({data.population.users} jugadores):
                media de acierto frío a la 1ª{" "}
                <span className="text-white/80">{pct(data.population.meanColdExactRate)}</span>,
                σ <span className="text-white/80">{pct(data.population.stdColdExactRate)}</span>.
                La columna <span className="text-white/80">σ</span> es cuántas desviaciones
                típicas por encima de la media está cada cuenta (≥3σ = muy improbable por azar).
              </p>
            )}
            {modEstado && (
              <p
                className={`text-xs ${
                  modEstado.startsWith("Error") ? "text-rose-300" : "text-emerald-300"
                }`}
              >
                {modEstado}
              </p>
            )}
            {(!data.suspects || data.suspects.length === 0) ? (
              <div className="rounded-xl border border-border bg-bg-secondary/40 p-4 text-center text-xs text-muted">
                Sin datos suficientes en este rango (prueba "Todo").
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-bg-secondary/60 text-[9px] uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-2 py-2">Cuenta</th>
                      <th className="px-2 py-2 text-right">Part.</th>
                      <th className="px-2 py-2 text-right">Win%</th>
                      <th className="px-2 py-2 text-right">1ª frío</th>
                      <th className="px-2 py-2 text-right" title="Desviaciones típicas por encima de la media poblacional de acierto frío a la 1ª. ≥3σ = muy improbable por azar.">σ</th>
                      <th className="px-2 py-2 text-right" title="Tiempo mediano desde abrir el juego hasta ganar (solo wins con session_start logueado)">t→win</th>
                      <th className="px-2 py-2 text-right">Score</th>
                      <th className="px-2 py-2 text-right">Clasificación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.suspects.map((s) => (
                      <tr key={s.userId} className="border-t border-border-strong/60">
                        <td className="px-2 py-1.5 text-white">{s.email}</td>
                        <td className="px-2 py-1.5 text-right text-muted">{s.games}</td>
                        <td className="px-2 py-1.5 text-right text-muted">{pct(s.winRate)}</td>
                        <td className="px-2 py-1.5 text-right text-muted">
                          {s.coldExact}/{s.games} ({pct(s.coldExactRate)})
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <ZScoreCell z={s.coldExactZ} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <TimeToWinCell ttw={s.timeToWin} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <ScoreBadge score={s.score} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <ExclusionCell
                            excluido={(data.excluidos || []).includes(s.userId)}
                            enCurso={modUserId === s.userId}
                            onClick={() => alternarExclusion(s)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sección 3: Canarios */}
          {data.canaries?.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-display text-sm uppercase tracking-[0.18em] text-white">
                Canarios (tokens forjados)
              </h3>
              <div className="space-y-1">
                {data.canaries.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-2 rounded-lg bg-red-500/[0.05] px-2 py-1 text-[11px]">
                    <span className="text-muted">{shortDateTime(c.ts)}</span>
                    <span className={`font-semibold ${c.isAnon ? "text-amber-300" : "text-white"}`}>{c.who}</span>
                    <span className="rounded bg-red-500/20 px-1 text-[9px] uppercase text-red-300">{c.reason}</span>
                    {c.ipHash && <span className="text-[10px] text-muted">ip {c.ipHash}…</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.migrationPending && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-4 text-sm text-amber-200">
              La tabla de auditoría aún no existe, así que las secciones por IP y canarios no
              están activas. Aplica <code className="text-amber-100">scripts/supabase-guess-audit.sql</code>{" "}
              en Supabase. (El ranking de sospecha de arriba sí funciona — sale de las partidas.)
            </div>
          )}

          {/* Sección 2: Casos por IP */}
          {!data.migrationPending && (
            <h3 className="font-display text-sm uppercase tracking-[0.18em] text-white">
              Casos por IP
            </h3>
          )}
          {!data.migrationPending && data.flags.length === 0 && (
            <div className="rounded-xl border border-border bg-bg-secondary/40 p-6 text-center text-sm text-muted">
              Nada sospechoso por IP en este rango. (Necesita partidas jugadas con el logging activo.)
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

// Pastilla de time-to-win. <30s rojo (incompatible con jugar a mano),
// <60s ámbar (sospechoso), resto neutro. null → "—" gris.
function TimeToWinCell({ ttw }) {
  if (!ttw) return <span className="text-muted">—</span>;
  const tone =
    ttw.medianSec < 30 ? "text-red-300"
    : ttw.medianSec < 60 ? "text-amber-300"
    : "text-muted";
  return (
    <span className={tone} title={`mediana de ${ttw.n} wins medibles (min ${ttw.min}s, max ${ttw.max}s)`}>
      {humanDur(ttw.medianSec)} <span className="text-[9px] opacity-60">(n={ttw.n})</span>
    </span>
  );
}

// Pastilla de z-score (σ sobre la media poblacional de acierto frío a la 1ª).
// ≥3σ rojo (muy improbable por azar), ≥2σ ámbar (a vigilar), resto neutro.
// null/undefined → "—" (no había base poblacional, p.ej. <2 jugadores).
function ZScoreCell({ z }) {
  if (z === null || z === undefined) return <span className="text-muted">—</span>;
  const tone =
    z >= 3 ? "text-red-300 font-semibold"
    : z >= 2 ? "text-amber-300"
    : "text-muted";
  // Signo explícito: un +2.4 se lee mucho mejor que 2.4 en una tabla de sospecha.
  const label = `${z > 0 ? "+" : ""}${z.toFixed(1)}σ`;
  return <span className={tone}>{label}</span>;
}

// Pastilla de score 0-100: verde bajo, ámbar medio, rojo alto.
function ScoreBadge({ score }) {
  const tone =
    score >= 65 ? "bg-red-500/20 text-red-300"
    : score >= 45 ? "bg-amber-500/20 text-amber-300"
    : "bg-white/5 text-muted";
  return (
    <span className={`inline-block min-w-[2.2rem] rounded px-1.5 py-0.5 text-center font-semibold ${tone}`}>
      {score}
    </span>
  );
}
