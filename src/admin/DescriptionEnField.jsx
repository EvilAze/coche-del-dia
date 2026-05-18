// src/admin/DescriptionEnField.jsx
// Componente compartido por AddCar y EditCar: textarea para la descripción
// en inglés, con botón "Traducir desde ES" que llama a /api/admin/translate
// (DeepL). El admin siempre puede editar la traducción antes de guardar.
//
// Props:
//   valueEs       string · la descripción ES actual del form (fuente)
//   valueEn       string · valor del textarea EN (controlado por el padre)
//   onChange(v)   fn     · setter del padre cuando el admin edita / tras
//                          autotraducir
//   disabled      bool   · pasa estado de submitting al textarea/botón
//   inputClass    string · clases tailwind del textarea (consistentes con
//                          el resto del form del admin)

import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function DescriptionEnField({
  valueEs,
  valueEn,
  onChange,
  disabled = false,
  inputClass = "",
}) {
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");

  const canTranslate = valueEs.trim().length > 0 && !translating && !disabled;

  async function handleTranslate() {
    setError("");
    const text = valueEs.trim();
    if (!text) return;

    setTranslating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sesión perdida. Vuelve a iniciar sesión.");

      const res = await fetch("/api/admin/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text, source: "ES", target: "EN" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      if (typeof body.translated !== "string") {
        throw new Error("Respuesta vacía del traductor.");
      }
      onChange(body.translated);
    } catch (err) {
      console.error("[DescriptionEnField] translate:", err);
      setError(err?.message || "Error traduciendo.");
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={valueEn}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Translated description. Use the button below to auto-translate from Spanish; you can edit the result afterwards."
        maxLength={600}
        rows={4}
        disabled={disabled}
        className={`${inputClass} h-auto resize-y py-3 leading-relaxed`}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {valueEn.length} / 600
        </span>
        <button
          type="button"
          onClick={handleTranslate}
          disabled={!canTranslate}
          className="
            rounded-md border border-accent/40 bg-accent/10
            px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent
            transition hover:border-accent hover:bg-accent/20
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          {translating ? "Traduciendo..." : "Traducir desde ES"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
