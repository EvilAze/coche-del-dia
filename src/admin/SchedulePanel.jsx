// src/admin/SchedulePanel.jsx
// Panel del calendario admin: 14 días empezando por hoy, mostrando qué
// coche está programado cada día y permitiendo editar o hacer swap.
//
// Pide /api/admin/schedule (GET) en cada montaje y cuando refreshKey
// cambia (el shell lo incrementa tras guardar en Edit/Add o tras un swap).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import EmergencySwapModal from "./EmergencySwapModal";

const WEEKDAY_FMT = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  timeZone: "Europe/Madrid",
});
const DATE_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Madrid",
});

function formatDate(yyyyMmDd) {
  // Construimos el Date a mediodía UTC para evitar que el TZ pase la
  // fecha al día anterior en Madrid (offset +1/+2).
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: WEEKDAY_FMT.format(dt),
    short: DATE_FMT.format(dt),
  };
}

export default function SchedulePanel({
  refreshKey = 0,
  onEditCar,
  onSwapCar,
}) {
  const [days, setDays] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [randomizing, setRandomizing] = useState(false);
  // Qué se está liberando: "all" | "YYYY-MM-DD" | null. Sirve para deshabilitar
  // solo el botón que se pulsó, no todos.
  const [freeing, setFreeing] = useState(null);
  // "Voy montando el tema": permite que el sorteo elija coches SIN FOTO. Es
  // opt-in y arranca apagado — un borrador que llega a su día sin imagen deja
  // la jornada injugable, así que nunca puede ser el default.
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  // El cambio de emergencia tiene su propio modal (src/admin/EmergencySwapModal)
  // porque no es el swap del calendario: aquel reasigna un día que nadie ha
  // jugado, y este toca la jornada EN CURSO. No lleva fecha como estado porque
  // solo puede apuntar a un día — hoy.
  const [emergenciaAbierta, setEmergenciaAbierta] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Sin sesión");
        const res = await fetch("/api/admin/schedule", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setDays(Array.isArray(body.days) ? body.days : []);
        setToday(body.today || null);
      } catch (err) {
        if (!cancelled) {
          console.error("[SchedulePanel] fetch:", err);
          setError(err?.message || "No se pudo cargar el calendario.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefresh]);

  const items = useMemo(
    () =>
      days.map((d, idx) => ({
        ...d,
        ...formatDate(d.date),
        isToday: d.date === today,
        offset: idx,
        // Programado pero sin imagen: si llega a su día así, la jornada queda
        // injugable. Es el aviso más importante de este panel.
        needsPhoto: Boolean(d.car && !d.car.image_url),
      })),
    [days, today]
  );

  // Días futuros programados sin foto, en orden. El primero es la fecha límite
  // real: es la que hay que cubrir antes.
  const pendingPhotos = useMemo(
    () => items.filter((i) => i.needsPhoto && !i.isToday),
    [items]
  );

  async function handleRandomize() {
    const ok = window.confirm(
      "¿Seguro que quieres aleatorizar los coches de los próximos 6 días? Esto reemplazará cualquier coche programado para el futuro."
    );
    if (!ok) return;

    setRandomizing(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");

      const res = await fetch("/api/admin/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ randomize: true }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      setLocalRefresh((prev) => prev + 1);
    } catch (err) {
      console.error("[SchedulePanel] randomize:", err);
      setError(err?.message || "No se pudo aleatorizar el calendario.");
    } finally {
      setRandomizing(false);
    }
  }

  // Libera uno o varios días. `target` = "all" o una fecha YYYY-MM-DD.
  // OJO: liberar NO deja el día vacío. Borra la asignación y, al repintar el
  // calendario, pick_daily_car vuelve a sortear — ahora sí respetando la
  // temática de la temporada activa. Por eso el día sigue mostrando un coche
  // después de liberarlo (otro, y del tema).
  async function freeDates(target) {
    if (target === "all") {
      const ok = window.confirm(
        "¿Liberar todos los días futuros?\n\nSe volverán a sortear al instante, " +
          "respetando la temática de la temporada activa. El coche de hoy no se toca." +
          (includeDrafts
            ? "\n\nINCLUYENDO COCHES SIN FOTO: tendrás que subir la imagen de cada " +
              "uno antes de que llegue su día, o esa jornada quedará injugable."
            : "")
      );
      if (!ok) return;
    }

    setFreeing(target);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");

      const res = await fetch("/api/admin/schedule", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ...(target === "all" ? { all: true } : { date: target }),
          include_drafts: includeDrafts,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }

      setLocalRefresh((prev) => prev + 1);
    } catch (err) {
      console.error("[SchedulePanel] free:", err);
      setError(err?.message || "No se pudo liberar el calendario.");
    } finally {
      setFreeing(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">
          Calendario (14 días)
        </h2>
        <p className="mt-1 text-xs text-muted">
          Abrir esta pestaña <strong className="text-white">fija</strong> los 14
          días: a partir de ahí el sorteo ya no los toca. Si acabas de crear una
          temporada con temática, libera los días futuros para que se vuelvan a
          sortear con ella. El coche de hoy nunca se puede liberar.
        </p>
      </header>

      <button
        type="button"
        onClick={handleRandomize}
        disabled={loading || randomizing}
        className="
          w-full rounded-xl border border-accent/40 bg-accent/5 px-4 py-3
          text-sm font-semibold uppercase tracking-[0.18em] text-accent
          transition hover:border-accent hover:bg-accent/10
          disabled:cursor-not-allowed disabled:opacity-40
          flex items-center justify-center gap-2
        "
      >
        {randomizing ? "🎲 Aleatorizando..." : "🎲 Aleatorizar próximos 6 días"}
      </button>

      <button
        type="button"
        onClick={() => freeDates("all")}
        disabled={loading || randomizing || freeing !== null}
        className="
          w-full rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3
          text-sm font-semibold uppercase tracking-[0.18em] text-amber-300
          transition hover:border-amber-400 hover:bg-amber-400/10
          disabled:cursor-not-allowed disabled:opacity-40
          flex items-center justify-center gap-2
        "
      >
        {freeing === "all"
          ? "Liberando..."
          : "Liberar días futuros y re-sortear"}
      </button>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-black/20 px-4 py-3">
        <input
          type="checkbox"
          checked={includeDrafts}
          onChange={(e) => setIncludeDrafts(e.target.checked)}
          disabled={freeing !== null}
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-amber-400"
        />
        <span className="text-xs leading-relaxed text-muted">
          <strong className="text-white">Incluir coches sin foto</strong> — para
          montar una temporada al vuelo: el sorteo puede elegir borradores y tú
          les vas subiendo la imagen antes de que llegue su día. Mañana nunca
          recibe un borrador (haría falta subir la foto en menos de 24 h).
        </span>
      </label>

      {pendingPhotos.length > 0 && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-semibold">
            {pendingPhotos.length === 1
              ? "1 día programado sin foto"
              : `${pendingPhotos.length} días programados sin foto`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            El más cercano es el {pendingPhotos[0].short} (
            {pendingPhotos[0].car.marca} {pendingPhotos[0].car.modelo}). Si llega
            su día sin imagen, esa jornada queda injugable — súbela desde «Editar
            coche».
          </p>
        </div>
      )}

      {loading && (
        <p className="animate-pulse text-xs uppercase tracking-widest text-muted">
          Cargando calendario...
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        /* Rejilla y no columna: con el contenedor del shell llegando ya a 6xl,
           siete tarjetas en fila india dejaban dos tercios de pantalla en
           blanco y obligaban a hacer scroll para ver la semana entera —que es
           justo lo único que este panel viene a enseñar de un vistazo. */
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.date}
              className={`overflow-hidden rounded-2xl border ${
                item.isToday
                  ? "border-accent/60 bg-accent/5"
                  : "border-border bg-bg-secondary/40"
              }`}
            >
              <div className="flex gap-3 p-3">
                {/* Thumbnail */}
                <div className="h-20 w-28 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-black/40">
                  {item.car?.image_url ? (
                    <img
                      src={item.car.image_url}
                      alt={`${item.car.marca} ${item.car.modelo}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-widest text-muted">
                      Sin foto
                    </div>
                  )}
                </div>

                {/* Datos */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-display text-sm uppercase tracking-[0.18em] ${
                        item.isToday ? "text-accent" : "text-white"
                      }`}
                    >
                      {item.isToday ? "Hoy" : item.weekday}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted">
                      {item.short}
                    </span>
                  </div>
                  {item.car ? (
                    <>
                      <p className="mt-1 truncate text-sm text-white">
                        {item.car.marca} {item.car.modelo}
                      </p>
                      <p className="text-xs text-muted">
                        {item.car.anio} · {item.car.pais}
                      </p>
                      {item.needsPhoto && (
                        <span className="mt-1 self-start rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                          Falta la foto
                        </span>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Sin coche asignado.</p>
                  )}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex border-t border-border">
                <button
                  type="button"
                  disabled={!item.car}
                  onClick={() =>
                    item.car && typeof onEditCar === "function" && onEditCar(item.car.id)
                  }
                  className="
                    flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-white
                    transition hover:bg-white/5
                    disabled:cursor-not-allowed disabled:opacity-40
                  "
                >
                  Editar coche
                </button>
                <div className="w-px bg-border" aria-hidden="true" />
                {/* Hoy no es "Cambiar coche deshabilitado": es OTRA acción.
                    El botón gris de antes dejaba el panel sin ninguna salida
                    cuando el coche del día salía mal (foto rota, coche
                    repetido) y había que arreglarlo a mano en Supabase. Ahora
                    hay puerta, pero es una puerta distinta y se ve distinta:
                    en rojo, con su nombre, y con un modal que dice a cuánta
                    gente afecta antes de tocar nada. */}
                {item.isToday ? (
                  <button
                    type="button"
                    onClick={() => setEmergenciaAbierta(true)}
                    className="
                      flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-rojo
                      transition hover:bg-rojo/10
                    "
                    title="Sustituir el coche de hoy con la jornada ya empezada"
                  >
                    Cambio de emergencia
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      typeof onSwapCar === "function" &&
                      onSwapCar(item.date, item.car?.id || null)
                    }
                    className="
                      flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-accent
                      transition hover:bg-accent/10
                    "
                  >
                    Cambiar coche
                  </button>
                )}
                <div className="w-px bg-border" aria-hidden="true" />
                {/* «Liberar» sigue deshabilitado hoy, y no es un descuido de
                    la línea de arriba: liberar BORRA la fila de daily_cars, y
                    con ella prev_car_ids — o sea, la lista de coches salientes
                    que es lo único que mantiene jugando a quien ya había
                    empezado. Cambiar el coche de hoy se hace por emergencia,
                    que la conserva; liberarlo no tiene arreglo. */}
                <button
                  type="button"
                  disabled={item.isToday || freeing !== null}
                  onClick={() => freeDates(item.date)}
                  className="
                    flex-1 px-3 py-2.5 text-[11px] uppercase tracking-[0.18em] text-amber-300
                    transition hover:bg-amber-400/10
                    disabled:cursor-not-allowed disabled:opacity-40 disabled:text-muted
                  "
                  title={
                    item.isToday
                      ? "El coche de hoy ya está en juego"
                      : "Borra la asignación y vuelve a sortear este día"
                  }
                >
                  {freeing === item.date ? "..." : "Liberar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Montado siempre (ModalShell decide cuándo pintar) para que la
          animación de salida no se corte — y estar montado ya no cuesta una
          descarga del catálogo: el modal pide el suyo al abrirse
          (useFreshCatalog con auto:false). Al terminar se incrementa
          localRefresh: es el mismo contador que usan aleatorizar y liberar
          para volver a disparar el GET de /api/admin/schedule, así que la
          tarjeta de hoy se repinta ya con el coche nuevo. */}
      <EmergencySwapModal
        open={emergenciaAbierta}
        onClose={() => setEmergenciaAbierta(false)}
        onSwapped={() => setLocalRefresh((prev) => prev + 1)}
      />
    </div>
  );
}
