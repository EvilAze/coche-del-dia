// lib/admin-handlers/mensajes.js
// La bandeja del panel: lo que los jugadores escriben desde la app.
//
//   GET  /api/admin/mensajes?estado=sin_leer|todos
//   POST /api/admin/mensajes { id, leido: true|false }
//
// La tabla es deny-all (scripts/2026-08-buzon-de-mensajes.sql): se lee aquí con
// service_role y en ningún otro sitio. Un jugador no puede ver ni lo que
// escribió él, y mucho menos lo que escribieron los demás — que incluye los
// reportes sobre otros jugadores.
//
// POR QUÉ SE ENRIQUECE CON EL EMAIL DE LA CUENTA: el mensaje trae el `user_id`,
// que es lo bueno de un buzón dentro del juego frente a un correo suelto —se
// sabe quién escribe sin preguntarlo—. Pero un uuid no sirve para contestar ni
// para reconocer a nadie, así que aquí se cruza con auth.users y con profiles
// para devolver también su nick y su correo. El `email` de la propia fila es
// otra cosa: el que el jugador TECLEÓ, que puede no existir (un anónimo no
// tiene cuenta) o ser distinto del de su cuenta.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Techo de la bandeja. A este volumen sobra de largo, y evita que un día de
// spam que se cuele por la cuota convierta la carga del panel en una descarga.
const LIMITE = 200;

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/mensajes] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const admin = getSupabaseAdmin();

    // ---- Marcar leído / no leído ----
    if (req.method === "POST") {
      const body = parseBody(req);
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "id inválido" });
      }
      const leido = body?.leido !== false; // por defecto, marcar como leído
      const { error } = await admin
        .from("mensajes")
        .update({ leido_en: leido ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) {
        console.error("[admin/mensajes] marcar:", error.message);
        return res.status(500).json({ error: "DB error" });
      }
      return res.status(200).json({ ok: true, leido });
    }

    // ---- Listado ----
    const soloSinLeer = String(req.query.estado || "sin_leer") === "sin_leer";
    let q = admin
      .from("mensajes")
      .select("id, user_id, tipo, cuerpo, email, plataforma, creado_en, leido_en")
      .order("creado_en", { ascending: false })
      .limit(LIMITE);
    if (soloSinLeer) q = q.is("leido_en", null);

    const { data: filas, error } = await q;
    if (error) {
      // Tolerante a que la migración no esté aplicada: el panel entero no puede
      // caerse por una tabla que aún no existe (mismo criterio que el
      // `migrationPending` de audit.js).
      const pendiente = ["PGRST205", "42P01"];
      if (pendiente.includes(error.code)) {
        return res.status(200).json({ migrationPending: true, mensajes: [], sinLeer: 0 });
      }
      console.error("[admin/mensajes] listar:", error.message);
      return res.status(500).json({ error: "DB error" });
    }

    const mensajes = filas || [];

    // Nick y correo de cuenta de quien escribe. Dos consultas acotadas a los
    // ids que salen en la bandeja, no la tabla entera.
    const ids = [...new Set(mensajes.map((m) => m.user_id).filter(Boolean))];
    const nickPorId = new Map();
    const emailPorId = new Map();

    if (ids.length) {
      // Los nicks salen de una consulta; los correos, del camino de admin de
      // GoTrue uno a uno, porque `getUserById` no admite lista. Van todos en
      // paralelo y son a lo sumo unas decenas por carga.
      //
      // `allSettled` y no `all`: una cuenta borrada en blando o un id que ya no
      // resuelve devolvería un rechazo, y eso tumbaría la bandeja ENTERA por no
      // poder poner un correo al lado de un mensaje. Sin correo se lee igual.
      const [perfiles, usuarios] = await Promise.all([
        admin.from("profiles").select("id, display_name").in("id", ids),
        Promise.allSettled(ids.map((id) => admin.auth.admin.getUserById(id))),
      ]);

      for (const p of perfiles.data || []) nickPorId.set(p.id, p.display_name);
      usuarios.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value?.data?.user) {
          emailPorId.set(ids[i], r.value.data.user.email || null);
        }
      });
    }

    // Recuento de pendientes SIEMPRE, mire la bandeja lo que mire: es lo que
    // pinta el contador de la pestaña, y con el filtro en "todos" el listado no
    // lo puede dar.
    const { count: sinLeer } = await admin
      .from("mensajes")
      .select("id", { count: "exact", head: true })
      .is("leido_en", null);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      migrationPending: false,
      sinLeer: sinLeer ?? 0,
      mensajes: mensajes.map((m) => ({
        ...m,
        nick: nickPorId.get(m.user_id) || null,
        emailCuenta: emailPorId.get(m.user_id) || null,
      })),
    });
  } catch (err) {
    console.error("[admin/mensajes] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
