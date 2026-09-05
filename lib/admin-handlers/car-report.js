// lib/admin-handlers/car-report.js
// La FICHA DE RENDIMIENTO de un coche:
//
//   GET /api/admin/car-report            → el coche de HOY
//   GET /api/admin/car-report?id=<uuid>  → ese coche
//
// El agregado lo hace la RPC get_car_report
// (scripts/2026-09-ficha-rendimiento-coche.sql); aquí solo se derivan las
// métricas y el veredicto, que viven en dificultad.js para no volver a tener el
// mismo número escrito en cuatro sitios.
//
// POR QUÉ EL DEFAULT ES EL COCHE DE HOY: es la pregunta que más veces se hace
// («¿cómo va lo de hoy?») y así el panel puede abrir enseñándola sin que el
// front tenga que averiguar antes qué coche toca.
//
// LEE daily_cars, NO llama a pick_daily_car: mirar la ficha no puede tener el
// efecto secundario de FIJAR el coche del día. Si hoy aún no está sorteado,
// se contesta honestamente que no hay.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { derivarMetricas, veredicto, COSTE_OBJETIVO } from "./dificultad.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/car-report] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const hoy = todayInMadrid();
    const idQ = typeof req.query?.id === "string" ? req.query.id.trim() : "";

    let carId = idQ;
    if (!carId) {
      // Sin id: resolvemos el coche de hoy leyendo daily_cars. Un SELECT, nunca
      // pick_daily_car (ver cabecera).
      const { data: fila, error: hoyError } = await getSupabaseAdmin()
        .from("daily_cars")
        .select("car_id")
        .eq("date", hoy)
        .maybeSingle();
      if (hoyError) {
        console.error("[admin/car-report] daily_cars hoy:", hoyError.message);
        return res.status(500).json({ error: "DB error" });
      }
      if (!fila) {
        // Todavía no hay sorteo para hoy. No es un error: es un estado.
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ carId: null, hoy, sinCocheHoy: true });
      }
      carId = fila.car_id;
    } else if (!UUID_RE.test(carId)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const { data, error } = await getSupabaseAdmin().rpc("get_car_report", {
      p_car_id: carId,
    });
    if (error) {
      console.error("[admin/car-report] rpc:", error.message);
      return res.status(500).json({ error: "DB error", detalle: error.message });
    }

    // La RPC devuelve TABLE: un array de una fila.
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) {
      return res.status(500).json({ error: "Sin datos" });
    }

    const m = derivarMetricas(r);
    // El día no ha cerrado: las cifras son parciales y el panel tiene que
    // decirlo. Sin esto, un 40% de acierto a las once de la mañana se lee como
    // el resultado final del coche.
    const enCurso = r.aired_on != null && String(r.aired_on) === hoy;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      carId,
      hoy,
      emitido: r.aired_on ?? null,
      emisiones: r.aired_count ?? 0,
      enCurso,
      diario: {
        partidas: m.total,
        aciertos: m.wins,
        fallos: m.losses,
        intentos: m.intentos,
        winRate: m.winRate,
        intentoMedio: m.intentoMedio,
        pBy3: m.pBy3,
        coste: m.coste,
      },
      // Aparte y sin sumarse al histograma: en repesca veterano solo hay un
      // intento, así que mezclarla falsearía el ratio de fallo.
      repesca: {
        partidas: r.repesca_plays ?? 0,
        aciertos: r.repesca_wins ?? 0,
      },
      veredicto: veredicto(m.coste),
      costeObjetivo: COSTE_OBJETIVO,
    });
  } catch (err) {
    console.error("[admin/car-report] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
