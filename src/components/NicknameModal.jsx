import { useState } from "react";
import { saveDisplayName } from "../hooks/useStats";
import ModalShell from "./ModalShell";

export default function NicknameModal({ open, onSaved }) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    const clean = displayName.trim();

    if (!/^[A-Za-z0-9]{1,12}$/.test(clean)) {
      setError("Solo letras y números. Máximo 12 caracteres.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const profile = await saveDisplayName(clean);
      onSaved(profile);
    } catch (err) {
      setError(err.message || "No se pudo guardar el nickname.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // dismissOnBackdrop=false: el nickname es obligatorio antes de jugar
    // logueado. Cerrar tocando fuera dejaría al usuario en un estado raro
    // (logueado pero sin display_name) que el resto del flujo ya esquiva.
    <ModalShell
      open={open}
      // Sin onClose: este modal no se cierra hasta que onSaved se llama
      // tras un guardado exitoso. El padre lo controla con `open`.
      onClose={() => {}}
      dismissOnBackdrop={false}
      backdropClassName="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 px-4 backdrop-blur-md"
      panelClassName="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] p-6 text-center shadow-2xl"
    >
      <form onSubmit={handleSubmit}>
        <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Nuevo piloto
        </p>

        <h2 className="mt-2 font-display text-3xl tracking-widest text-white">
          Elige tu Nick
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          Este será tu nombre en el ranking arcade. No usaremos tu nombre ni tu foto de Google.
        </p>

        <input
          autoFocus
          value={displayName}
          maxLength={12}
          onChange={(e) => {
            setDisplayName(e.target.value.replace(/[^A-Za-z0-9]/g, ""));
            setError("");
          }}
          placeholder="MAX12"
          className="
            mt-5 h-12 w-full rounded-xl border border-white/10
            bg-black/40 px-4 text-center font-display text-2xl
            uppercase tracking-widest text-white outline-none
            placeholder:text-white/20 focus:border-accent
          "
        />

        <div className="mt-2 text-[10px] uppercase tracking-widest text-muted">
          Letras y números
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="
            mt-5 h-12 w-full rounded-xl bg-accent font-display
            text-lg tracking-widest text-bg-primary transition
            hover:bg-accent-dark active:scale-[0.98]
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          {saving ? "Guardando..." : "Entrar"}
        </button>
      </form>
    </ModalShell>
  );
}
