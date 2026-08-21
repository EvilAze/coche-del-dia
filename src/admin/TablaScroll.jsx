// src/admin/TablaScroll.jsx
// La ventana por la que se miran las tablas largas del panel.
//
// POR QUÉ: el directorio de usuarios y el historial de un jugador no tienen
// techo — crecen con el juego. Pintados enteros empujaban hacia abajo todo lo
// que viniera después, así que la analítica terminaba siendo una tirada de
// varias pantallas en la que las gráficas de arriba y la tabla de abajo nunca
// se veían juntas, y volver a los KPIs era un viaje de scroll. Con la tabla
// dentro de su propia ventana, el panel vuelve a medir lo mismo tenga 12
// usuarios o 1.200.
//
// EL ENCABEZADO SE QUEDA PEGADO. Una tabla con scroll propio y la cabecera
// arriba del todo es peor que la lista larga: a la tercera fila ya no sabes qué
// columna estás mirando. Se resuelve con variantes arbitrarias sobre los `th`
// —y no con `position:sticky` en el `<thead>`, que es justo lo que los
// navegadores ignoran— para no tener que tocar el marcado de cada tabla.
//
// El fondo del `th` pegado es OPACO a propósito (`bg-bg-primary`, no el
// `white/[0.02]` de la tarjeta): translúcido deja ver las filas pasando por
// debajo del encabezado.

export default function TablaScroll({
  children,
  // Alto máximo. Se mide en rem y no en vh porque la tabla vive DENTRO de una
  // página que ya hace scroll: en vh, dos tablas abiertas a la vez no caben en
  // la pantalla y vuelve el problema que esto viene a resolver.
  alto = "max-h-[26rem]",
  // Ancho mínimo de la tabla. Por debajo de esto se hace scroll horizontal en
  // vez de aplastar las columnas — que es lo que le pasaba a la tabla de
  // sospecha en un móvil.
  minAncho = "min-w-[420px]",
  pie,
}) {
  return (
    <div>
      <div
        className={`
          overflow-auto rounded-lg border border-white/5
          ${alto}
          [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10
          [&_thead_th]:bg-bg-primary
        `}
      >
        <div className={minAncho}>{children}</div>
      </div>
      {pie && <p className="mt-2 text-[10px] text-muted">{pie}</p>}
    </div>
  );
}
