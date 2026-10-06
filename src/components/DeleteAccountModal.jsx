// src/components/DeleteAccountModal.jsx
// Confirmación del borrado de cuenta. Se abre desde el carnet (MyStats).
//
// DOS PASOS, y no por ceremonia: el primero explica qué se va y qué se queda,
// el segundo obliga a mover el dedo otra vez a un botón distinto. Un borrado
// irreversible no puede estar a UNA pulsación de la pantalla de ajustes, que es
// donde vive el botón de cerrar sesión con el que se confunde.
//
// LO QUE SE CUENTA ES LO QUE PASA. La tentación era escribir «se borrará todo»
// porque suena rotundo; sería mentira. Las partidas se quedan, sin nombre
// detrás, para que los podios de meses ya cerrados no cambien de campeón al
// recalcularse (ver la cabecera de api/delete-account.js). Decirlo aquí, en el
// modal, es la diferencia entre informar y hacer firmar a ciegas.
//
// El rojo de rotativa es el color de acción del sistema y aquí hace además de
// aviso: es el único sitio de la app donde un botón rojo destruye algo. No hay
// tinte de fondo ni glow — el filete y la palabra bastan.

import { useState } from "react";
import { useT } from "../i18n";
import { useEscape } from "../hooks/useEscape";
import { haptic } from "../lib/haptics";
import { eliminarCuenta } from "../lib/deleteAccount";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";

export default function DeleteAccountModal({ open, onClose }) {
  const { t } = useT();
  // "aviso" → explicación; "confirmar" → el punto de no retorno.
  const [paso, setPaso] = useState("aviso");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState("");

  // Con el borrado en marcha, ni Escape ni la X: a mitad de las cinco llamadas
  // del servidor, cerrar el modal solo sirve para no enterarse del resultado.
  useEscape(open && !borrando, cerrar);

  function cerrar() {
    if (borrando) return;
    setPaso("aviso");
    setError("");
    onClose?.();
  }

  async function confirmar() {
    haptic.impactMedium();
    setBorrando(true);
    setError("");

    const res = await eliminarCuenta();
    // Si salió bien, la página ya se está recargando: no tocamos el estado
    // para no pintar un parpadeo sobre un componente que va a desaparecer.
    if (res?.ok) return;

    setBorrando(false);
    setError(
      res?.motivo === "rate_limited"
        ? t("deleteAccount.errorRateLimited")
        : t("deleteAccount.errorGeneric")
    );
  }

  return (
    <ModalShell
      open={open}
      onClose={cerrar}
      dismissOnBackdrop={!borrando}
      label={t("deleteAccount.title")}
      // Encaje de modal alto: `safe-area-pad` en el backdrop + `max-h-full` en el
      // panel (el porqué, en index.css junto a `.safe-area-pad`). Este es el que
      // menos margen admite: lo último de la hoja es el campo de confirmación y
      // el botón de borrar, y con el aviso de error desplegado es justo lo que se
      // iba bajo la barra de gestos en la app.
      backdropClassName="modal-scrim safe-area-pad fixed inset-0 z-[130] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      <div className="dlg">
      <div className="dlg-cab">
        <h2 className="dlg-titulo">{t("deleteAccount.title")}</h2>
        {!borrando && <CloseButton onClick={cerrar} />}
      </div>

      {paso === "aviso" ? (
        <>
          <p className="dlg-texto">{t("deleteAccount.intro")}</p>

          {/* Las dos mitades del trato, cada una con su título. Se lee antes
              que un párrafo corrido y deja claro que NO es «se borra todo». */}
          <dl className="dlg-trato">
            <div>
              <dt>{t("deleteAccount.goneLabel")}</dt>
              <dd>{t("deleteAccount.goneBody")}</dd>
            </div>
            <div>
              <dt>{t("deleteAccount.staysLabel")}</dt>
              <dd>{t("deleteAccount.staysBody")}</dd>
            </div>
          </dl>

          <p className="dlg-nota">{t("deleteAccount.irreversible")}</p>

          <div className="dlg-botones">
            <button
              type="button"
              onClick={() => {
                haptic.impactLight();
                setPaso("confirmar");
              }}
              className="pm-btn pm-btn--ghost"
            >
              {t("deleteAccount.continue")}
            </button>
            <button type="button" onClick={cerrar} className="pm-btn">
              {t("common.cancel")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="dlg-texto">{t("deleteAccount.confirmBody")}</p>

          <div className="dlg-botones">
            <button
              type="button"
              onClick={confirmar}
              disabled={borrando}
              // El único botón rojo LLENO de la app: es la única acción que no
              // tiene vuelta atrás. El rojo ya significa «gastado / atención»
              // en todo el juego; aquí lo significa del todo.
              className="pm-btn dlg-destructivo"
            >
              {borrando ? t("deleteAccount.deleting") : t("deleteAccount.confirmCta")}
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={borrando}
              className="pm-btn pm-btn--ghost"
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}

      {error && <p className="dlg-error">{error}</p>}
      </div>
    </ModalShell>
  );
}
