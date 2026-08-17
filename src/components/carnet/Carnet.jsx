// src/components/carnet/Carnet.jsx
// EL CARNET DE LECTOR — el objeto de identidad que comparten el perfil propio
// (MyStats) y el ajeno (PublicProfile).
//
// DE TARJETA A DOCUMENTO. Lo que había era una tarjeta: un rectángulo con
// filete de oro al 25% y un hairline dorado encima, y dentro tres bloques
// sueltos (nombre, cifra grande, dos renglones con iconos) separados por tres
// filetes distintos. Tres cosas fallaban a la vez:
//
//   · EL ORO ENMARCABA TODO. Al 25% sobre papel crema no es oro, es un beige
//     lavado — y competía con las dos señales que sí se ganan: el sello del
//     tier y el ordinal del puesto. El oro está reservado a lo premium
//     (CLAUDE.md); cuando rodea el bloque entero no premia nada.
//   · NO TENÍA ANATOMÍA DE NADA. Un carnet de prensa es un documento, y un
//     documento tiene cabecera (qué es), titular (quién), sello (qué acredita)
//     y banda de datos. Aquí eran tres cajas apiladas con el mismo peso.
//   · LAS CIFRAS IBAN DE DOS EN DOS, en renglones con icono y valor al otro
//     extremo: comparar «racha» con «máxima» obligaba a leer dos frases en vez
//     de mirar una fila. Y la cifra grande —los puntos— colgaba sola arriba,
//     sin nada al lado con lo que medirse.
//
// Ahora las cuatro piezas son explícitas y las montan los dos perfiles con los
// mismos componentes: CarnetCabecera (kicker + la X del modal), CarnetNombre
// (titular, acreditación y sello del tier) y CarnetCifras (la banda). Qué se
// pone en la banda lo decide cada perfil: el propio acredita puesto, el ajeno
// —cuya RPC pública no expone posición— acredita aciertos.

import { PencilIcon } from "./icons";

// El sello del tier de coleccionista: la ÚNICA señal premium del documento, y
// por eso va sola (antes competía con un filete dorado que rodeaba el bloque
// entero, y entre las dos se anulaban).
//
// Cada metal con su color: hasta ahora se estampaba siempre en oro, así que un
// carnet de Plata llevaba un sello dorado que decía «Plata» — el color y la
// palabra en desacuerdo dentro del mismo objeto.
const SELLO_METAL = {
  gold: "pm-sello--oro",
  silver: "pm-sello--plata",
  bronze: "pm-sello--bronce",
};

export function SelloTier({ tier, label, title }) {
  if (!tier || !label) return null;
  return (
    <span className={`pm-sello ${SELLO_METAL[tier] || "pm-sello--oro"}`} title={title}>
      {label}
    </span>
  );
}

// El marco del documento.
export default function Carnet({ children, className = "", ...rest }) {
  return (
    <div className={`prensa-carnet ${className}`} {...rest}>
      {children}
    </div>
  );
}

// Cabecera: el kicker que dice qué documento es y, a la derecha, hueco para la
// X del modal (el carnet HACE de cabecera del panel, así que la X vive aquí
// dentro: el nombre trunca antes de llegar al botón en vez de pasarle por
// debajo). Doble filete abajo, como el folio de la portada.
export function CarnetCabecera({ kicker, trailing }) {
  return (
    <div className="prensa-carnet-cab">
      <p className="pm-kicker">{kicker}</p>
      {trailing}
    </div>
  );
}

// El titular del documento: nombre, renglón de acreditación y sello del tier.
//
// `onEdit` convierte TODA la línea del nombre en el botón de editar — la
// afordancia era un lápiz de 14px sin caja, imposible con el pulgar y por
// debajo del mínimo de WCAG 2.5.5.
export function CarnetNombre({
  nombre,
  apunte = null,
  cargando = false,
  onEdit,
  editLabel,
  sello = null,
}) {
  return (
    <div className="prensa-carnet-cuerpo">
      <div className="min-w-0 flex-1">
        {cargando ? (
          // Barra de papel del ancho aproximado de un nick: reserva la altura
          // real para que el panel no salte de tamaño al llegar los datos.
          <span className="block h-[27px] w-32 max-w-full bg-tinta/10" aria-hidden="true" />
        ) : onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            title={editLabel}
            aria-label={`${editLabel}: ${nombre}`}
            // Caja negativa: el área táctil crece sin que el nombre se desplace
            // respecto al filete de la cabecera.
            className="focus-ring group -mx-1.5 -my-1 flex w-[calc(100%+0.75rem)] items-center gap-2 px-1.5 py-1 text-left"
          >
            <span className="prensa-carnet-nombre">{nombre}</span>
            <PencilIcon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-rojo" />
          </button>
        ) : (
          <p className="prensa-carnet-nombre">{nombre}</p>
        )}

        {apunte && !cargando && <p className="prensa-carnet-apunte">{apunte}</p>}
      </div>

      {/* El sello del tier, al margen derecho. Es la única señal premium del
          documento y por eso va sola: antes compartía protagonismo con el
          filete dorado del marco y los dos se anulaban. */}
      {sello && <span className="shrink-0">{sello}</span>}
    </div>
  );
}

// La banda de datos: `items` es [{ label, value, tono, apunte }] y se reparte el
// ancho a partes iguales. `tono`: "oro" para lo que se gana (puesto, racha
// viva), "apagada" mientras no hay dato, y nada = tinta normal.
//
// `apunte` es opcional y va DEBAJO de la etiqueta, en cuerpo menor: la letra
// pequeña de una cifra que no significa una sola cosa. Hoy lo usa el desglose
// de aciertos del perfil público («de ellos, N atrasados»), donde el problema
// era que el total sumaba coche del día y repesca sin distinguirlos. Va aquí y
// no en un renglón propio bajo el carnet a propósito: una salvedad separada de
// la cifra que matiza es una nota al pie, y las notas al pie no se leen.
// Cuando falta —lo normal— la casilla no gasta ni un píxel de más.
export function CarnetCifras({ items }) {
  return (
    <div className="prensa-carnet-cifras">
      {items.map((item) => (
        <div key={item.label}>
          <span className={`cifra ${item.tono || ""}`}>{item.value}</span>
          <span className="et" title={item.label}>{item.label}</span>
          {item.apunte && (
            <span className="apunte" title={item.apunte}>{item.apunte}</span>
          )}
        </div>
      ))}
    </div>
  );
}
