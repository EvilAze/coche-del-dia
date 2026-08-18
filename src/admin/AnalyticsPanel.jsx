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

// Gemelo POST del de arriba. Aparte y no un parámetro más de authFetch porque
// las dos llamadas no se parecen en lo que importa: una lee y se puede repetir
// sin consecuencias, la otra escribe.
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
  // Moderación del nick: "" mientras no pasa nada, texto tras retirar (o tras
  // fallar). Se limpia al cambiar de usuario para no arrastrar el aviso de uno
  // a la ficha de otro.
  const [modEstado, setModEstado] = useState("");
  const [modEnCurso, setModEnCurso] = useState(false);

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
  //
  // La dependencia es el ID, no el objeto: retirar un nick parchea la fila
  // abierta (`username: null`) y con `[selectedUser]` ese parcheo contaba como
  // "otro usuario" — se repetía la query del historial y, peor, el
  // `setModEstado("")` de aquí abajo borraba el aviso de «nick retirado» justo
  // después de escribirlo. Es la misma ficha; solo cambió un campo.
  const selectedUserId = selectedUser?.id ?? null;
  useEffect(() => {
    setModEstado("");
    if (!selectedUserId) {
      setUserHistory(null);
      return;
    }
    let cancelled = false;
    setUserHistoryLoading(true);
    authFetch(`/api/admin/analytics?userId=${encodeURIComponent(selectedUserId)}`)
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
  }, [selectedUserId]);

  // Retirar el nick del usuario abierto. Ver lib/admin-handlers/moderacion.js:
  // el nombre se apunta como retirado (nadie puede volver a tomarlo) y la fila
  // desaparece de la clasificación sola, porque las funciones de temporada
  // filtran por `display_name IS NOT NULL`.
  //
  // window.confirm y no un modal a medida: es el idioma que ya habla este
  // panel (SchedulePanel, SeasonsPanel) y esta acción no se deshace desde la
  // interfaz — para devolverle el nombre a alguien hay que borrar su fila de
  // `nicks_retirados` a mano en Supabase, que es la fricción correcta para
  // algo que debería pasar tres veces al año.
  async function retirarNick() {
    if (!selectedUser || modEnCurso) return;
    const nick = selectedUser.username;
    if (!nick) return;
    const ok = window.confirm(
      `Retirar el nick «${nick}»?\n\n` +
        "Desaparece de la clasificación en el acto y NADIE podrá volver a " +
        "usar ese nombre. Al jugador se le pedirá uno nuevo la próxima vez " +
        "que abra la clasificación.\n\n" +
        "No toca su puntuación ni su racha."
    );
    if (!ok) return;

    setModEnCurso(true);
    setModEstado("");
    try {
      const r = await authPost("/api/admin/moderacion", {
        action: "retirar-nick",
        userId: selectedUser.id,
      });
      setModEstado(
        r?.yaEstaba ? "Ese perfil ya no tenía nick." : `Nick «${r.nick}» retirado.`
      );
      // Recargar la analítica entera son varios segundos de queries para
      // cambiar una celda, así que parcheamos en sitio las DOS copias del
      // nombre: la ficha abierta y la fila del directorio de arriba. Sin la
      // segunda, el nick retirado seguía leyéndose en la tabla y la acción
      // parecía no haber funcionado.
      setSelectedUser((u) => (u ? { ...u, username: null } : u));
      setData((d) =>
        d
          ? {
              ...d,
              users: {
                ...d.users,
                directory: d.users.directory.map((u) =>
                  u.id === selectedUser.id ? { ...u, username: null } : u
                ),
              },
            }
          : d
      );
    } catch (err) {
      setModEstado(`Error: ${err.message || "no se pudo retirar"}`);
    } finally {
      setModEnCurso(false);
    }
  }

  // Derivados para los KPIs de jugadores totales / anónimos. Misma base que la
  // gráfica de composición: totalAvg (daily_stats, incl. anónimos) y
  // registeredFinishedAvg (registrados que terminaron), ambos "completó el
  // daily", así que anónimos = total − registrados es exacto. Guardas para
  // cuando aún no hay `data` (primer render / carga).
  const totalAvg = data?.engagement?.totalAvg || 0;
  const registeredFinishedAvg = data?.engagement?.registeredFinishedAvg || 0;
  const anonAvg = Math.max(0, totalAvg - registeredFinishedAvg);
  const anonPct = totalAvg > 0 ? anonAvg / totalAvg : null;

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Registrados y anónimos son DOS poblaciones de auth.users, no una
                (ver fetchUsers en lib/admin-handlers/analytics.js). Antes se
                sumaban en un único "Usuarios totales" que crecía cada vez que
                un visitante jugaba una partida. Los "nuevos en periodo" de cada
                una bajan al hint para no gastar dos tarjetas más. */}
            <KpiCard
              label="Usuarios registrados"
              value={data.users.total}
              hint={`+${data.users.newInPeriod} en periodo`}
              positive={data.users.newInPeriod > 0}
            />
            <KpiCard
              label="Sesiones anónimas"
              value={data.users.anonTotal}
              hint={`+${data.users.anonNewInPeriod} en periodo · 1 por navegador`}
            />
            {/* «Registrados» vuelve a ser cierto: la serie se filtra ya por
                auth.users.is_anonymous. Antes user_guesses mezclaba las dos
                poblaciones (el anónimo recibe JWT en su primer intento) y esta
                cifra las sumaba en silencio. El hint saca además la actividad
                anónima, que hasta ahora no se veía en ninguna parte. */}
            <KpiCard
              label="DAU promedio"
              value={data.engagement.dauAvg.toFixed(1)}
              hint={`registrados · ${(data.engagement.dauAnonAvg || 0).toFixed(1)} anónimos`}
            />
            <KpiCard label="Jugadores/día" value={totalAvg.toFixed(1)} hint="total, incl. anónimos" />
            <KpiCard label="% anónimos" value={pct(anonPct)} hint={`≈ ${anonAvg.toFixed(1)}/día`} />
            {/* El hint dice ahora contra QUÉ se mide: jugadores activos del
                rango, no el histórico entero. Y añade las repescas jugadas,
                que antes eran invisibles porque stats.last_repesca_at solo
                guarda la última (5 personas podían ser 5 partidas o 35). */}
            <KpiCard
              label="Repesca usage"
              value={pct(data.engagement.repescaUsage.rate)}
              hint={`${data.engagement.repescaUsage.usersUsed}/${data.engagement.repescaUsage.totalUsers} activos · ${data.engagement.repescaUsage.plays} partidas`}
            />
          </div>

          {/* ROW 1.5 · Dificultad global (DDA Arq. A) */}
          {data.difficulty && <GlobalDifficultyCard d={data.difficulty} />}

          {/* ROW 2 · DAU chart (SOLO registrados) */}
          <Card title="Registrados activos por día (DAU)">
            <p className="mb-2 text-[10px] leading-relaxed text-muted">
              Solo usuarios con cuenta. La tabla user_guesses mezcla las dos
              poblaciones desde jul-2026 (el anónimo recibe sesión en su primer
              intento), así que esta serie se filtra por is_anonymous — para el
              total mira la gráfica de abajo.
            </p>
            <DauLineChart series={data.engagement.dauSeries} />
          </Card>

          {/* ROW 2.bis · Jugadores totales (incluye anónimos) */}
          <Card title="Jugadores totales por día (incluye anónimos)">
            <TotalVsRegisteredChart
              total={data.engagement.totalSeries}
              registered={data.engagement.registeredFinishedSeries}
              totalAvg={data.engagement.totalAvg}
              registeredAvg={data.engagement.registeredFinishedAvg}
            />
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

          {/* ROW 3.5 · Uso del ranking (palanca) */}
          <Card title="Uso del ranking (palanca)">
            <RankingUsageCard usage={data.engagement.rankingUsage} />
          </Card>

          {/* ROW 3.6 · De dónde entran: app de Play vs navegador */}
          <Card title="Accesos por plataforma (app vs web)">
            <PlataformasCard p={data.engagement.plataformas} />
          </Card>

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

          {/* ROW 6 · Usuarios registrados (directorio completo) */}
          <Card title="Usuarios registrados">
            <UsersTable
              users={data.users.directory}
              selectedUserId={selectedUser?.id}
              onSelect={(u) => setSelectedUser(u)}
            />
          </Card>

          {/* ROW 7 · Drill-down de usuario */}
          {selectedUser && (
            <Card
              title={`Historial · ${selectedUser.username || maskEmail(selectedUser.email)}`}
              action={
                <div className="flex items-center gap-3">
                  {/* Solo si hay algo que retirar. Un botón que no puede hacer
                      nada es ruido en una cabecera de tarjeta. */}
                  {selectedUser.username && (
                    <button
                      type="button"
                      onClick={retirarNick}
                      disabled={modEnCurso}
                      className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
                    >
                      {modEnCurso ? "Retirando…" : "Retirar nick"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedUser(null)}
                    className="text-xs text-muted hover:text-white"
                  >
                    Cerrar
                  </button>
                </div>
              }
            >
              {modEstado && (
                <p
                  className={`mb-3 text-xs ${
                    modEstado.startsWith("Error") ? "text-rose-300" : "text-emerald-300"
                  }`}
                >
                  {modEstado}
                </p>
              )}
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

// Chart de líneas superpuestas: jugadores TOTALES que completaron el daily
// (daily_stats.total_games, incluye anónimos) vs REGISTRADOS que lo
// completaron (user_guesses con status won/lost). Ambas series comparten base
// ("partidas completadas") y llegan alineadas 1:1 por fecha desde el servidor,
// así que el hueco entre líneas = jugadores anónimos EXACTO (nunca negativo).
// OJO: la línea de registrados aquí NO es la del DAU de arriba (esa cuenta
// "hizo un intento"; esta cuenta "terminó"). Mismo lenguaje visual que
// DauLineChart.
function TotalVsRegisteredChart({ total, registered, totalAvg, registeredAvg }) {
  const W = 600;
  const H = 160;
  const PAD = { top: 10, right: 8, bottom: 22, left: 28 };

  if (!total || total.length === 0) {
    return <div className="py-8 text-center text-sm text-muted">Sin datos.</div>;
  }

  // Escala común a ambas series para que sean comparables a simple vista.
  const maxY = Math.max(
    1,
    ...total.map((d) => d.count),
    ...(registered || []).map((d) => d.count)
  );
  const stepX = (W - PAD.left - PAD.right) / Math.max(1, total.length - 1);

  const toPoints = (series) =>
    (series || []).map((d, i) => {
      const x = PAD.left + i * stepX;
      const y = PAD.top + (H - PAD.top - PAD.bottom) * (1 - d.count / maxY);
      return { x, y, d };
    });

  const totalPts = toPoints(total);
  const regPts = toPoints(registered);

  const toPath = (pts) =>
    pts.reduce(
      (acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`),
      ""
    );

  const totalPath = toPath(totalPts);
  const totalArea =
    totalPath +
    ` L ${totalPts[totalPts.length - 1].x} ${H - PAD.bottom} L ${totalPts[0].x} ${H - PAD.bottom} Z`;
  const regPath = regPts.length ? toPath(regPts) : "";

  const labelStep = Math.max(1, Math.ceil(total.length / 6));

  // Anónimos/día = total − registrados. Ambas series comparten base ("partidas
  // completadas"), así que la resta es exacta (el max(0,..) es solo defensivo
  // ante ruido de redondeo).
  const anonAvg = Math.max(0, (totalAvg || 0) - (registeredAvg || 0));

  return (
    <div>
      {/* Leyenda + medias del periodo */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-white/80">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "#7af0c8" }} />
          Total <span className="font-mono text-white/60">≈ {(totalAvg || 0).toFixed(1)}/día</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-white/60">
          <span className="inline-block h-0.5 w-4 rounded border-t border-dashed" style={{ borderColor: "rgba(255,255,255,0.55)" }} />
          Registrados <span className="font-mono text-white/50">≈ {(registeredAvg || 0).toFixed(1)}/día</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-accent/80">
          Anónimos <span className="font-mono">≈ {anonAvg.toFixed(1)}/día</span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {/* Grid horizontal: techo y suelo */}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} stroke="rgba(255,255,255,0.08)" />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.15)" />
        {/* Etiquetas eje Y: 0 y max */}
        <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">0</text>
        <text x={PAD.left - 6} y={PAD.top} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">{maxY}</text>
        {/* Área bajo el total */}
        <path d={totalArea} fill="rgba(122, 240, 200, 0.10)" />
        {/* Línea de registrados (punteada, tenue) por detrás */}
        {regPath && (
          <path d={regPath} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Línea principal: total */}
        <path d={totalPath} fill="none" stroke="#7af0c8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Puntos del total con tooltip que desglosa registrados/anónimos */}
        {totalPts.map((p, i) => {
          const reg = regPts[i] ? regPts[i].d.count : 0;
          const anon = Math.max(0, p.d.count - reg);
          return (
            <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#7af0c8">
              <title>{`${shortDate(p.d.date)}: ${p.d.count} total · ${reg} reg · ${anon} anón`}</title>
            </circle>
          );
        })}
        {/* Etiquetas eje X */}
        {totalPts.map((p, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={p.x} y={H - PAD.bottom + 14} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">
              {shortDate(p.d.date)}
            </text>
          ) : null
        )}
      </svg>

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        <span className="text-white/70">Total</span> = partidas del daily
        completadas ese día (tabla <code>daily_stats</code>), incluye anónimos y
        registrados. Como cada persona completa un daily al día, equivale al nº
        de jugadores del día. <span className="text-white/70">Registrados</span>{" "}
        = usuarios con cuenta que terminaron el daily; el hueco entre ambas ={" "}
        <span className="text-accent/90">anónimos</span>. (No confundir con el
        DAU de arriba, que cuenta "hizo un intento", no "terminó".) Métrica{" "}
        <span className="text-white/70">retroactiva</span>: usa el histórico ya
        acumulado en daily_stats, sin tracking nuevo.
      </p>
    </div>
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

function UsersTable({ users, selectedUserId, onSelect }) {
  if (!users || users.length === 0) {
    return <div className="py-6 text-center text-sm text-muted">Sin usuarios registrados.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted">
            <th className="pb-2 pr-3">Usuario</th>
            <th className="pb-2 pr-3">Último login</th>
            <th className="pb-2">Registrado</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSel = u.id === selectedUserId;
            // Primera columna: nombre de usuario. Si la cuenta no tiene
            // display_name todavía, caemos al email enmascarado para que la
            // fila siga siendo identificable. El email completo va en `title`
            // (hover) por comodidad del admin.
            return (
              <tr
                key={u.id}
                onClick={() => onSelect(u)}
                className={`cursor-pointer border-t border-white/5 transition-colors ${
                  isSel ? "bg-accent/10" : "hover:bg-white/[0.03]"
                }`}
              >
                <td className="py-2 pr-3 font-semibold text-white/90" title={u.email || ""}>
                  {u.username || maskEmail(u.email)}
                </td>
                <td className="py-2 pr-3 text-white/70">{shortDateTime(u.lastSignInAt)}</td>
                <td className="py-2 text-white/55">{shortDateTime(u.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted">
        {users.length} usuarios · click en una fila para ver su historial de juego.
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

// Card de "uso del ranking": pulsaciones del evento `ranking_open` (contador
// propio en Supabase, tabla feature_events) y su proporción sobre las partidas
// del periodo. El % es un proxy (pulsaciones totales / partidas, no únicos).
function RankingUsageCard({ usage }) {
  if (!usage) {
    return (
      <div className="rounded-lg border border-rose-400/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200/90">
        No se pudo leer el contador de uso del ranking. Revisa los logs del endpoint admin.
      </div>
    );
  }
  if (usage.migrationPending) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-500/[0.05] px-3 py-2 text-xs text-amber-200/90">
        Falta crear la tabla de contadores. Aplica{" "}
        <code className="text-amber-100">scripts/2026-06-feature-events.sql</code> en Supabase y
        las pulsaciones del ranking empezarán a contarse aquí.
      </div>
    );
  }
  const perPlayPct = usage.perPlay == null ? null : usage.perPlay * 100;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniStat label="pulsaciones" value={usage.pulsaciones.toLocaleString("es")} hint="aperturas del ranking" />
        <MiniStat
          label="por partida"
          value={perPlayPct == null ? "—" : `${perPlayPct.toFixed(0)}%`}
          hint={`${usage.activity.toLocaleString("es")} partidas`}
        />
        <MiniStat
          label="logueados / anón"
          value={`${usage.byUser.toLocaleString("es")} / ${usage.byAnon.toLocaleString("es")}`}
          hint="reparto de aperturas"
        />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        "Por partida" = pulsaciones totales / partidas del periodo (daily_stats, incluye
        anónimos). Es un proxy de uso: cuenta aperturas, no usuarios únicos, así que puede
        superar el 100% si la gente abre el ranking varias veces. Útil para ver si la palanca
        se toca, no para % exacto de usuarios.
      </p>
    </div>
  );
}

// Accesos por plataforma. La ÚNICA métrica del panel que sabe distinguir la app
// del navegador: todas las demás mezclan las dos poblaciones sin remedio, porque
// hasta 2026-08 la plataforma solo viajaba a Umami (cuya API es de pago) y a
// Sentry. Ver lib/admin-handlers/analytics.js → fetchPlataformas.
//
// Barras apiladas y no dos líneas: la pregunta es "qué PARTE del uso viene de la
// app", y una proporción se lee mejor apilada que cruzando dos series con
// escalas parecidas.
function PlataformasCard({ p }) {
  if (!p) {
    return (
      <div className="rounded-lg border border-rose-400/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200/90">
        No se pudo leer el contador de plataformas. Revisa los logs del endpoint admin.
      </div>
    );
  }
  if (p.migrationPending) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-500/[0.05] px-3 py-2 text-xs text-amber-200/90">
        Falta la columna de plataforma en el contador. Aplica{" "}
        <code className="text-amber-100">scripts/2026-08-feature-events-plataforma.sql</code>{" "}
        en Supabase y los accesos empezarán a repartirse aquí.
      </div>
    );
  }

  const { series = [], totals, appShare } = p;
  const maxY = Math.max(1, ...series.map((d) => d.app + d.web + d.legacy));
  const hayDatos = totals.app + totals.web + totals.legacy > 0;

  const W = 600;
  const H = 160;
  const PAD = { top: 10, right: 8, bottom: 22, left: 28 };
  const alto = H - PAD.top - PAD.bottom;
  const ancho = W - PAD.left - PAD.right;
  // Barras con un canal de aire entre ellas, con un mínimo para que un rango de
  // 90 días no las deje en nada.
  const paso = ancho / Math.max(1, series.length);
  const anchoBarra = Math.max(1.5, paso * 0.7);
  const labelStep = Math.max(1, Math.ceil(series.length / 6));

  if (!hayDatos) {
    return (
      <div>
        <div className="py-8 text-center text-sm text-muted">
          Sin marcas todavía en este rango.
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Empieza a contar desde el despliegue del evento <code>sesion</code>: el
          histórico anterior no se puede repartir (la plataforma no estaba en la
          base de datos).
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Leyenda + reparto del periodo */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-white/80">
          <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: "#7af0c8" }} />
          App{" "}
          <span className="font-mono text-white/60">
            {totals.app.toLocaleString("es")}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-white/60">
          <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: "rgba(255,255,255,0.35)" }} />
          Web{" "}
          <span className="font-mono text-white/50">
            {totals.web.toLocaleString("es")}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-accent/90">
          Cuota de app{" "}
          <span className="font-mono">
            {appShare == null ? "—" : `${(appShare * 100).toFixed(0)}%`}
          </span>
        </span>
        {totals.legacy > 0 && (
          <span className="inline-flex items-center gap-1.5 text-white/40">
            <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: "rgba(255,255,255,0.15)" }} />
            Sin identificar{" "}
            <span className="font-mono">{totals.legacy.toLocaleString("es")}</span>
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} stroke="rgba(255,255,255,0.08)" />
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.15)" />
        <text x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">0</text>
        <text x={PAD.left - 6} y={PAD.top} textAnchor="end" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="10">{maxY}</text>

        {series.map((d, i) => {
          const x = PAD.left + i * paso + (paso - anchoBarra) / 2;
          const base = H - PAD.bottom;
          // De abajo arriba: app, web, sin identificar. La app abajo porque es
          // la serie que se mira, y apoyada en el eje se compara sin esfuerzo.
          const hApp = (d.app / maxY) * alto;
          const hWeb = (d.web / maxY) * alto;
          const hLeg = (d.legacy / maxY) * alto;
          const total = d.app + d.web + d.legacy;
          const cuota = d.app + d.web > 0 ? (d.app / (d.app + d.web)) * 100 : null;
          return (
            <g key={d.date}>
              {hLeg > 0 && (
                <rect x={x} y={base - hApp - hWeb - hLeg} width={anchoBarra} height={hLeg} fill="rgba(255,255,255,0.15)" />
              )}
              {hWeb > 0 && (
                <rect x={x} y={base - hApp - hWeb} width={anchoBarra} height={hWeb} fill="rgba(255,255,255,0.35)" />
              )}
              {hApp > 0 && (
                <rect x={x} y={base - hApp} width={anchoBarra} height={hApp} fill="#7af0c8" />
              )}
              {/* Zona de hover a toda la altura: con barras de 2px de ancho, un
                  <title> solo sobre el relleno es imposible de atinar. */}
              <rect x={PAD.left + i * paso} y={PAD.top} width={paso} height={alto} fill="transparent">
                <title>
                  {`${shortDate(d.date)}: ${d.app} app · ${d.web} web` +
                    (d.legacy ? ` · ${d.legacy} s/i` : "") +
                    (cuota == null ? "" : ` — ${cuota.toFixed(0)}% app`) +
                    ` (${total} disp.)`}
                </title>
              </rect>
            </g>
          );
        })}

        {series.map((d, i) =>
          i % labelStep === 0 ? (
            <text key={d.date} x={PAD.left + i * paso + paso / 2} y={H - PAD.bottom + 14} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="10">
              {shortDate(d.date)}
            </text>
          ) : null
        )}
      </svg>

      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        Unidad: <span className="text-white/70">dispositivos-día</span>, no
        personas — el cliente marca una vez por dispositivo y día, así que dos
        navegadores del mismo humano cuentan dos. Lo fiable es la{" "}
        <span className="text-accent/90">proporción</span>.{" "}
        <span className="text-white/70">Sin identificar</span> = filas anteriores
        a la migración y APKs sin actualizar; queda fuera del cálculo de la cuota
        para que actualizar despacio no parezca una caída de uso. Empieza a
        contar desde el despliegue: el histórico previo no se puede repartir.
      </p>
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
