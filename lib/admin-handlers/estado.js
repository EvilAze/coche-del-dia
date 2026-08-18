// lib/admin-handlers/estado.js
// El cuadro de mandos del panel: los tres precipicios del juego en un objeto.
//
//   GET /api/admin/estado
//
// Todo el cálculo vive en la RPC `estado_operativo()`
// (scripts/2026-08-estado-operativo.sql). Aquí solo se traduce a JSON y se
// añade el VEREDICTO —el color de cada cifra—, que es lo único que este
// fichero decide.
//
// POR QUÉ EL VEREDICTO ESTÁ AQUÍ Y NO EN EL COMPONENTE: los umbrales son
// política («¿cuántos días de catálogo son pocos?»), no presentación. Puestos
// en el JSX se convierten en tres números sueltos entre clases de Tailwind, que
// es donde nadie los encuentra para discutirlos. Aquí se leen juntos y con su
// motivo al lado.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";

// Autonomía del catálogo, en días (1 coche = 1 día).
//   < 30  →  un mes. Es el punto en que hay que ponerse a dar de alta coches ya.
//   < 75  →  dos meses y medio: aún hay margen, pero conviene no olvidarlo.
// Por encima, silencio: un cuadro de mandos que avisa siempre no avisa nunca.
const AUTONOMIA_ROJA = 30;
const AUTONOMIA_AMBAR = 75;

// Días que le quedan a la temporada en curso. La regla de diseño es que duren
// una semana, así que dos días es el aviso de «prepara la siguiente» y cero
// significa que hoy es el último.
const TEMPORADA_AMBAR = 2;

function veredicto(nivel, texto) {
  return { nivel, texto };
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/estado] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const { data, error } = await getSupabaseAdmin().rpc("estado_operativo");
    if (error) {
      console.error("[admin/estado] rpc:", error.message);
      return res.status(500).json({ error: "DB error", detalle: error.message });
    }

    // La RPC devuelve TABLE, o sea un array de una fila.
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) {
      return res.status(500).json({ error: "Sin datos" });
    }

    const autonomia = r.cars_sin_estrenar ?? 0;
    const diasSinFoto = r.dias_sin_foto ?? 0;
    const diasTemporada = r.temporada_dias_restantes;
    const haySiguiente = r.siguiente_inicio != null;

    const avisos = {
      autonomia:
        autonomia < AUTONOMIA_ROJA
          ? veredicto("rojo", `Quedan ${autonomia} coches sin estrenar`)
          : autonomia < AUTONOMIA_AMBAR
          ? veredicto("ambar", `${autonomia} coches: menos de tres meses`)
          : veredicto("ok", null),

      // Este no tiene grados: o hay cero, o hay una jornada que va a dar 500.
      fotos:
        diasSinFoto > 0
          ? veredicto(
              "rojo",
              `${diasSinFoto} día(s) programados con un coche sin foto (el primero, el ${r.primer_dia_sin_foto})`
            )
          : veredicto("ok", null),

      temporada:
        diasTemporada == null
          ? veredicto("rojo", "No hay temporada en curso: la clasificación está vacía")
          : !haySiguiente
          ? veredicto(
              "rojo",
              `La temporada acaba en ${diasTemporada} día(s) y NO hay siguiente`
            )
          : r.hueco_dias > 0
          ? veredicto(
              "ambar",
              `${r.hueco_dias} día(s) de hueco antes de la siguiente temporada`
            )
          : diasTemporada <= TEMPORADA_AMBAR
          ? veredicto("ambar", `Último(s) ${diasTemporada} día(s) de temporada`)
          : veredicto("ok", null),
    };

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      catalogo: {
        sinEstrenar: autonomia,
        borradores: r.cars_borradores ?? 0,
        total: r.cars_total ?? 0,
      },
      calendario: {
        diasProgramados: r.dias_programados ?? 0,
        diasSinFoto,
        primerDiaSinFoto: r.primer_dia_sin_foto,
      },
      temporada: {
        numero: r.temporada_numero,
        label: r.temporada_label,
        fin: r.temporada_fin,
        diasRestantes: diasTemporada,
        siguienteNumero: r.siguiente_numero,
        siguienteInicio: r.siguiente_inicio,
        huecoDias: r.hueco_dias,
      },
      avisos,
    });
  } catch (err) {
    console.error("[admin/estado] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
