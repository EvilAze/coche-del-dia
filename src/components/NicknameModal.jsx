// src/components/NicknameModal.jsx
// Elegir (o cambiar) la firma que aparece en la clasificación.
//
// ANTES ERA UN PEAJE. Este modal se abría solo en cuanto detectaba a un usuario
// logueado sin display_name, no se podía cerrar (ni scrim, ni Escape, ni la
// «atrás») y bloqueaba el juego entero. O sea: el jugador acababa de decidir
// crear cuenta —el momento de máxima buena voluntad de toda su vida como
// usuario— y lo primero que recibía era un formulario obligatorio pidiéndole
// una decisión irreversible.
//
// Y sobraba, porque el nick NO hace falta para jugar: `display_name` solo lo usa
// la clasificación (las SQL de temporada filtran `WHERE p.display_name IS NOT
// NULL`). Jugar, la racha, las estadísticas, el Archivo y los logros funcionan
// sin él. Se bloqueaba el juego completo por el requisito de UNA función.
//
// Ahora: no se abre solo nunca. Se pide donde el nick significa algo —al abrir
// la clasificación y al ganar— y se puede cerrar. El «permanente» también se
// fue (ver saveDisplayName en lib/statsService.js), así que este mismo modal
// sirve para estrenar firma y para cambiarla.

import { useEffect, useState } from "react";
import { saveDisplayName } from "../lib/statsService";
import { useT } from "../i18n";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";

export default function NicknameModal({ open, onClose, onSaved, valorActual = null }) {
  const { t } = useT();
  const editando = Boolean(valorActual);
  const [displayName, setDisplayName] = useState(valorActual || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Al abrir, partimos del nick vigente (si lo hay): cambiar «MAX» por «MAX2»
  // no debería obligar a reteclearlo entero.
  useEffect(() => {
    if (open) {
      setDisplayName(valorActual || "");
      setError("");
    }
  }, [open, valorActual]);

  // La «atrás» de Android ya la cubre el useHistoryClose GLOBAL de App.jsx, que
  // actúa sobre el slot `activeModal` — y este modal ya vive en ese slot (antes
  // no: se abría por estado derivado propio y quedaba fuera). Poner aquí un
  // segundo trap dejaría dos entradas de historial peleándose por la misma
  // pulsación, que es justo el fallo que documenta App.jsx para el Archivo.

  async function handleSubmit(e) {
    e.preventDefault();

    const clean = displayName.trim();

    if (!/^[A-Za-z0-9]{1,12}$/.test(clean)) {
      setError(t("nickname.errorFormat"));
      return;
    }

    // Cambiar por el mismo nick no es un error, pero tampoco es una petición:
    // cerramos sin tocar la base de datos.
    if (editando && clean === valorActual) {
      onClose?.();
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
      const msg =
        err?.code === "DUPLICATE_DISPLAY_NAME"
          ? t("nickname.errorDuplicate")
          : err?.message || t("nickname.errorSave");
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[120] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm p-6 text-center"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} />
      </div>

      <form onSubmit={handleSubmit}>
        <p className="pm-kicker">{t("nickname.tag")}</p>

        <h2 className="pm-title mt-2">
          {editando ? t("nickname.titleChange") : t("nickname.title")}
        </h2>

        <p className="pm-body mt-3">{t("nickname.description")}</p>

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
          {saving ? t("nickname.saving") : editando ? t("nickname.submitChange") : t("nickname.submit")}
        </button>
      </form>
    </ModalShell>
  );
}
