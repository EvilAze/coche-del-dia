// src/components/configurator/CampoBoton.jsx
// El renglón del cupón en la app: parece el campo de siempre y no lo es.
//
// Misma piel que `.prensa-input` de la web —etiqueta en versalitas ARRIBA, dato
// debajo sobre la línea base, filete que se pone rojo al pulsar y verde al
// resolverse— pero por debajo es un <button> que abre la hoja de selección. El
// jugador ve el mismo cupón en las dos plataformas; lo que cambia es que tocarlo
// no levanta el teclado.
//
// DOS LÍNEAS Y NO UNA. Fue una sola línea con guía de puntos —«MARCA ······
// Volkswagen»—, que ahorraba unos píxeles y convertía el cupón en un ÍNDICE: la
// etiqueta a la izquierda, el dato empujado al borde derecho en cursiva gris, y
// el ojo recorriendo un renglón entero de puntos para llegar a él. Se leía como
// la carta de un restaurante, no como tres controles que hay que rellenar. Con
// la etiqueta encima y el dato alineado a la izquierda es el campo de formulario
// que cualquiera reconoce, y el mismo que ya teclea quien juega en la web
// (heurística de consistencia: dos plataformas, un solo cupón). La nota del
// campo —la horquilla del año, el «resuelto»— sube a la línea de la etiqueta,
// alineada a la derecha, igual que el «±2 años» de la web: antes colgaba debajo
// del filete como una nota huérfana y costaba un renglón propio.
//
// ES UN <button> DE VERDAD, no un div con onClick: llega el foco, responde a
// Enter y Espacio, se anuncia como botón y `disabled` funciona de una pieza.
// Un div habría costado tres atributos ARIA para quedarse peor.
//
// El campo RESUELTO no se puede tocar: el dato ya está cerrado y abrir su lista
// invitaría a cambiar algo que no se puede cambiar. Se marca con ✓ verde, el
// mismo acuse que usa el combo de la web.
//
// EL CHEVRÓN APUNTA ABAJO, NO A LA DERECHA. En un móvil «›» al final de una
// fila es la promesa de una pantalla nueva (lo que hace un ajuste del sistema
// al tocarlo), y esto no navega a ningún sitio: abre una hoja encima de la
// misma pantalla, con la foto a la vista. «⌄» es el «despliega opciones» de un
// selector, que es lo que hay detrás.
//
// EN ESPERA NO HAY CHEVRÓN. El modelo sin marca sigue siendo tocable (lleva a
// la marca), pero no despliega SU lista: dibujarle la flecha prometía algo que
// no iba a pasar. Lo que lo distingue de un campo listo es la casilla hundida
// (ver `.espera` en index.css), no un texto apagado hasta no leerse.

import { Icon, I } from "./icons";
import { useT } from "../../i18n";

export default function CampoBoton({
  label,
  valor,
  placeholder,
  onClick,
  disabled = false,
  resuelto = false,
  // Nota del renglón (hoy solo la usa el año, con su horquilla).
  apunte = null,
  // El renglón todavía no se puede rellenar porque falta un paso anterior (el
  // modelo sin marca). Sigue siendo tocable —lleva al paso que falta, ver
  // GuessForm—, pero su hueco se apaga un tono más para que no se confunda con
  // un campo listo para elegir.
  espera = false,
}) {
  const { t } = useT();
  const nota = resuelto ? t("cdd.fieldSolved") : apunte;

  return (
    <button
      type="button"
      className={"prensa-renglon" + (resuelto ? " resuelto" : "") + (espera ? " espera" : "")}
      onClick={onClick}
      disabled={disabled || resuelto}
      // El nombre accesible se compone aquí porque la etiqueta va DENTRO del
      // botón: un <label> asociado no vale (no hay campo al que asociarlo) y
      // sin esto el lector anunciaría solo «Toca para elegir», que no dice de
      // qué. La nota viaja también: la horquilla es información, no adorno.
      aria-label={`${label}: ${valor || placeholder}${nota ? `. ${nota}` : ""}`}
    >
      <span className="cabeza">
        <span className="etiqueta">{label}</span>
        {nota && <span className={"apunte" + (resuelto ? " resuelta" : "")}>{nota}</span>}
      </span>
      <span className="cuerpo">
        <span className={valor ? "valor" : "vacio"}>{valor || placeholder}</span>
        {resuelto ? (
          <span className="marca" aria-hidden="true">✓</span>
        ) : espera ? null : (
          <Icon d={I.chevD} size={16} className="chev" />
        )}
      </span>
    </button>
  );
}
