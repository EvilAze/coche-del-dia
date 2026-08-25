// src/admin/EmergencySwapModal.jsx
// Confirmación del cambio de emergencia del coche del día.
//
// Es un modal aparte del SwapCarModal del calendario a propósito: aquel cambia
// una asignación que NADIE ha jugado todavía, y este toca una jornada EN CURSO.
// Lo que justifica la pantalla de más es enseñar a cuánta gente afecta ANTES de
// pulsar, porque es lo único que no se puede deshacer después: el coche vuelve
// al bombo, la fecha se puede rectificar, pero haber pulsado sin saber a quién
// estabas tocando, no.
//
// De ahí las dos decisiones que lo separan del swap normal:
//   1. DOS PASOS. Elegir de la lista no cambia nada; solo lleva a una pantalla
//      con el coche elegido delante y el botón definitivo. En el calendario un
//      clic basta porque el peor caso es reasignar un día futuro; aquí el peor
//      caso son las partidas de todo el mundo.
//   2. EL RECUENTO SE DICE, NO SE INVENTA. El GET devuelve `null` cuando la
//      consulta falló, y aquí eso se escribe («no se pudo contar»). Pintar un
//      cero en su lugar sería exactamente lo que haría pulsar con confianza
//      equivocada: parecería «no hay nadie jugando» cuando lo que hay es «no
//      lo sé».

import { useEffect, useMemo, useState } from "react";
import ModalShell from "../components/ModalShell";
import CloseButton from "../components/CloseButton";
import { useEscape } from "../hooks/useEscape";
import { supabase } from "../supabaseClient";
import { useFreshCatalog } from "../data/catalog";

// Redacta el recuento a partir de lo que el servidor pudo contar. Devuelve
// siempre una frase completa; cuando falta un dato lo NOMBRA en vez de rellenar
// con un número. Cuatro casos y no dos porque las dos consultas del GET fallan
// por separado: puede saberse cuántos registrados hay y no cuántos anónimos.
function redactarRecuento(jugadores) {
  const logueados = jugadores?.logueados ?? null;
  const anonimos = jugadores?.anonimos ?? null;

  if (logueados !== null && anonimos !== null) {
    return `Ahora mismo hay ${logueados} con cuenta y ${anonimos} sin ella jugando la partida de hoy.`;
  }
  if (logueados !== null) {
    return `Ahora mismo hay ${logueados} con cuenta jugando la partida de hoy. A los anónimos no se los pudo contar.`;
  }
  if (anonimos !== null) {
    return `Ahora mismo hay ${anonimos} sin cuenta jugando la partida de hoy. A los registrados no se los pudo contar.`;
  }
  return "No se pudo contar a cuánta gente afecta: puede no haber nadie jugando, o pueden ser muchos.";
}

