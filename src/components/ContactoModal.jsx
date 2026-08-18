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
      backdropClassName="modal-scrim fixed inset-0 z-[120] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm p-6"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      <form onSubmit={handleSubmit}>
        <p className="pm-kicker">{t("contacto.kicker")}</p>
        <h2 className="pm-title mt-2">{t("contacto.titulo")}</h2>
        <p className="pm-body mt-3">{t("contacto.descripcion")}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TIPOS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTipo(id)}
              aria-pressed={tipo === id}
              className={`border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] ${
                tipo === id
                  ? "border-rojo text-rojo"
                  : "border-tinta-2/40 text-tinta-2"
              }`}
            >
              {t(`contacto.tipo_${id}`)}
            </button>
          ))}
        </div>

        <textarea
          value={cuerpo}
          onChange={(e) => { setCuerpo(e.target.value); setError(""); }}
          maxLength={CUERPO_MAX}
          rows={5}
          placeholder={t(`contacto.placeholder_${tipo}`)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "contacto-error" : undefined}
          className="
            mt-4 w-full resize-none rounded-none border border-tinta-2/40
            bg-transparent p-3 font-body text-sm text-tinta outline-none
            placeholder:text-tinta-2/50 focus:border-rojo
          "
        />

        {/* Solo cuando de verdad queda poco: un contador siempre visible es
            ruido, y contando hacia atrás desde 4000 no le dice nada a nadie. */}
        {restantes < 200 && (
          <div className="pm-label mt-1 !text-[10px]">{restantes}</div>
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
            className="
              mt-3 h-11 w-full rounded-none border-b border-tinta-2/40
              bg-transparent px-2 font-body text-sm text-tinta outline-none
              placeholder:text-tinta-2/50 focus:border-rojo
            "
          />
        )}

        {error && (
          <p id="contacto-error" role="alert" className="pm-body mt-3 text-sm text-rojo">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || !cuerpo.trim()}
          className="pm-btn mt-5 w-full"
        >
          {enviando ? t("contacto.enviando") : t("contacto.enviar")}
        </button>
      </form>
    </ModalShell>
  );
}
