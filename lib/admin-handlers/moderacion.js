// lib/admin-handlers/moderacion.js
// La palanca de moderación del único contenido que un jugador escribe y otros
// jugadores leen: su nick (`profiles.display_name`), que sale en la
// clasificación, en el podio, en el salón de campeones y en el perfil público.
//
// Hasta agosto de 2026 no había ninguna. Si alguien ponía un insulto en la
// tabla pública, el remedio era abrir el SQL editor de Supabase — o sea, no
// había remedio a las once de la noche desde el móvil.
//
// Métodos (bajo /api/admin/moderacion vía el dispatcher [...slug].js):
//   POST { userId, action: "retirar-nick", motivo? }
//     Pone display_name a NULL y APUNTA el nombre en `nicks_retirados` para
//     que no se pueda volver a tomar. Devuelve { ok, nick } con el nick que se
//     retiró (para que el panel pueda decir qué acaba de pasar).
//
//   POST { userId, action: "excluir-clasificacion" | "readmitir-clasificacion", motivo? }
//     Enciende o apaga `profiles.is_flagged`, el shadowban del proyecto. Sigue
//     jugando, sigue sumando puntos y sigue viendo sus estadísticas; deja de
//     salir en las cuatro tablas públicas y de entrar en los podios que se
//     sellen luego.
//
//     El flag actúa por DOS caminos, y hacen falta los dos: las policies de RLS
//     `profiles_select` y `stats_select` tapan las lecturas directas del
//     cliente, y un predicado explícito en cada función de clasificación tapa
//     las RPC, que al ser SECURITY DEFINER se saltan RLS. Ver
//     scripts/2026-08-unificar-shadowban.sql.
//
// LAS DOS ACCIONES SON INDEPENDIENTES A PROPÓSITO. Un nick ofensivo no es una
// trampa y una trampa no obliga a cambiar de nombre: mezclarlas en un solo
// botón «sancionar» obligaría a elegir siempre las dos cosas a la vez.
//
// ─── POR QUÉ «RETIRAR» Y NO «RENOMBRAR» ────────────────────────────────────
// La primera idea era un campo para escribirle otro nombre al jugador. Es
// peor: convierte al admin en el autor de la identidad de otro, obliga a
// inventar un nombre («USUARIO7») que no significa nada para nadie, y deja al
// jugador con una firma que no eligió y que no entiende de dónde salió.
//
// Retirar es más limpio y usa maquinaria que ya existe: sin display_name, las
// funciones de clasificación descartan la fila solas (`WHERE display_name IS
// NOT NULL`), así que el nombre desaparece de la tabla pública en el acto; y
// la próxima vez que el jugador abra la clasificación, el modal de nick le
// pide uno, que es el flujo normal de alguien que aún no lo ha elegido. No
// hace falta pantalla nueva ni copia nueva.
//
// Lo que NO hace: tocar la puntuación. Un nick feo no es una trampa. Excluir a
// alguien de la clasificación es otra decisión, con otro botón, y va aparte.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/moderacion] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    // El email del admin se usa más abajo para dejar rastro de QUIÉN retiró
    // qué: una acción de moderación sin autor es una acción que nadie puede
    // revisar después.
    const { user, error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const body = parseBody(req);
    const accion = body?.action;
    const ACCIONES = [
      "retirar-nick",
      "excluir-clasificacion",
      "readmitir-clasificacion",
    ];
    if (!ACCIONES.includes(accion)) {
      return res.status(400).json({ error: "Unknown action" });
    }

    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ error: "userId inválido" });
    }

    const admin = getSupabaseAdmin();
    const motivo =
      typeof body?.motivo === "string" && body.motivo.trim()
        ? body.motivo.trim().slice(0, 200)
        : null;

    // El interruptor es `profiles.is_flagged`, que existe desde junio de 2026 y
    // ya lo miran dos policies de RLS. Ver scripts/2026-08-unificar-shadowban.sql:
    // hubo un momento en que esto escribía en una tabla propia y eran dos
    // shadowbans distintos, cada uno tapando la mitad de los caminos.
    if (accion === "excluir-clasificacion" || accion === "readmitir-clasificacion") {
      const excluir = accion === "excluir-clasificacion";
      const { data, error } = await admin
        .from("profiles")
        .update({ is_flagged: excluir })
        .eq("id", userId)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("[admin/moderacion] is_flagged:", error.message);
        return res.status(500).json({ error: "DB error" });
      }
      if (!data) {
        return res.status(404).json({ error: "Perfil no encontrado" });
      }

      console.log(
        `[admin/moderacion] ${user?.email || "?"} ${
          excluir ? "marcó" : "desmarcó"
        } a ${userId}${motivo ? ` (${motivo})` : ""}`
      );
      return res.status(200).json({ ok: true, excluido: excluir });
    }

    // ---- retirar-nick ----

    // 1) Leer el nick actual. Hace falta ANTES de borrarlo: es lo que se apunta
    //    en la lista de retirados, y si la fila no tiene nick no hay nada que
    //    hacer (204 en vez de fingir que se hizo algo).
    const { data: perfil, error: leerErr } = await admin
      .from("profiles")
      .select("id, display_name")
      .eq("id", userId)
      .maybeSingle();

    if (leerErr) {
      console.error("[admin/moderacion] leer perfil:", leerErr.message);
      return res.status(500).json({ error: "DB error" });
    }
    if (!perfil) {
      return res.status(404).json({ error: "Perfil no encontrado" });
    }
    if (!perfil.display_name) {
      return res.status(200).json({ ok: true, nick: null, yaEstaba: true });
    }

    const nick = perfil.display_name;

    // 2) Apuntar el nombre como retirado ANTES de liberarlo. El orden importa:
    //    al revés hay una ventana —corta, pero real— en la que el nombre está
    //    libre y sin apuntar, y es justo el nombre que alguien acaba de estar
    //    usando. `upsert` porque retirar dos veces el mismo nombre (dos cuentas
    //    con la misma idea) no es un error.
    const { error: apuntarErr } = await admin.from("nicks_retirados").upsert(
      {
        nick_lower: nick.toLowerCase(),
        motivo: motivo || `retirado por ${user?.email || "admin"}`,
      },
      { onConflict: "nick_lower" }
    );

    if (apuntarErr) {
      console.error("[admin/moderacion] apuntar retirado:", apuntarErr.message);
      return res.status(500).json({ error: "DB error" });
    }

    // 3) Liberar la firma. El trigger profiles_nick_no_retirado ya impide que
    //    vuelva a tomarse, aquí o en cualquier otra cuenta.
    const { error: limpiarErr } = await admin
      .from("profiles")
      .update({ display_name: null })
      .eq("id", userId);

    if (limpiarErr) {
      console.error("[admin/moderacion] limpiar nick:", limpiarErr.message);
      return res.status(500).json({ error: "DB error" });
    }

    // Rastro en los logs de Vercel. No hay tabla de auditoría de moderación —
    // `guess_audit` es otra cosa (anti-trampas) y montar una para un botón que
    // se usará tres veces al año sería desproporcionado. El log lleva quién,
    // a quién y cuándo, que es lo que haría falta para revisar la decisión.
    console.log(
      `[admin/moderacion] ${user?.email || "?"} retiró el nick de ${userId}`
    );

    return res.status(200).json({ ok: true, nick });
  } catch (err) {
    console.error("[admin/moderacion] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