export default function EmergencySwapModal({ open, onClose, onSwapped }) {
  // useFreshCatalog y NO useCatalog: la versión cacheada (memoria de sesión +
  // CDN s-maxage=300) se quedaría sin el coche que acabas de crear, y en una
  // emergencia el recambio suele ser justo ese.
  //
  // `auto: false` porque este modal está montado SIEMPRE (SchedulePanel lo
  // renderiza también cerrado: ModalShell lo exige para no cortar la animación
  // de salida). Con el fetch de mount, entrar en el calendario se llevaba el
  // catálogo entero sin caché aunque nadie pulsara nada, y abrir el modal lo
  // descargaba otra vez por el reloadCatalog() de abajo. Quien carga es el
  // efecto de [open], una sola vez y solo al abrir.
  const {
    data: catalog,
    loading: cargandoCatalogo,
    reload: reloadCatalog,
  } = useFreshCatalog({ auto: false });
  const CARS = catalog?.cars ?? [];

  const [info, setInfo] = useState(null);
  const [cargandoInfo, setCargandoInfo] = useState(true);
  const [query, setQuery] = useState("");
  const [elegido, setElegido] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  // Mientras se envía, ni Escape ni el aspa cierran: el POST ya está en vuelo y
  // cerrar solo conseguiría no ver su resultado.
  useEscape(open && !enviando, onClose);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setElegido(null);
      setError(null);
      setEnviando(false);
      return;
    }
    let cancelado = false;
    setCargandoInfo(true);
    reloadCatalog().catch(() => {});
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Sin sesión");
        const res = await fetch("/api/admin/emergency-swap", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        // res.ok ANTES de parsear: un 504 de Vercel llega como respuesta
        // correcta con HTML dentro, y el `res.json()` a ciegas lo convertiría
        // en un SyntaxError que no se parece en nada a lo que pasó (regla 21).
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelado) setInfo(body);
      } catch (err) {
        console.error("[EmergencySwapModal] info:", err);
        // Sin info no se bloquea el modal: el recuento se anuncia como no
        // contado y el servidor sigue siendo quien valida el POST.
        if (!cancelado) setInfo(null);
      } finally {
        if (!cancelado) setCargandoInfo(false);
      }
    })();
    return () => {
      cancelado = true;
    };
    // reloadCatalog es estable (useCallback sin deps); depender de `open` es lo
    // que queremos: refrescar en cada apertura, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    const actual = info?.car?.id;
    const base = [...CARS]
      // El coche de hoy fuera de la lista: el servidor lo rechaza con 409
      // («Ese ya es el coche de hoy»), así que ofrecerlo solo sirve para
      // gastarle un clic al admin.
      .filter((c) => !actual || String(c.id) !== String(actual))
      .sort((a, b) =>
        `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`)
      );
    if (!q) return base;
    return base.filter((c) =>
      `${c.marca} ${c.modelo} ${c.anio}`.toLowerCase().includes(q)
    );
  }, [CARS, query, info]);

  async function confirmar() {
    if (!elegido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sin sesión");
      const res = await fetch("/api/admin/emergency-swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ car_id: elegido.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (typeof onSwapped === "function") onSwapped(body.car);
      onClose();
    } catch (err) {
      console.error("[EmergencySwapModal] swap:", err);
      // El error se queda EN la pantalla de confirmación, con el coche elegido
      // todavía delante: los 409 del servidor («ya fue coche del día», «no
      // tiene foto lista», «ha cambiado mientras tenías esto abierto») dicen
      // exactamente qué hacer, y perderlos al volver a la lista sería tirar la
      // única explicación que hay.
      setError(err?.message || "No se pudo cambiar el coche.");
    } finally {
      setEnviando(false);
    }
  }

  const cocheActual = info?.car || null;
  const revisiones = Array.isArray(info?.prevCarIds) ? info.prevCarIds.length : 0;
  const recuento = redactarRecuento(info?.jugadores);
  // Hoy sin fila en daily_cars: nadie ha abierto el juego todavía y no hay nada
  // que sustituir. El POST devolvería 409, así que se dice aquí y no se ofrece
  // la lista — pero solo cuando la info llegó BIEN: si el GET falló, `info` es
  // null por otro motivo y bloquear sería mentir.
  const sinCocheHoy = Boolean(info) && !cocheActual;

  return (
    <ModalShell
      open={open}
      onClose={enviando ? undefined : onClose}
      label="Cambio de emergencia del coche de hoy"
      backdropClassName="modal-scrim fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      panelClassName="modal-panel-flat relative flex max-h-[90vh] w-full max-w-md flex-col"
    >
      <div className="absolute right-2 top-2 z-10">
        <CloseButton onClick={enviando ? undefined : onClose} />
      </div>

      <header className="border-b border-border px-5 py-4">
        <p className="pm-kicker">Cambio de emergencia</p>
        <h2 className="pm-title mt-2 !text-xl">El coche de hoy</h2>

        {cargandoInfo ? (
          <p className="mt-3 text-xs uppercase tracking-widest text-muted">
            Comprobando la jornada...
          </p>
        ) : (
          <>
            {cocheActual && (
              <p className="mt-3 text-sm text-tinta">
                Hoy está en juego{" "}
                <span className="font-display">
                  {cocheActual.marca} {cocheActual.modelo}
                </span>{" "}
                <span className="tabular-nums text-muted">{cocheActual.anio}</span>
                {revisiones > 0 && (
                  <span className="text-muted">
                    {revisiones === 1
                      ? " · ya se cambió una vez hoy"
                      : ` · ya se cambió ${revisiones} veces hoy`}
                  </span>
                )}
              </p>
            )}
            <p className="pm-body mt-2 text-xs leading-relaxed">
              <span className="text-tinta">{recuento}</span> Quien ya haya
              empezado <span className="text-tinta">seguirá con el coche
              actual</span> hasta medianoche: no se le corta la partida ni puede
              volver a jugar. El coche que sale vuelve al bombo y aparecerá otro
              día.
            </p>
          </>
        )}
      </header>

      {sinCocheHoy ? (
        <div className="px-5 py-8 text-center text-sm text-muted">
          Hoy no tiene coche asignado todavía: no hay nada que cambiar.
        </div>
      ) : !elegido ? (
        /* Paso 1 — elegir. Pulsar aquí NO cambia nada todavía. */
        <>
          <div className="border-b border-border px-5 py-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar marca, modelo o año..."
              className="
                h-10 w-full rounded-none border border-tinta-2/40 bg-transparent
                px-3 font-body text-sm text-tinta outline-none
                placeholder:text-tinta-2/50 focus:border-rojo
              "
            />
          </div>
          <ul className="flex-1 overflow-y-auto px-3 py-2">
            {filtrados.length === 0 ? (
              <li className="px-2 py-6 text-center text-xs uppercase tracking-widest text-muted">
                {/* El catálogo ya no viene descargado de antes (se pide al
                    abrir), así que la lista vacía puede ser "todavía no ha
                    llegado". Decir «Catálogo vacío» ahí sería un diagnóstico
                    falso justo cuando el admin tiene prisa. */}
                {cargandoCatalogo && !catalog
                  ? "Cargando catálogo..."
                  : query
                    ? "Ningún coche encaja con la búsqueda"
                    : "Catálogo vacío"}
              </li>
            ) : (
              filtrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(c)}
                    className="
                      w-full px-2 py-2.5 text-left text-sm text-tinta transition
                      hover:bg-tinta/5
                    "
                  >
                    {c.marca} {c.modelo}{" "}
                    <span className="tabular-nums text-muted">{c.anio}</span>
                    <span className="block text-[11px] uppercase tracking-widest text-muted">
                      {c.pais}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      ) : (
        /* Paso 2 — confirmar. El coche elegido delante y el botón definitivo. */
        <div className="flex-1 overflow-y-auto px-5 py-6">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
            Vas a poner como coche de hoy
          </p>
          <p className="mt-2 font-display text-lg text-tinta">
            {elegido.marca} {elegido.modelo}{" "}
            <span className="tabular-nums text-muted">{elegido.anio}</span>
          </p>
          {cocheActual && (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              En lugar de{" "}
              <span className="text-tinta">
                {cocheActual.marca} {cocheActual.modelo}
              </span>
              , que vuelve al bombo.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 border border-rojo px-3 py-2 text-sm text-rojo">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setElegido(null)}
              disabled={enviando}
              className="
                flex-1 border border-tinta-2/40 px-3 py-2.5 text-[11px] uppercase
                tracking-[0.18em] text-tinta transition hover:border-tinta
                disabled:cursor-not-allowed disabled:opacity-40
              "
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className="
                flex-1 border border-rojo bg-rojo/10 px-3 py-2.5 text-[11px]
                uppercase tracking-[0.18em] text-rojo transition
                hover:bg-rojo/20 disabled:cursor-not-allowed disabled:opacity-40
              "
            >
              {enviando ? "Cambiando..." : "Cambiar ahora"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
