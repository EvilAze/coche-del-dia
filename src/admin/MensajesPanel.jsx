// src/admin/MensajesPanel.jsx
// La bandeja: lo que los jugadores escriben desde la app.
//
// Nace de querer «ver los correos sin abrir el correo». No lee el buzón de
// soporte@ —ImprovMX reenvía, no almacena, así que esos correos no existen en
// ningún servidor nuestro— sino los mensajes que se escriben DENTRO del juego,
// que además llegan atados a un user_id y por tanto identificados.
//
// Sin leer por defecto. Una bandeja que abre en «todos» es un archivo; abre en
// «lo que me falta» y es una lista de tareas, que es para lo que se abre.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { maskEmail } from "./Identidad";

const TIPO = {
  problema: { etiqueta: "Problema", clase: "bg-rose-500/15 text-rose-300" },
  reporte: { etiqueta: "Reporte", clase: "bg-amber-500/15 text-amber-300" },
  sugerencia: { etiqueta: "Sugerencia", clase: "bg-sky-500/15 text-sky-300" },
};

async function authFetch(path, opciones = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("No session");
  const res = await fetch(path, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.body ? { "Content-Type": "application/json" } : {}),
      ...(opciones.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function fechaHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function MensajesPanel({ onSinLeer }) {
  const [estado, setEstado] = useState("sin_leer");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marcando, setMarcando] = useState(null);

  const cargar = useCallback(() => {
    setLoading(true);
    setError("");
    return authFetch(`/api/admin/mensajes?estado=${estado}`)
      .then((json) => {
        setData(json);
        onSinLeer?.(json.sinLeer ?? 0);
      })
      .catch((err) => setError(err.message || "Error cargando mensajes"))
      .finally(() => setLoading(false));
  }, [estado, onSinLeer]);

  useEffect(() => { cargar(); }, [cargar]);

  async function alternarLeido(m) {
    if (marcando) return;
    setMarcando(m.id);
    try {
      await authFetch("/api/admin/mensajes", {
        method: "POST",
        body: JSON.stringify({ id: m.id, leido: !m.leido_en }),
      });
      await cargar();
    } catch (err) {
      setError(err.message || "No se pudo marcar");
    } finally {
      setMarcando(null);
    }
  }

  if (loading && !data) {
    return <div className="py-10 text-center text-sm text-muted">Cargando…</div>;
  }
  if (error) {
    return <div className="py-10 text-center text-sm text-rose-300">{error}</div>;
  }
  if (data?.migrationPending) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-4 text-xs text-amber-200">
        Falta aplicar <span className="font-mono">scripts/2026-08-buzon-de-mensajes.sql</span> en
        Supabase. Hasta entonces el buzón no existe y esta pestaña está vacía.
      </div>
    );
  }

  const mensajes = data?.mensajes || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl tracking-widest text-white">Buzón</h2>
          <p className="mt-1 text-xs text-muted">
            Lo que se escribe desde la app. El correo de soporte@ sigue yendo a tu cuenta.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-bg-secondary/40 p-1">
          {[
            ["sin_leer", `Sin leer (${data?.sinLeer ?? 0})`],
            ["todos", "Todos"],
          ].map(([id, etiqueta]) => (
            <button
              key={id}
              type="button"
              onClick={() => setEstado(id)}
              className={`rounded px-2.5 py-1 text-xs ${
                estado === id ? "bg-accent/20 text-white" : "text-muted hover:text-white"
              }`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {mensajes.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-secondary/40 p-6 text-center text-xs text-muted">
          {estado === "sin_leer" ? "Nada pendiente." : "Todavía no ha escrito nadie."}
        </div>
      ) : (
        <ul className="space-y-2">
          {mensajes.map((m) => {
            const tipo = TIPO[m.tipo] || { etiqueta: m.tipo, clase: "bg-white/10 text-white/70" };
            // Para contestar: el correo que TECLEÓ manda sobre el de su cuenta
            // (si se molestó en escribir otro, será por algo). El de la cuenta
            // queda debajo como respaldo.
            const responder = m.email || m.emailCuenta;
            return (
              <li
                key={m.id}
                className={`rounded-xl border p-3 ${
                  m.leido_en ? "border-border bg-transparent" : "border-border-strong bg-bg-secondary/40"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className={`rounded px-1.5 py-0.5 uppercase tracking-wider ${tipo.clase}`}>
                    {tipo.etiqueta}
                  </span>
                  {/* Nick Y cuenta. El nick es con lo que se le conoce en el
                      juego; el correo de la cuenta es con lo que se le busca en
                      Analítica o Auditoría. Enseñar solo uno obligaba a
                      adivinar el otro. Enmascarado, como en el resto del panel
                      (ver ./Identidad): entero en el `title` y en el enlace de
                      respuesta de abajo. */}
                  <span className="font-semibold text-white/90" title={m.emailCuenta || ""}>
                    {m.nick || "sin nick"}
                  </span>
                  {m.emailCuenta && (
                    <span className="text-muted">{maskEmail(m.emailCuenta)}</span>
                  )}
                  <span className="text-muted">{fechaHora(m.creado_en)}</span>
                  <span className="text-muted">· {m.plataforma || "?"}</span>
                  <button
                    type="button"
                    onClick={() => alternarLeido(m)}
                    disabled={marcando === m.id}
                    className="ml-auto text-[10px] uppercase tracking-wider text-muted hover:text-white disabled:opacity-50"
                  >
                    {marcando === m.id ? "…" : m.leido_en ? "Marcar sin leer" : "Marcar leído"}
                  </button>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-xs text-white/85">{m.cuerpo}</p>

                {responder && (
                  <a
                    href={`mailto:${responder}?subject=${encodeURIComponent("Coche del Día")}`}
                    className="mt-2 inline-block text-[11px] text-accent hover:underline"
                  >
                    Responder a {responder}
                  </a>
                )}
                {!responder && (
                  <p className="mt-2 text-[10px] text-muted">
                    Sin dirección de respuesta (anónimo y no dejó correo).
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
