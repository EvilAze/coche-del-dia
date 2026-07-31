// src/components/carnet/Carnet.jsx
// EL CARNET — el objeto de identidad que comparten el perfil propio (MyStats)
// y el ajeno (PublicProfile).
//
// QUÉ CAMBIÓ Y POR QUÉ:
//
//  · Fuera el avatar. Era un disco de 48px con la inicial del nick... impresa a
//    12px del nick completo. No aportaba un dato que no estuviera ya escrito al
//    lado, y era un CÍRCULO en un sistema que ha eliminado los redondeos a
//    propósito. Un carnet de prensa no lleva foto cuando no hay foto: lleva
//    cabecera. Lo que ocupaba el disco lo ocupa ahora el nombre, en Fraunces
//    grande, que es lo que de verdad identifica al lector.
//
//  · Una sola señal premium. El bloque llevaba TRES a la vez (filete de oro,
//    hairline de oro y chip de oro del tier) para decir lo mismo, y entre las
//    tres se anulaban. Queda el marco con su hairline; el tier baja a SELLO
//    (pm-sello--oro), que es como este sistema dice "esto vale algo".
//
//  · La cifra del carnet son los PUNTOS. Estaban escondidos como acompañante
//    dentro del subtítulo gris de la fila de Ranking («7º · 340 pts»), una
//    cadena haciendo tres trabajos. El puesto va debajo con su glifo de siempre
//    (PuestoCifra), el mismo que el jugador toca en la barra de portada.

import PuestoCifra from "../PuestoCifra";
import { PencilIcon } from "./icons";

// El marco: filete de oro discreto + hairline superior. `overflow-hidden`
// porque el hairline se pinta en posición absoluta al borde.
export default function Carnet({ children, className = "", ...rest }) {
  return (
    <div
      className={`relative overflow-hidden border border-gold/25 bg-bg-tertiary p-4 ${className}`}
      {...rest}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-oro-viejo/50" />
      {children}
    </div>
  );
}

// Cabecera del carnet: kicker rojo + nombre en Fraunces. `onEdit` convierte
// TODA la línea del nombre en el botón de editar — antes la afordancia era un
// lápiz de 14px sin caja, imposible con el pulgar y por debajo del mínimo de
// WCAG 2.5.5. `trailing` deja hueco a la X del modal cuando el carnet hace de
// cabecera (ver MyStats).
export function CarnetHead({ kicker, nombre, cargando = false, onEdit, editLabel, trailing }) {
  const nombreClass =
    "block truncate font-display text-[26px] font-black leading-tight tracking-tight text-tinta";

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="pm-kicker">{kicker}</p>

        {cargando ? (
          // Barra de papel del ancho aproximado de un nick: reserva la altura
          // real para que el panel no salte de tamaño al llegar los datos.
          <span className="mt-1 block h-[30px] w-32 max-w-full bg-tinta/10" aria-hidden="true" />
        ) : onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            title={editLabel}
            aria-label={`${editLabel}: ${nombre}`}
            // Caja negativa: el área táctil crece a ~40px de alto sin que el
            // texto se desplace respecto al kicker.
            className="focus-ring group -mx-1.5 mt-0.5 flex w-[calc(100%+0.75rem)] items-center gap-2 px-1.5 py-1 text-left"
          >
            <span className={nombreClass}>{nombre}</span>
            <PencilIcon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-rojo" />
          </button>
        ) : (
          <p className={`mt-1 ${nombreClass}`}>{nombre}</p>
        )}
      </div>

      {trailing}
    </div>
  );
}

// La franja de cifras: puntos (la moneda del juego) y, debajo, el puesto con su
// glifo. El sello del tier se alinea al pie de la franja.
//
// El número va en TINTA, no en oro: el oro está reservado a lo premium y aquí
// ya lo lleva el ordinal, que es el dato que se gana. Dos oros pegados no
// destacan el doble, se anulan.
export function CarnetCifra({ puntos, puntosLabel, puesto, puestoTotal, sinPuesto, sello }) {
  return (
    // `flex-wrap` + `ml-auto` en el sello: en español «COLECCIONISTA» mide casi
    // 100px y en una pantalla de 320px se comía el sitio de la cifra. Si no cabe
    // en la misma línea, el sello baja y se mantiene al margen derecho en vez de
    // recortar los puntos (el carnet lleva overflow-hidden por el hairline).
    <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t border-border pt-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[34px] font-black leading-none tabular-nums text-tinta">
            {puntos}
          </span>
          <span className="pm-label">{puntosLabel}</span>
        </div>

        {puesto ? (
          <PuestoCifra pos={puesto} total={puestoTotal} size="s" className="mt-1.5" />
        ) : sinPuesto ? (
          <p className="pm-label mt-2">{sinPuesto}</p>
        ) : null}
      </div>

      {sello && <span className="ml-auto shrink-0">{sello}</span>}
    </div>
  );
}

// Fila de la ficha: icono + etiqueta a la izquierda, valor a la derecha. Lee
// como hoja de specs, no como KPI suelto. `hint` es la línea de ayuda bajo la
// etiqueta (la del escudo de racha, que llevaba meses sin explicarse).
export function FichaRow({ icon, label, hint, children, last = false }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 ${
        last ? "" : "border-b border-border-strong/60"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-foreground/85">
        {/* `shrink-0`: con la línea de ayuda debajo, la etiqueta puede pasar a
            dos líneas y el flex intentaba encoger también el icono. */}
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0">
          {label}
          {hint && (
            <span className="mt-0.5 block font-display text-[11px] italic leading-tight text-muted-foreground">
              {hint}
            </span>
          )}
        </span>
      </span>
      {children}
    </div>
  );
}

// El valor numérico de una fila. `premium` enciende el oro SOLO cuando hay algo
// que celebrar: la mejor racha se pintaba en oro incluso valiendo 0, y el oro
// sobre un cero devalúa el oro en todas las demás pantallas donde sí significa.
export function FichaCifra({ value, premium = false }) {
  return (
    <span
      className={`text-base font-bold tabular-nums ${
        premium ? "text-gold" : "text-muted-foreground"
      }`}
    >
      {value}
    </span>
  );
}
