// src/admin/EstadoStrip.jsx
// LA TIRA DE ESTADO del panel: los tres precipicios del juego, siempre a la
// vista. Vive en el shell (AdminTools) y no dentro de una pestaña a propósito —
// las tres cosas que vigila se rompen despacio y por olvido, así que un panel
// que solo las enseña cuando entras a buscarlas no sirve de nada.
//
// Qué vigila y por qué (el detalle está en
// scripts/2026-08-estado-operativo.sql):
//   · Autonomía  — coches con foto y sin estrenar. Es literalmente cuántos días
//                  de juego quedan antes de que pick_daily_car empiece a
//                  repetir coches en silencio.
//   · Fotos      — días ya programados cuyo coche no tiene imagen. Cada uno es
//                  una jornada de /api/daily-image devolviendo 500. Ya pasó
//                  tres veces seguidas al final de la temporada de Le Mans.
//   · Temporada  — cuánto queda de la actual y si existe la siguiente. Sin
//                  siguiente, current_season() da NULL y la clasificación sale
//                  vacía y sin banner.
//
// EN REPOSO NO GRITA. Con todo en orden es una línea gris de datos; el color
// solo aparece cuando hay algo que hacer. Un cuadro de mandos que avisa siempre
// deja de leerse en una semana, que es justo lo que le pasaría a este.

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

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

const COLOR = {
  rojo: "text-rose-300",
  ambar: "text-amber-300",
  ok: "text-white/85",
};

// Un dato de la tira: rótulo pequeño arriba, cifra debajo. El color lo pone el
// veredicto que ya viene resuelto del servidor (lib/admin-handlers/estado.js),
// porque los umbrales son política y no presentación.
function Dato({ rotulo, valor, nivel = "ok", sufijo }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted">{rotulo}</p>
      <p className={`font-mono text-sm ${COLOR[nivel] || COLOR.ok}`}>
        {valor}
        {sufijo ? <span className="text-[10px] text-muted"> {sufijo}</span> : null}
      </p>
    </div>
  );
}

export default function EstadoStrip({ refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/admin/estado")
      .then((json) => { if (!cancelled) { setData(json); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Error"); });
    return () => { cancelled = true; };
    // refreshKey: el shell lo incrementa al guardar un coche o tocar el
    // calendario, que son justo las dos acciones que mueven estas cifras.
  }, [refreshKey]);

  // Mientras carga no se reserva sitio ni se pinta un esqueleto: la tira es
  // contexto, no contenido, y un salto de maqueta en la cabecera del panel
  // molesta más que llegar 300 ms tarde.
  if (error) {
    return (
      <p className="border-b border-border py-2 text-[10px] text-rose-300">
        Estado no disponible: {error}
      </p>
    );
  }
  if (!data) return null;

  const { catalogo, calendario, temporada, avisos } = data;

  // Los avisos con texto, en orden de gravedad. Es lo único que se lee si hay
  // prisa: las cifras de arriba son el detalle.
  const alertas = [avisos.fotos, avisos.temporada, avisos.autonomia].filter(
    (a) => a && a.nivel !== "ok" && a.texto
  );

  return (
    <div className="border-b border-border py-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <Dato
          rotulo="Autonomía"
          valor={catalogo.sinEstrenar}
          sufijo="días"
          nivel={avisos.autonomia.nivel}
        />
        <Dato rotulo="Borradores" valor={catalogo.borradores} sufijo="sin foto" />
        <Dato
          rotulo="Programados"
          valor={calendario.diasProgramados}
          sufijo="días"
          nivel={avisos.fotos.nivel}
        />
        <Dato
          rotulo={temporada.numero ? `Temporada ${temporada.numero}` : "Temporada"}
          valor={
            temporada.diasRestantes == null ? "—" : temporada.diasRestantes
          }
          sufijo={temporada.diasRestantes == null ? "ninguna" : "días"}
          nivel={avisos.temporada.nivel}
        />
        <Dato
          rotulo="Siguiente"
          valor={temporada.siguienteNumero ? `T${temporada.siguienteNumero}` : "—"}
          sufijo={temporada.siguienteInicio || "sin programar"}
          nivel={avisos.temporada.nivel === "rojo" ? "rojo" : "ok"}
        />
      </div>

      {alertas.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {alertas.map((a, i) => (
            <li key={i} className={`text-[11px] ${COLOR[a.nivel]}`}>
              {a.texto}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
