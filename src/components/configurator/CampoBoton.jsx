// src/components/configurator/CampoBoton.jsx
// El renglón del cupón en la app: parece el campo de siempre y no lo es.
//
// Misma piel que `.prensa-input` —etiqueta en versalitas, valor a máquina sobre
// la línea base, filete que se pone rojo al pulsar y verde al resolverse— pero
// por debajo es un <button> que abre la hoja de selección. El jugador ve el
// mismo cupón de periódico; lo que cambia es que tocarlo no levanta el teclado.
//
// ES UN <button> DE VERDAD, no un div con onClick: llega el foco, responde a
// Enter y Espacio, se anuncia como botón y `disabled` funciona de una pieza
// (modelo bloqueado hasta elegir marca). Un div habría costado tres atributos
// ARIA para quedarse peor.
//
// El campo RESUELTO no se puede tocar: el dato ya está cerrado y abrir su lista
// invitaría a cambiar algo que no se puede cambiar. Se marca con ✓ verde, el
// mismo acuse que usa el combo de la web.

import { Icon, I } from "./icons";
import { useT } from "../../i18n";

export default function CampoBoton({
  label,
  valor,
  placeholder,
  onClick,
  disabled = false,
  resuelto = false,
  // Nota al pie del renglón (hoy solo la usa el año, con su horquilla).
  apunte = null,
}) {
  const { t } = useT();

  return (
    <div>
      <button
        type="button"
        className={"prensa-renglon" + (resuelto ? " resuelto" : "")}
        onClick={onClick}
        disabled={disabled || resuelto}
        // El nombre accesible se compone aquí porque la etiqueta va DENTRO del
        // botón: un <label> asociado no vale (no hay campo al que asociarlo) y
        // sin esto el lector anunciaría solo «Elegir…», que no dice de qué.
        aria-label={`${label}: ${valor || placeholder}`}
      >
        <span className="etiqueta">{label}</span>
        {/* La guía de puntos del formulario impreso. Es decorativa —de ahí el
            aria-hidden— pero hace un trabajo real: lleva el ojo de la etiqueta
            al dato y convierte una fila de ajustes en un renglón de cupón. */}
        <span className="guia" aria-hidden="true" />
        <span className={valor ? "valor" : "vacio"}>{valor || placeholder}</span>
        {resuelto ? (
          <span className="marca" aria-hidden="true">✓</span>
        ) : (
          <Icon d={I.chevR} size={16} className="chev" />
        )}
      </button>
      {resuelto && <p className="prensa-horquilla resuelta">{t("cdd.fieldSolved")}</p>}
      {apunte && <p className="prensa-horquilla">{apunte}</p>}
    </div>
  );
}
