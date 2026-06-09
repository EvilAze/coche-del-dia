// src/admin/AnalyticsPanel.jsx
// ---------------------------------------------------------------------
// Panel de analítica interna del admin. Métricas calculadas en
// /api/admin/analytics a partir de los datos de Supabase (auth.users,
// stats, user_guesses, daily_cars).
//
// Sin librerías de charting — usamos SVG y divs con width % para todas
// las visualizaciones. Razones: el bundle es 0 KB extra, mantenemos
// control total sobre estilo (mismo lenguaje dark + accent que el resto
// del admin), y los charts son simples (línea + barras) — Chart.js
// añadiría ~40 KB para algo que cabe en ~80 líneas de JSX.
// ---------------------------------------------------------------------

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";

const RANGE_OPTIONS = [
  { id: "24h", label: "24 h" },
  { id: "7d",  label: "7 días" },
  { id: "14d", label: "2 sem" },
  { id: "30d", label: "30 días" },
  { id: "90d", label: "90 días" },
];

// Helper para fetch autenticado con el token de sesión actual.
async function authFetch(path) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("No session");
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Formato de fecha humano corto: "24 may" — ahorra espacio en eje X.
function shortDate(isoDate) {
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [, m, d] = isoDate.split("-");
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
}

// Formato datetime humano con hora local del navegador.
function shortDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleString("es-ES", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

// Formato porcentaje con 1 decimal. null → "—".
function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// Email truncado: oculta parte del local para no exponer addresses
// completas en un screenshot accidental.
function maskEmail(email) {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  if (local.length <= 3) return email;
  return `${local.slice(0, 3)}…@${domain}`;
}

export default function AnalyticsPanel() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Drill-down de usuario seleccionado.
  const [selectedUser, setSelectedUser] = useState(null);
  const [userHistory, setUserHistory] = useState(null);
  const [userHistoryLoading, setUserHistoryLoading] = useState(false);

  // Fetch principal al cambiar el range.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    authFetch(`/api/admin/analytics?range=${range}`)
      .then((json) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Error cargando analítica");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [range]);

  // Fetch del historial cuando se selecciona usuario.
  useEffect(() => {
    if (!selectedUser) {
      setUserHistory(null);
      return;
    }
    let cancelled = false;
    setUserHistoryLoading(true);
    authFetch(`/api/admin/analytics?userId=${encodeURIComponent(selectedUser.id)}`)
      .then((json) => {
        if (cancelled) return;
        setUserHistory(json.history || []);
      })
      .catch(() => {
        if (cancelled) return;
        setUserHistory([]);
      })
      .finally(() => {
        if (!cancelled) setUserHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedUser]);

  return (
    <div className="space-y-6">
      {/* CABECERA + SELECTOR DE RANGO */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl tracking-widest text-accent">
            ANALÍTICA
          </h2>
          {data?.range && (
            <p className="mt-0.5 text-xs text-muted">
              {data.range.label} · {shortDate(data.range.from)} → {shortDate(data.range.to)}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              disabled={loading}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
                range === r.id
                  ? "bg-accent/15 text-accent"
                  : "text-white/60 hover:text-white"
              } ${loading ? "opacity-50" : ""}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && !data && <SkeletonState />}

      {data && (
        <>
          {/* ROW 1 · KPIs principales */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Usuarios totales" value={data.users.total} />
            <KpiCard label="Nuevos en periodo" value={`+${data.users.newInPeriod}`} positive={data.users.newInPeriod > 0} />
            <KpiCard label="DAU promedio" value={data.engagement.dauAvg.toFixed(1)} />
            <KpiCard
              label="Repesca usage"
              value={pct(data.engagement.repescaUsage.rate)}
              hint={`${data.engagement.repescaUsage.usersUsed}/${data.engagement.repescaUsage.totalUsers}`}
            />
          </div>

          {/* ROW 1.5 · Dificultad global (DDA Arq. A) */}
          {data.difficulty && <GlobalDifficultyCard d={data.difficulty} />}

          {/* ROW 2 · DAU chart */}
          <Card title="Usuarios activos por día (DAU)">
            <DauLineChart series={data.engagement.dauSeries} />
          </Card>

          {/* ROW 3 · Retención */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RetentionCard
              title="Retención D1"
              tooltip="% de usuarios cuya primera partida fue en el periodo y volvieron al día siguiente."
              data={data.engagement.retention.d1}
            />
            <RetentionCard
              title="Retención D7"
              tooltip="% de usuarios cuya primera partida fue en el periodo y volvieron 7 días después."
              data={data.engagement.retention.d7}
            />
          </div>

          {/* ROW 4 · Win rate + Streak distribution */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="Distribución de resultados">
              <BarChart
                data={data.gameplay.winRateDistribution}
                getColor={(d) => (d.kind === "win" ? "bg-emerald-500/60" : "bg-rose-500/60")}
              />
            </Card>
            <Card title="Rachas activas (snapshot)">
              <BarChart
                data={data.gameplay.streakDistribution}
                getColor={() => "bg-accent/60"}
              />
            </Card>
          </div>

          {/* ROW 5 · Coches más fallados */}
          <Card title="Coches con mayor tasa de fallo (min. 5 partidas)">
            <HardestCarsTable cars={data.gameplay.hardestCars} />
          </Card>

          {/* ROW 6 · Últimos logins */}
          <Card title="Últimos logins">
            <LastLoginsTable
              logins={data.users.lastLogins}
              selectedUserId={selectedUser?.id}
              onSelect={(u) => setSelectedUser(u)}
            />
          </Card>

          {/* ROW 7 · Drill-down de usuario */}
          {selectedUser && (
            <Card
              title={`Historial · ${maskEmail(selectedUser.email)}`}
              action={
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="text-xs text-muted hover:text-white"
                >
                  Cerrar
                </button>
              }
            >
              {userHistoryLoading ? (
                <div className="py-8 text-center text-sm text-muted">Cargando…</div>
              ) : userHistory && userHistory.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">Este usuario no tiene partidas todavía.</div>
              ) : (
                <UserHistoryTable history={userHistory || []} />
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   Sub-componentes: cards, charts, tablas
   ============================================================ */

function Card({ title, children, action }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/90">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Tarjeta de dificultad GLOBAL: la señal agregada fiable a baja escala.
// Histórica (no depende del rango). Compara el coste medio con el objetivo y
// recomienda nudge del default de zoom cuando hay deriva.
function GlobalDifficultyCard({ d }) {
  const target = d.targetCost ?? 3.5;
  const cost = d.cost;
  // Veredicto según desviación del objetivo (mismas bandas que el editor).
  let verdict = "—", verdictClass = "text-muted";
  if (cost != null) {
    if (cost < target - 0.5) { verdict = "tienden a fácil"; verdictClass = "text-amber-300"; }
    else if (cost > target + 0.7) { verdict = "tienden a difícil"; verdictClass = "text-rose-300"; }
    else { verdict = "equilibrados"; verdictClass = "text-emerald-300"; }
  }
  // ¿Merece la pena tocar el default? Solo si la sugerencia se separa del actual.
  const cur = d.currentDefaultBase;
  const sug = d.suggestedDefaultBase;
  const nudge =
    typeof sug === "number" && typeof cur === "number" && Math.abs(sug - cur) >= 0.1
      ? sug
      : null;

  return (
    <Card title="Dificultad global (histórico)">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted">
          {d.totalGames.toLocaleString("es")} partidas · {d.carsMeasured.toLocaleString("es")} coches medidos
        </p>
        <span className={`text-xs font-semibold ${verdictClass}`}>{verdict}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="coste medio" value={cost == null ? "—" : cost.toFixed(2)} hint={`objetivo ${target.toFixed(1)}`} />
        <MiniStat label="intento medio (ganadas)" value={d.meanWinningAttempt == null ? "—" : d.meanWinningAttempt.toFixed(2)} />
        <MiniStat label="≤3 intentos" value={pct(d.pBy3)} />
        <MiniStat label="fallo" value={pct(d.failRate)} />
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs">
        {d.totalGames < 100 ? (
          <span className="text-amber-300/80">
            Muestra aún pequeña (&lt;100 partidas): la señal global se vuelve fiable
            con más jornadas acumuladas.
          </span>
        ) : nudge ? (
          <span className="text-white/85">
            Recomendación: mover el <span className="text-accent">default de zoom</span>{" "}
            de {cur.toFixed(1)}× a <span className="text-accent font-semibold">{nudge.toFixed(1)}×</span>{" "}
            (DEFAULT_ZOOM_BASE en api/_lib/zoom.js + src/lib/zoom.js).
          </span>
        ) : (
          <span className="text-emerald-300/80">
            El default de zoom ({cur?.toFixed(1)}×) está bien calibrado: sin deriva apreciable.
          </span>
        )}
      </div>
    </Card>
  );
}

function MiniStat({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className="font-display text-lg tracking-wider text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      {hint && <div className="text-[9px] text-muted/70">{hint}</div>}
    </div>
  );
}

function KpiCard({ label, value, hint, positive }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl tracking-wider ${positive ? "text-emerald-300" : "text-white"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-muted">{hint}</p>}
    </div>
  );
}

function RetentionCard({ title, tooltip, data }) {
  const rate = data?.rate;
  return (
    <Card title={title}>
      <div title={tooltip}>
        <p className="font-display text-3xl tracking-wider text-white">
          {pct(rate)}
        </p>
        <p className="mt-1 text-xs text-muted">
          {data?.cohort || 0} usuarios en cohorte · {data?.returned || 0} volvieron
        </p>
        {data?.cohort < 5 && (
          <p className="mt-2 text-[10px] italic text-amber-300/70">
            Muestra pequeña (n &lt; 5) — el porcentaje es ruido estadístico todavía.
          </p>
        )}
      </div>
    </Card>
  );
}

// Chart de línea DAU. SVG inline con un solo path. Maneja el caso
// degenerado de todos los valores = 0 (no dividimos por max=0).
function DauLineChart({ series }) {
  const W = 600;
  const H = 140;
  const PAD = { top: 10, right: 8, bottom: 22, left: 28 };

  if (!series || series.length === 0) {
    return <div className="py-8 text-center text-sm text-muted">Sin datos.</div>;
  }

  const maxY = Math.max(1, ...series.map((d) => d.count));
  const stepX = (W - PAD.left - PAD.right) / Math.max(1, series.length - 1);

  const points = series.map((d, i) => {
    const x = PAD.left + i * stepX;
    const y = PAD.top + (H - PAD.top - PAD.bottom) * (1 - d.count / maxY);
    return { x, y, d };
  });

  const path = points.reduce(
    (acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`),
    ""
  );
  const area =
    path +
    ` L ${points[points.length - 1].x} ${H - PAD.bottom} L ${points[0].x} ${H - PAD.bottom} Z`;

  // Mostrar a lo sumo 6 labels en eje X, sample equiespaciado.
  const labelStep = Math.max(1, Math.ceil(series.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      {/* Grid horizontal: línea media y techo */}
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={PAD.top} y2={PAD.top}
        stroke="rgba(255,255,255,0.08)"
      />
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={H - PAD.bottom} y2={H - PAD.bottom}
        stroke="rgba(255,255,255,0.15)"
      />
      {/* Etiquetas eje Y: 0 y max */}
      <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">0</text>
      <text x={PAD.left - 6} y={PAD.top} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">{maxY}</text>
      {/* Área de fondo */}
      <path d={area} fill="rgba(122, 240, 200, 0.12)" />
      {/* Línea principal */}
      <path d={path} fill="none" stroke="#e8c87a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Puntos */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#e8c87a">
          <title>{`${shortDate(p.d.date)}: ${p.d.count}`}</title>
        </circle>
      ))}
      {/* Etiquetas eje X */}
      {points.map((p, i) =>
        i % labelStep === 0 ? (
          <text
            key={i}
            x={p.x} y={H - PAD.bottom + 14}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)" fontSize="10"
          >
            {shortDate(p.d.date)}
          </text>
        ) : null
      )}
    </svg>
  );
}

// Barras horizontales con etiqueta + valor. Simple y legible.
function BarChart({ data, getColor }) {
  const maxV = useMemo(
    () => Math.max(1, ...(data || []).map((d) => d.count)),
    [data]
  );
  if (!data || data.length === 0) {
    return <div className="py-6 text-center text-sm text-muted">Sin datos.</div>;
  }
  return (
    <div className="space-y-2">
      {data.map((d) => {
        const widthPct = (d.count / maxV) * 100;
        const color = getColor ? getColor(d) : "bg-accent/60";
        return (
          <div key={d.label || d.key} className="flex items-center gap-3 text-xs">
            <div className="w-20 shrink-0 text-right text-white/70">{d.label}</div>
            <div className="relative flex-1">
              <div className="h-5 rounded bg-white/[0.04]">
                <div
                  className={`h-5 rounded ${color} transition-all duration-300`}
                  style={{ width: `${widthPct}%`, minWidth: d.count > 0 ? "2px" : 0 }}
                />
              </div>
            </div>
            <div className="w-10 shrink-0 text-left font-mono text-white/85">{d.count}</div>
          </div>
        );
      })}
    </div>
  );
}

function HardestCarsTable({ cars }) {
  if (!cars || cars.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted">
        Sin partidas suficientes en el periodo (mínimo 5 jugadas por coche).
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted">
            <th className="pb-2 pr-3">Coche</th>
            <th className="pb-2 pr-3">Año</th>
            <th className="pb-2 pr-3 text-right">Jugadas</th>
            <th className="pb-2 pr-3 text-right">Fallos</th>
            <th className="pb-2 text-right">% fallo</th>
          </tr>
        </thead>
        <tbody>
          {cars.map((c) => (
            <tr key={c.carId} className="border-t border-white/5 text-white/85">
              <td className="py-2 pr-3">
                <span className="font-semibold text-white">{c.marca}</span>{" "}
                <span className="text-white/70">{c.modelo}</span>
              </td>
              <td className="py-2 pr-3 text-white/60">{c.anio || "—"}</td>
              <td className="py-2 pr-3 text-right font-mono">{c.plays}</td>
              <td className="py-2 pr-3 text-right font-mono text-rose-300">{c.losses}</td>
              <td className="py-2 text-right font-mono text-rose-300">{pct(c.loseRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LastLoginsTable({ logins, selectedUserId, onSelect }) {
  if (!logins || logins.length === 0) {
    return <div className="py-6 text-center text-sm text-muted">Sin logins registrados.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted">
            <th className="pb-2 pr-3">Email</th>
            <th className="pb-2 pr-3">Último login</th>
            <th className="pb-2">Registrado</th>
          </tr>
        </thead>
        <tbody>
          {logins.map((u) => {
            const isSel = u.id === selectedUserId;
            return (
              <tr
                key={u.id}
                onClick={() => onSelect(u)}
                className={`cursor-pointer border-t border-white/5 transition-colors ${
                  isSel ? "bg-accent/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <td className="py-2 pr-3 text-white/90">{maskEmail(u.email)}</td>
                <td className="py-2 pr-3 text-white/70">{shortDateTime(u.lastSignInAt)}</td>
                <td className="py-2 text-white/55">{shortDateTime(u.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted">
        Click en una fila para ver el historial de juego de ese usuario.
      </p>
    </div>
  );
}

function UserHistoryTable({ history }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted">
            <th className="pb-2 pr-3">Fecha</th>
            <th className="pb-2 pr-3">Coche</th>
            <th className="pb-2 pr-3">Estado</th>
            <th className="pb-2 text-right">Intentos</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => {
            const isWon = h.status === "won";
            const isLost = h.status === "lost";
            return (
              <tr key={`${h.date}-${h.carId}-${i}`} className="border-t border-white/5 text-white/85">
                <td className="py-2 pr-3 text-white/70">{h.date}</td>
                <td className="py-2 pr-3">
                  <span className="font-semibold text-white">{h.marca}</span>{" "}
                  <span className="text-white/70">{h.modelo}</span>{" "}
                  <span className="text-white/50">{h.anio || ""}</span>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      isWon
                        ? "bg-emerald-500/15 text-emerald-300"
                        : isLost
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-white/10 text-white/70"
                    }`}
                  >
                    {isWon ? "Ganada" : isLost ? "Perdida" : "En curso"}
                  </span>
                </td>
                <td className="py-2 text-right font-mono">{h.attempts}/5</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.02]"
        />
      ))}
    </div>
  );
}
