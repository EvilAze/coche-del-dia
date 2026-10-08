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
// NULL`). Jugar, la racha, las estadísticas y el Archivo funcionan sin él. Se bloqueaba el juego completo por el requisito de UNA función.
//
// Ahora: no se abre solo nunca. Se pide donde el nick significa algo —al abrir
// la clasificación y al ganar— y se puede cerrar. El «permanente» también se
// fue (ver saveDisplayName en lib/statsService.js), así que este mismo modal
// sirve para estrenar firma y para cambiarla.

import { useEffect, useState } from "react";
import { saveDisplayName } from "../lib/statsService";
import { filtrarNick, limpiarNick, nickValido, NICK_MAX } from "../lib/nickname";
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

    const clean = limpiarNick(displayName);

    if (!nickValido(clean)) {
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
      // El nick duplicado es el único caso que el jugador puede ARREGLAR, y por
      // eso tiene su propia frase: le dice que elija otro.
      //
      // El resto va al genérico. Antes caía a `err.message`, o sea el mensaje
      // crudo del backend o el del navegador si fallaba la red («Failed to
      // fetch», en inglés pase lo que pase) — impreso bajo un campo de un
      // formulario, donde se lee como si lo hubiera provocado lo que acabas de
      // teclear. Y encima no se registraba en ningún sitio: el `catch` lo
      // recibía y lo tiraba, así que un fallo al guardar la firma no dejaba
      // rastro para depurar.
      console.error("[NicknameModal] fallo guardando la firma", err);
      setError(
        err?.code === "DUPLICATE_DISPLAY_NAME"
          ? t("nickname.errorDuplicate")
          : t("nickname.errorSave")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={editando ? t("nickname.titleChange") : t("nickname.title")}
      backdropClassName="modal-scrim fixed inset-0 z-dialogo-sobre flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      <form onSubmit={handleSubmit} className="dlg">
        <div className="dlg-cab">
          <h2 className="dlg-titulo">
            {editando ? t("nickname.titleChange") : t("nickname.title")}
          </h2>
          <CloseButton onClick={onClose} />
        </div>

        <p className="dlg-texto">{t("nickname.description")}</p>

        <input
          autoFocus
          value={displayName}
          maxLength={NICK_MAX}
          onChange={(e) => {
            setDisplayName(filtrarNick(e.target.value));
            setError("");
          }}
          placeholder={t("nickname.placeholder")}
          // El error queda ATADO al campo. Sin esto era un párrafo suelto
          // debajo: quien va con lector de pantalla enviaba, no oía nada y se
          // quedaba esperando, porque el foco sigue en el campo y el campo no
          // decía que hubiera pasado nada.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "nickname-error" : undefined}
          // La firma se escribe en la letra en la que se va a LEER: la de los
          // nombres de la clasificación, en mayúsculas.
          className="dlg-input dlg-firma"
        />

        <p className="dlg-nota">{t("nickname.rules")}</p>

        {/* `role="alert"` para que se anuncie al aparecer: es la respuesta al
            envío, y llega cuando el foco ya no se mueve de sitio. */}
        {error && (
          <p id="nickname-error" role="alert" className="dlg-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="pm-btn"
        >
          {saving ? t("nickname.saving") : editando ? t("nickname.submitChange") : t("nickname.submit")}
        </button>
      </form>
    </ModalShell>
  );
}
