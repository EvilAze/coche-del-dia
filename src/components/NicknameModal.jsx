import { useState } from "react";
import { saveDisplayName } from "../hooks/useStats";
import { useT } from "../i18n";
import ModalShell from "./ModalShell";

export default function NicknameModal({ open, onSaved }) {
  const { t } = useT();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    const clean = displayName.trim();

    if (!/^[A-Za-z0-9]{1,12}$/.test(clean)) {
      setError(t("nickname.errorFormat"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const profile = await saveDisplayName(clean);
      onSaved(profile);
    } catch (err) {
      // Mapeamos códigos conocidos a strings traducidos; si no, mostramos el
      // mensaje crudo del backend o un genérico de save.
      let msg;
      if (err?.code === "DUPLICATE_DISPLAY_NAME") msg = t("nickname.errorDuplicate");
      else if (err?.code === "DISPLAY_NAME_LOCKED") msg = t("nickname.errorLocked");
      else msg = err?.message || t("nickname.errorSave");
      setError(msg);
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
          {t("nickname.tag")}
        </p>

        <h2 className="mt-2 font-display text-3xl tracking-widest text-white">
          {t("nickname.title")}
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          {t("nickname.description")}
        </p>

        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-200/90">
          {t("nickname.permanentWarning")}
        </p>

        <input
          autoFocus
          value={displayName}
          maxLength={12}
          onChange={(e) => {
            setDisplayName(e.target.value.replace(/[^A-Za-z0-9]/g, ""));
            setError("");
          }}
          placeholder={t("nickname.placeholder")}
          className="
            mt-5 h-12 w-full rounded-xl border border-white/10
            bg-black/40 px-4 text-center font-display text-2xl
            uppercase tracking-widest text-white outline-none
            placeholder:text-white/20 focus:border-accent
          "
        />

        <div className="mt-2 text-[10px] uppercase tracking-widest text-muted">
          {t("nickname.rules")}
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
          {saving ? t("nickname.saving") : t("nickname.submit")}
        </button>
      </form>
    </ModalShell>
  );
}
