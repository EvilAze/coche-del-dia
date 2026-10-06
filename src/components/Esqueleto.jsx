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

// La vitrina del archivo antes de que llegue: la tarjeta de la colección, la
// de la repesca y las fichas de la rejilla, con las MISMAS cajas que
// Showcase (ver .arch-ficha), para que al llegar no se mueva nada.
export function PortadasArchivo({ n = 6, texto }) {
  return (
    <div role="status" aria-label={texto} className="arch-vitrina">
      <span className="sr-only">{texto}</span>
      <div className="arch-resumen pm-esperando" aria-hidden="true" />
      <div className="arch-rejilla">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="arch-ficha" aria-hidden="true">
            <span className="arch-ficha-cab">
              <span className="arch-logo pm-esperando" />
              <Renglon w="w-8" h="h-2.5" />
            </span>
            <span className="arch-ficha-nombre">
              <Renglon w="w-12" h="h-2" />
              <Renglon w={["w-24", "w-16", "w-20"][i % 3]} h="h-4" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
