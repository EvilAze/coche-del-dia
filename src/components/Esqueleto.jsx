// src/components/Esqueleto.jsx
// LA ESPERA CON LA FORMA DE LO QUE SE ESPERA.
//
// Hasta aquí, abrir la clasificación o el archivo enseñaba UNA LÍNEA DE TEXTO
// («Cargando ranking…», «Abriendo el archivo…») donde luego iba a haber una
// tabla de diez filas o una rejilla de portadas. Dos costes, y el segundo es el
// caro: el panel mide un renglón y de golpe mide seiscientos píxeles —el salto
// de maqueta más visible que tiene la app—, y mientras tanto la espera no dice
// NADA de lo que viene. Un esqueleto con la forma final hace las dos cosas a la
// vez: reserva el sitio exacto y adelanta la estructura, así que cuando llegan
// los datos no aparece una pantalla nueva, se entinta la que ya estabas
// mirando.
//
// Y NO ES UN «SKELETON» DE CATÁLOGO: es papel esperando a la tinta. Reutiliza
// `.pm-esperando`, la respiración que el sistema ya usa bajo la fotografía —el
// mismo gesto para la misma espera, en vez del gris parpadeante de Tailwind que
// index.css ya se molestó en echar de la portada. Respiran todas a la vez a
// propósito: son el mismo pliego en la máquina, no diez cosas cargando por su
// cuenta.
//
// ACCESIBILIDAD: los bloques son decoración pura (`aria-hidden`) y quien anuncia
// es un `role="status"` con el texto de siempre. Un lector de pantalla oye
// «cargando la clasificación», no diez divs vacíos.

// Un bloque de papel a la espera. `w`/`h` son utilidades de Tailwind para que el
// tamaño lo decida quien lo usa: un esqueleto solo sirve si mide lo que va a
// medir el dato.
export function Renglon({ w = "w-full", h = "h-3", className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`pm-esperando inline-block align-middle ${w} ${h} ${className}`}
    />
  );
}

// La tabla de la clasificación antes de que llegue. La rejilla es LA MISMA que
// la de `Ranking` (columnas puesto | jugador | puntos): si no lo fuera, al
// llegar los datos las columnas se moverían y el esqueleto habría hecho más
// daño que bien.
// `texto` es opcional: sin él, las filas son decoración muda. Hace falta porque
// el palmarés apila VARIOS bloques de estos y anidar cuatro `role="status"` en
// la misma pantalla es peor que no anunciar nada — quien compone anuncia una vez
// por fuera.
export function FilasClasificacion({ n = 8, texto = null }) {
  return (
    <div
      role={texto ? "status" : undefined}
      aria-label={texto || undefined}
      aria-hidden={texto ? undefined : "true"}
      className="divide-y divide-border"
    >
      {texto && <span className="sr-only">{texto}</span>}
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[3.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-[0.6875rem]"
        >
          <Renglon w="w-6" h="h-4" />
          {/* Los nombres no miden todos igual, y una columna de bloques
              idénticos se lee como una barra de progreso, no como una lista.
              Tres anchos alternos bastan para que parezca una tabla. */}
          <Renglon w={["w-28", "w-20", "w-24"][i % 3]} h="h-3.5" />
          <Renglon w="w-10" h="h-3.5" className="justify-self-end" />
        </div>
      ))}
    </div>
  );
}

// La vitrina del archivo antes de que llegue: la portada es el objeto, así que
// el esqueleto es la portada SIN imprimir — su filete, su cabecera de kiosco, su
// hueco de foto en 4:3 y su pie. La rejilla es la de `Showcase`.
export function PortadasArchivo({ n = 6, texto }) {
  return (
    <div role="status" aria-label={texto} className="px-4 pb-4 pt-3">
      <span className="sr-only">{texto}</span>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="border border-border-strong" aria-hidden="true">
            <div className="flex items-center justify-between gap-1.5 border-b border-border px-1.5 py-1">
              <Renglon w="w-12" h="h-2" />
              <Renglon w="w-5" h="h-2" />
            </div>
            <div className="pm-esperando aspect-[4/3] w-full" />
            <div className="flex flex-col gap-1 border-t border-border px-1.5 py-1.5">
              <Renglon w="w-10" h="h-2" />
              <Renglon w="w-16" h="h-2.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
