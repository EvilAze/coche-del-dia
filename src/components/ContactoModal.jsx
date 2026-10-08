// src/components/ContactoModal.jsx
// Escribirle al equipo sin salir del juego.
//
// POR QUÉ NO ES UN `mailto:`. Ya había uno, en /eliminar-cuenta, y sigue ahí:
// es la dirección pública que exige el formulario de Data safety de Play. Pero
// un mailto abre el cliente de correo del móvil —si es que hay uno configurado,
// que en Android muchas veces no—, pierde por completo quién está escribiendo, y
// lo que llega al otro lado es un correo suelto que hay que cruzar a mano con
// una cuenta del juego. Desde aquí el mensaje viaja con su `user_id` y aparece
// en el panel identificado, sin preguntarle su nick a nadie.
//
// TRES TIPOS Y NO UN CAJÓN LIBRE. «Reporte» existe para que haya una vía de
// avisar de un nombre ofensivo en la clasificación, que era el hueco que quedó
// abierto al montar la validación del nick: el panel podía retirar un nick, pero
// nadie tenía forma de avisar de que había uno que retirar.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useEscape } from "../hooks/useEscape";
import {
  enviarMensaje,
  cuerpoValido,
  emailValido,
  CUERPO_MAX,
  TIPOS,
} from "../lib/mensajes";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";
import { Segmentado } from "./Ajustes";
import { useToast } from "./Toast";

export default function ContactoModal({ open, onClose, user }) {
  const { t } = useT();
  const toast = useToast();
  const [tipo, setTipo] = useState("problema");
  const [cuerpo, setCuerpo] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEscape(open, onClose);

  // Al abrir se limpia: si alguien escribió, cerró y vuelve, empieza de cero en
  // vez de encontrarse un borrador a medias que ya no recuerda.
  useEffect(() => {
    if (!open) return;
    setTipo("problema");
    setCuerpo("");
    setEmail("");
    setError("");
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (enviando) return;

    if (!cuerpoValido(cuerpo)) {
      setError(t("contacto.errorCuerpo"));
      return;
    }
    if (!emailValido(email)) {
      setError(t("contacto.errorEmail"));
      return;
    }

    setEnviando(true);
    setError("");
    try {
      await enviarMensaje({ tipo, cuerpo, email });
      // El acuse va en el toast y no en una pantalla de "gracias": el jugador
      // venía de una partida y a la partida vuelve.
      toast.push(t("contacto.enviado"), { type: "success" });
      onClose?.();
    } catch (err) {
      // Cada rechazo del servidor dice lo suyo. Un "algo ha fallado" genérico
      // aquí es especialmente malo: quien está escribiendo es alguien que YA
      // tiene un problema.
      const porCodigo = {
        CUOTA: t("contacto.errorCuota"),
        NO_VALIDO: t("contacto.errorCuerpo"),
        SIN_SESION: t("contacto.errorSesion"),
      };
      setError(porCodigo[err.code] || t("contacto.errorGenerico"));
    } finally {
      setEnviando(false);
    }
  }

  const restantes = CUERPO_MAX - cuerpo.trim().length;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("contacto.titulo")}
      backdropClassName="modal-scrim fixed inset-0 z-dialogo-sobre flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      <form onSubmit={handleSubmit} className="dlg">
        <div className="dlg-cab">
          <h2 className="dlg-titulo">{t("contacto.titulo")}</h2>
          <CloseButton onClick={onClose} label={t("common.close")} />
        </div>
        <p className="dlg-texto">{t("contacto.descripcion")}</p>

        {/* De qué va: el mismo conmutador segmentado que el tema y el idioma.
            Cambia el texto de ayuda del campo, no lo que se envía. */}
        <Segmentado
          etiqueta={t("contacto.tipoAria")}
          valor={tipo}
          onCambio={setTipo}
          opciones={TIPOS.map((id) => [id, t(`contacto.tipo_${id}`)])}
        />

        <textarea
          value={cuerpo}
          onChange={(e) => { setCuerpo(e.target.value); setError(""); }}
          maxLength={CUERPO_MAX}
          rows={5}
          placeholder={t(`contacto.placeholder_${tipo}`)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "contacto-error" : undefined}
          className="dlg-input dlg-area"
        />

        {/* Solo cuando de verdad queda poco: un contador siempre visible es
            ruido, y contando hacia atrás desde 4000 no le dice nada a nadie. */}
        {restantes < 200 && (
          <p className="dlg-nota dlg-contador">{restantes}</p>
        )}

        {/* El correo solo se pide a quien no tiene cuenta: del registrado ya lo
            sabemos, y volver a pedírselo parecería que no. */}
        {!user?.email && (
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            maxLength={254}
            placeholder={t("contacto.emailPlaceholder")}
            className="dlg-input"
          />
        )}

        {error && (
          <p id="contacto-error" role="alert" className="dlg-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || !cuerpo.trim()}
          className="pm-btn"
        >
          {enviando ? t("contacto.enviando") : t("contacto.enviar")}
        </button>
      </form>
    </ModalShell>
  );
}
