// src/admin/DescriptionEsField.jsx
// Gemelo de DescriptionEnField para la descripción en español: textarea con
// botón "Generar con IA" que llama a /api/admin/describe-car (Claude Sonnet 5
// con búsqueda web). El admin siempre puede editar el resultado antes de
// guardar — el botón rellena el formulario, no guarda nada.
//
// Vive aparte (y no inline en cada panel) porque AddCarPanel y EditCarPanel
// nombran sus campos distinto (make/model/year vs marca/modelo/anio): el
// componente unifica esa diferencia en una sola interfaz.
//
// Props:
//   value        string · descripción ES actual (controlada por el padre)
//   onChange(v)  fn     · setter del padre al editar / tras generar
//   marca        string · identidad del coche para el prompt
//   modelo       string ·
//   anio         string|number · opcional
//   pais         string · opcional
//   disabled     bool   · estado de submitting del padre
//   inputClass   string · clases del textarea, consistentes con el resto del form

import { useState } from "react";
import { supabase } from "../supabaseClient";

const MAX_LEN = 600;

export default function DescriptionEsField({
  value = "",
  onChange,
  // Defaults a cadena vacía: un null llegado de la fila de la BD reventaría el
  // .trim() de abajo y con él el panel entero. Un botón deshabilitado es un
  // fallo mucho más barato.
  marca = "",
  modelo = "",
  anio = "",
  pais = "",
  disabled = false,
  inputClass = "",
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Sin marca y modelo el endpoint responde 400: mejor no dejar pulsar.
  const tieneIdentidad = marca.trim().length > 0 && modelo.trim().length > 0;
  const canGenerate = tieneIdentidad && !generating && !disabled;

  async function handleGenerate() {
    setError("");
    if (!canGenerate) return;

    // Un clic accidental no debe borrar algo escrito a mano.
    if (value.trim() && !window.confirm("Se reemplazará la descripción actual. ¿Seguir?")) {
      return;
    }

    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sesión perdida. Vuelve a iniciar sesión.");

      const res = await fetch("/api/admin/describe-car", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ marca, modelo, anio, pais }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      if (typeof body.descripcion !== "string" || !body.descripcion) {
        throw new Error("Respuesta vacía de la IA.");
      }
      onChange(body.descripcion);
    } catch (err) {
      console.error("[DescriptionEsField] generate:", err);
      setError(err?.message || "Error generando la descripción.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Un párrafo corto sobre el coche: anécdotas, datos curiosos, contexto histórico..."
        maxLength={MAX_LEN}
        rows={4}
        disabled={disabled}
        className={`${inputClass} h-auto resize-y py-3 leading-relaxed`}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {value.length} / {MAX_LEN}
        </span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          title={
            tieneIdentidad
              ? "Redacta la descripción documentándose en la web"
              : "Rellena marca y modelo primero"
          }
          className="
            rounded-md border border-accent/40 bg-accent/10
            px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent
            transition hover:border-accent hover:bg-accent/20
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          {generating ? "Buscando y redactando..." : "Generar con IA"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
