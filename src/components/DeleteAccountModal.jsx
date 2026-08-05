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
      backdropClassName="modal-scrim fixed inset-0 z-[130] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="pm-kicker">{t("deleteAccount.tag")}</p>
          <h2 className="pm-title mt-1">{t("deleteAccount.title")}</h2>
        </div>
        {!borrando && <CloseButton onClick={cerrar} />}
      </div>

      {paso === "aviso" ? (
        <>
          <p className="pm-body">{t("deleteAccount.intro")}</p>

          {/* Las dos columnas del trato, cada una con su ladillo. Se lee antes
              que un párrafo corrido y deja claro que NO es "se borra todo". */}
          <div className="arch-filete mt-4 pt-4">
            <p className="pm-label">{t("deleteAccount.goneLabel")}</p>
            <p className="pm-body mt-1.5 text-sm">{t("deleteAccount.goneBody")}</p>
          </div>
          <div className="mt-4 border-t border-border-strong/60 pt-4">
            <p className="pm-label">{t("deleteAccount.staysLabel")}</p>
            <p className="pm-body mt-1.5 text-sm">{t("deleteAccount.staysBody")}</p>
          </div>

          <p className="pm-body mt-4 text-sm text-muted-foreground">
            {t("deleteAccount.irreversible")}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                haptic.impactLight();
                setPaso("confirmar");
              }}
              className="pm-btn pm-btn--ghost !text-xs"
            >
              {t("deleteAccount.continue")}
            </button>
            <button type="button" onClick={cerrar} className="pm-btn !text-xs">
              {t("common.cancel")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pm-body">{t("deleteAccount.confirmBody")}</p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={confirmar}
              disabled={borrando}
              // El único botón rojo destructivo de la app. Misma geometría de
              // chip que el resto de acciones con consecuencia del carnet.
              className="focus-ring w-full border border-rojo px-3 py-2.5 font-body text-xs font-bold uppercase tracking-[0.12em] text-rojo transition-colors hover:bg-rojo hover:text-papel disabled:opacity-60"
            >
              {borrando ? t("deleteAccount.deleting") : t("deleteAccount.confirmCta")}
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={borrando}
              className="pm-btn !text-xs disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}

      {error && <p className="pm-body mt-4 text-center text-sm text-rojo">{error}</p>}
    </ModalShell>
  );
}
