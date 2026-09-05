// src/admin/FichaRendimiento.jsx
// La ficha de rendimiento de un coche: cuánta gente lo jugó, qué porcentaje
// acertó y EN QUÉ INTENTO cayó.
//
// El histograma es lo que justifica la ficha entera. Dos coches con el mismo
// 82% de acierto son cosas opuestas si en uno la moda cae en el primer intento
// (lo adivinaron de reojo) y en otro en el quinto (sufrieron hasta el final), y
// ese matiz no cabe en ningún promedio.
//
// Este componente NO calcula: las métricas y el veredicto vienen resueltos de
// /api/admin/car-report, porque los umbrales son política y no presentación
// (mismo criterio que estado.js). Aquí solo se elige el color del nivel.

const COLOR_VEREDICTO = {
  facil: "text-amber-300",
  dificil: "text-rose-300",
  equilibrado: "text-emerald-300",
  desconocido: "text-muted",
};

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num1 = (v) => (v == null ? "—" : v.toFixed(1));

function Cifra({ rotulo, valor }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5 text-center">
      <div className="font-display text-sm text-white">{valor}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted">{rotulo}</div>
    </div>
  );
}

// Histograma de en qué intento cayó. Alturas en % sobre la barra más alta, no
// sobre el total: con 34 partidas repartidas en seis cajas, escalar sobre el
// total deja todas las barras a ras de suelo y no se lee nada.
function Histograma({ intentos, fallos }) {
  const barras = [
    ...intentos.map((n, i) => ({ etiqueta: `${i + 1}º`, n, perdida: false })),
    { etiqueta: "falló", n: fallos, perdida: true },
  ];
  const maximo = Math.max(...barras.map((b) => b.n), 1);

  return (
    <div className="mt-2">
      <div className="grid grid-cols-6 gap-1.5">
        {barras.map((b) => (
          <div key={b.etiqueta} className="flex h-20 flex-col justify-end gap-1">
            <div className="text-center font-mono text-[10px] text-white/70">{b.n}</div>
            <div
              className={`rounded-t-sm ${b.perdida ? "bg-rose-400/70" : "bg-emerald-400/60"}`}
              style={{ height: `${Math.max((b.n / maximo) * 100, 2)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-6 gap-1.5 border-t border-white/10 pt-1">
        {barras.map((b) => (
          <div key={b.etiqueta} className="text-center font-mono text-[9px] text-muted">
            {b.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FichaRendimiento({ ficha, cargando, error }) {
  if (cargando) {
    return <p className="mt-2 text-[11px] text-muted">Cargando la ficha…</p>;
  }
  if (error) {
    // Honesto: mejor decir que no se pudo leer que pintar ceros que parecerían
    // un resultado real.
    return (
      <p className="mt-2 text-[11px] text-rose-300">
        No se pudo leer la ficha: {error}
      </p>
    );
  }
  if (!ficha) return null;

  const { emitido, emisiones, enCurso, diario, repesca, veredicto: v, costeObjetivo } = ficha;

  if (!emitido) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-muted">
          Este coche aún no ha salido como coche del día, así que no hay nada
          medido. Aparecerá aquí en cuanto se juegue.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          Ficha de rendimiento
        </span>
        <span className="font-mono text-[10px] text-muted">
          {new Date(emitido).toLocaleDateString("es")}
          {emisiones > 1 ? ` · ${emisiones} emisiones` : ""}
        </span>
      </div>

      {enCurso && (
        <p className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">
          Se está jugando ahora mismo: las cifras son parciales y cambiarán
          hasta medianoche.
        </p>
      )}

      {diario.partidas === 0 ? (
        <p className="text-[11px] text-muted">
          Todavía no ha terminado ninguna partida.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Cifra rotulo="partidas" valor={diario.partidas.toLocaleString("es")} />
            <Cifra rotulo="acierto" valor={pct(diario.winRate)} />
            <Cifra rotulo="intento medio" valor={num1(diario.intentoMedio)} />
            <Cifra rotulo="en ≤3" valor={pct(diario.pBy3)} />
          </div>

          <Histograma intentos={diario.intentos} fallos={diario.fallos} />

          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px]">
            <span className={COLOR_VEREDICTO[v.nivel] || COLOR_VEREDICTO.desconocido}>
              {v.texto}
            </span>
            <span className="font-mono text-muted">
              coste {num1(diario.coste)} · objetivo {costeObjetivo.toFixed(1)}
            </span>
          </div>
        </>
      )}

      {repesca.partidas > 0 && (
        <div className="border-t border-white/10 pt-2 text-[10px] text-muted">
          Repesca: <span className="text-white/80">{repesca.partidas}</span> partidas
          {" · "}
          <span className="text-white/80">{repesca.aciertos}</span> aciertos
          {" · "}
          <span className="text-white/80">
            {pct(repesca.aciertos / repesca.partidas)}
          </span>
          <span className="text-muted/70"> — solo registrados, un intento</span>
        </div>
      )}
    </div>
  );
}
