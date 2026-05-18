// api/garage.js
// Devuelve el "Garaje" (álbum de cromos) del usuario autenticado:
// catálogo entero agrupado por país, marcando cuáles ha desbloqueado.
//
// Reglas:
//   - Solo usuarios autenticados. El garaje es un beneficio de registrarse.
//   - Cromo desbloqueado = el usuario tiene una fila en user_guesses con
//     status='won' para ese car_id (no importa la fecha; un coche que ya
//     no es el del día sigue contando en el álbum).
//   - Cromos bloqueados se devuelven con id solamente (sin marca/modelo
//     /año/imagen): no queremos filtrar pistas sobre el coche del día.
//   - Cromos desbloqueados llevan info completa incluida la URL pública
//     de la imagen, que el frontend muestra directo (las imágenes son
//     públicas; lo restringido era el cruce con el coche-del-día, ya
//     mitigado por el sistema de proxy + RPC).

import { createClient } from "@supabase/supabase-js";
import { pseudoIdFor } from "./_lib/repesca-token.js";
import {
  signImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
} from "./_lib/image-token.js";

// Helper local: arma la URL del proxy server-side de imágenes del garaje.
// Tanto unlocked como locked van por aquí: simetría de URLs en el front
// y, para los bloqueados, garantía de que el image_url real NUNCA llega
// al navegador (no se puede "abrir DevTools" para spoilear el coche).
function carImageProxyUrl(carId, mode) {
  return `/api/car-image?t=${signImageToken({ carId, mode })}`;
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch (err) {
    console.error("[garage] authClientAndUser:", err);
    return { client: null, user: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const accessToken = extractAccessToken(req);
    const { client: authClient, user } = await authClientAndUser(accessToken);
    if (!user || !authClient) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 1) Catálogo completo (con image_url y description, columnas
    //    privilegiadas → service_role).
    const { data: cars, error: carsErr } = await supabaseAdmin
      .from("cars")
      .select("id, make, model, year, pais, description, description_en, image_url")
      .order("year", { ascending: true });
    if (carsErr) {
      console.error("[garage] read cars:", carsErr);
      return res.status(500).json({ error: "Failed to read catalog" });
    }

    // 2) Coches que el usuario ha ganado (status='won').
    //    user_guesses tiene RLS (auth.uid()=user_id), authClient incluye
    //    el bearer del usuario, así que la query devuelve solo SU historial.
    const { data: wins, error: winsErr } = await authClient
      .from("user_guesses")
      .select("car_id")
      .eq("user_id", user.id)
      .eq("status", "won");
    if (winsErr) {
      console.error("[garage] read user_guesses:", winsErr);
      return res.status(500).json({ error: "Failed to read wins" });
    }

    const unlockedIds = new Set((wins || []).map((w) => w.car_id));

    // 3) Coches que YA han sido coche del día (fecha < hoy). Solo estos son
    //    repescables. Usamos service_role: pick_daily_car y daily_cars están
    //    revocados para anon/authenticated por hardening previo.
    const todayDate = todayInMadrid();
    const { data: pastDailies, error: dailiesErr } = await supabaseAdmin
      .from("daily_cars")
      .select("car_id")
      .lt("date", todayDate);
    if (dailiesErr) {
      console.error("[garage] read daily_cars:", dailiesErr);
      return res.status(500).json({ error: "Failed to read history" });
    }
    const pastDailyIds = new Set((pastDailies || []).map((d) => d.car_id));

    // 4) Estado de la repesca del usuario: si hay una activa hoy, no puede
    //    iniciar otra. Si la activa coincide con un coche concreto, podemos
    //    indicarlo para que el frontend ofrezca "Continuar" en lugar de
    //    "Iniciar".
    const { data: statsRow, error: statsErr } = await authClient
      .from("stats")
      .select("last_repesca_at, last_repesca_car_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsErr) {
      console.error("[garage] read stats:", statsErr);
      // No abortamos: si stats no se puede leer, asumimos repesca disponible
      // como degradación segura (la verificación real ocurre en /start).
    }
    const lastRepescaAt = statsRow?.last_repesca_at || null;
    const repescaConsumedToday = lastRepescaAt === todayDate;
    const repescaAvailable = !repescaConsumedToday;
    const repescaActiveCarId = repescaConsumedToday
      ? statsRow?.last_repesca_car_id || null
      : null;

    // 3) Agrupar por país. Sin clase de coche → "Sin país" como cubo
    //    fallback (en la práctica no debería pasar porque pais es required
    //    en /admin/add-car, pero defensivo).
    const byCountry = new Map();
    for (const c of cars || []) {
      const pais = c.pais || "Sin país";
      if (!byCountry.has(pais)) {
        byCountry.set(pais, { pais, cars: [] });
      }
      const unlocked = unlockedIds.has(c.id);
      const wasDaily = pastDailyIds.has(c.id);
      byCountry.get(pais).cars.push(
        unlocked
          ? {
              // Cromo desbloqueado: id real. El usuario ya ganó este
              // coche, conoce todos sus datos, no hay nada que ocultar.
              id: c.id,
              marca: c.make,
              modelo: c.model,
              anio: c.year,
              description: c.description ?? null,
              description_en: c.description_en ?? null,
              // Servimos también las imágenes desbloqueadas a través del
              // proxy: simetría de URLs y oportunidad de rotar el CDN
              // sin tocar el frontend. En modo "clear" el endpoint hace
              // 302 a la URL pública de Supabase, así que no añade peso.
              img: carImageProxyUrl(c.id, IMAGE_MODE_CLEAR),
              unlocked: true,
              wasDaily,
            }
          : {
              // Cromo bloqueado: id OPACO (pseudo HMAC por usuario). Si
              // devolviésemos el cars.id real aquí, cualquier atacante
              // podría cruzarlo con /api/list-cars y obtener marca/
              // modelo/año del coche objetivo de repesca antes de jugar.
              // Con el pseudo, esa correlación queda rota: list-cars
              // sigue exponiendo ids reales, pero estos ids opacos no
              // matchean con nada de allí.
              id: pseudoIdFor(c.id, user.id),
              marca: c.make,
              // Imagen blureada server-side: el cliente solo recibe un
              // JPEG ya desenfocado y oscurecido (no la URL original).
              // No se puede "ver con F12" la imagen nítida.
              img: carImageProxyUrl(c.id, IMAGE_MODE_BLURRED),
              unlocked: false,
              wasDaily,
            }
      );
    }

    // 4) Salida ordenada: países por progreso desc (más desbloqueados primero)
    //    y, dentro de cada país, desbloqueados antes que bloqueados.
    //    Esto da una primera impresión más satisfactoria al abrir el álbum.
    const countries = Array.from(byCountry.values())
      .map((c) => {
        const unlocked = c.cars.filter((x) => x.unlocked).length;
        return {
          pais: c.pais,
          total: c.cars.length,
          unlocked,
          cars: c.cars.sort((a, b) => {
            if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
            if (a.unlocked && b.unlocked) {
              // dentro de desbloqueados, ordena por año ascendente
              return (a.anio || 0) - (b.anio || 0);
            }
            return 0;
          }),
        };
      })
      .sort((a, b) => {
        // Primero los países donde el usuario tenga más progreso absoluto.
        if (b.unlocked !== a.unlocked) return b.unlocked - a.unlocked;
        // Empate: alfabético.
        return a.pais.localeCompare(b.pais, "es");
      });

    const totalCatalog = (cars || []).length;
    const totalUnlocked = unlockedIds.size;

    // Sin cache: el album es por-usuario y cambia tras cada victoria.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      totalCatalog,
      totalUnlocked,
      countries,
      // Repesca (sistema "una al día"):
      //   repescaAvailable     → true si el usuario no ha consumido repesca
      //                          hoy. El frontend usa este flag para decidir
      //                          si las cards repescables son interactivas
      //                          (Estado B) o solo decorativas (Estado C).
      //   repescaActiveCarId   → si hay una repesca en curso (consumida hoy
      //                          pero sin terminar), aquí va el car_id que
      //                          el usuario eligió. Permite "Continuar".
      repescaAvailable,
      // Convertimos también el carId de la repesca activa a pseudo para
      // que el frontend pueda hacer `car.id === repescaActiveCarId` y
      // detectar la card "Continuar" sin necesidad de conocer el id real.
      repescaActiveCarId: repescaActiveCarId
        ? pseudoIdFor(repescaActiveCarId, user.id)
        : null,
    });
  } catch (err) {
    console.error("[garage] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
