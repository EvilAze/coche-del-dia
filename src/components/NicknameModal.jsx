import { useState } from "react";
import { saveDisplayName } from "../lib/statsService";
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
      // Mapeamos cÃ³digos conocidos a strings traducidos; si no, mostramos el
      // mensaje crudo del backend o un genÃ©rico de save.
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
    // logueado. Cerrar tocando fuera dejarÃ­a al usuario en un estado raro
    // (logueado pero sin display_name) que el resto del flujo ya esquiva.
    <ModalShell
      open={open}
      // Sin onClose: este modal no se cierra hasta que onSaved se llama
      // tras un guardado exitoso. El padre lo controla con `open`.
      onClose={() => {}}
      dismissOnBackdrop={false}
      backdropClassName="modal-scrim fixed inset-0 z-[120] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat w-full max-w-sm p-6 text-center"
    >
      <form onSubmit={handleSubmit}>
        <p className="pm-kicker">{t("nickname.tag")}</p>

        <h2 className="pm-title mt-2">{t("nickname.title")}</h2>

        <p className="pm-body mt-3">{t("nickname.description")}</p>

        {/* Aviso "permanente": filete de tinta discontinuo, no tinte ámbar */}
        <p className="pm-body mt-3 border border-dashed border-tinta px-3 py-2 text-xs">
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
            mt-5 h-12 w-full rounded-none border-b border-tinta
            bg-transparent px-2 text-center font-courier text-2xl
            uppercase tracking-widest text-tinta outline-none
            placeholder:text-tinta-2/50 focus:border-rojo
          "
        />

        <div className="pm-label mt-2 !text-[10px]">{t("nickname.rules")}</div>

        {error && <p className="pm-body mt-3 text-sm text-rojo">{error}</p>}

        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="pm-btn mt-5"
        >
          {saving ? t("nickname.saving") : t("nickname.submit")}
        </button>
      </form>
    </ModalShell>
  );
}
