// api/get-daily-car.js
// Devuelve el estado del juego de HOY sin filtrar ningún dato cruzable con
// el catálogo público:
//   - NO se devuelve `id` del coche del día (antes permitía cruzarlo con
//     /api/list-cars y deducir marca/modelo/año).
//   - NO se devuelve la URL real del CDN (antes contenía el nombre del coche
//     en el filename). En su lugar apuntamos al proxy /api/daily-image, que
//     sirve los bytes desde nuestro servidor.
//
// Para usuarios logueados también devolvemos el estado guardado (intentos,
// status, score si ganó/perdió) leyéndolo server-side de user_guesses, para
// que el frontend no tenga que conocer el car_id para hacer esa consulta.

import crypto from "node:crypto";
import { readAnonSession, setAnonCookie } from "./_lib/anon-session.js";
import { signRevealToken } from "./_lib/reveal-token.js";
import { supabaseAdmin } from "./_lib/supabase.js";
import { extractAccessToken, authClientAndUser } from "./_lib/auth.js";
import { todayInMadrid } from "./_lib/date.js";

export default async function handler(req, res) {
  if (!supabaseAdmin) {
    console.error("[get-daily-car] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const today = todayInMadrid();

  // Resolvemos el coche del día solo para verificar que existe y para que la
  // RPC haga su trabajo de fijarlo en daily_cars. NO devolvemos el id.
  const { data: todayCarId, error: rpcErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (rpcErr || !todayCarId) {
    console.error("[get-daily-car] pick_daily_car:", rpcErr);
    return res.status(500).json({ message: "Failed to pick daily car" });
  }

  const accessToken = extractAccessToken(req);
  const { client: authClient, user } = await authClientAndUser(accessToken);

  // Cache-buster derivado de image_url. Cuando el admin reemplaza la foto
  // desde /admin/edit-car, el nuevo path lleva Date.now() en el nombre, así
  // que image_url cambia y el hash cambia → el navegador y el CDN reciben
  // un URL distinto y refrescan al instante, sin esperar al s-maxage de 24h
  // del endpoint /api/daily-image.
  // Si admin solo edita texto (marca/modelo/año/país/descripción), image_url
  // no se toca, el hash es estable y el CDN mantiene el hit caliente para
  // todos los visitantes.
  // El hash NO filtra el coche: image_url no es público (list-cars lo omite)
  // y un sha1 truncado no permite reverse-engineering.
  // Aprovechamos para leer también blur_data — el LQIP que el cliente pinta
  // como fondo del skeleton mientras descarga la foto real. La data URI pesa
  // ~0.5-1 KB, despreciable comparado con el coste de pintar gris vacío.
  // image_url NO se devuelve al cliente; solo sirve para computar el hash.
  const { data: imgRow, error: imgRowErr } = await supabaseAdmin
    .from("cars")
    .select("image_url, blur_data")
    .eq("id", todayCarId)
    .maybeSingle();
  if (imgRowErr) {
    // Si esto falla por algún motivo, seguimos sin versión (cache "vieja"
    // hasta el TTL natural). Es estrictamente mejor que romper la home.
    console.error("[get-daily-car] read image_url for version:", imgRowErr);
  }
  const imgVersion = imgRow?.image_url
    ? crypto.createHash("sha1").update(imgRow.image_url).digest("hex").slice(0, 8)
    : "0";
  const dailyImgUrl = `/api/daily-image?d=${today}&v=${imgVersion}`;
  const blurData = imgRow?.blur_data || null;

  // Estado base que vale para anónimos.
  const base = {
    date: today,
    img: dailyImgUrl,
    blurData,
    guesses: [],
    status: "playing",
    reveal: null,
  };

  if (!user) {
    // Sesión anónima: gestionamos un cookie HttpOnly firmado para que
    // /api/validate-guess pueda contar intentos server-side. Sin esto,
    // el endpoint validaba `attemptNumber` desde el body — un script
    // podía iterar todo el catálogo con attemptNumber:1 y descubrir el
    // coche del día via `result.win` en alguna iteración.
    //
    // Estrategia:
    //   - Si el visitante NO tiene cookie válida del día → emitimos una
    //     fresca con n=0, s=playing.
    //   - Si la tiene y es de hoy → la respetamos (no se pisa el progreso).
    //   - Si la tiene pero es de un día anterior → la reemplazamos.
    const anon = readAnonSession(req);
    const anonValid =
      anon &&
      anon.d === today &&
      Number.isInteger(anon.n) &&
      typeof anon.s === "string";
    if (!anonValid) {
      try {
        setAnonCookie(res, { d: today, n: 0, s: "playing" });
      } catch (err) {
        // Si REPESCA_TOKEN_SECRET no está configurado, dejamos al usuario
        // jugar sin cookie. validate-guess se quejará pero al menos la
        // home no rompe.
        console.error("[get-daily-car] setAnonCookie:", err?.message || err);
      }
    }

    // Si el anónimo ya GANÓ hoy, le damos el revealToken para que pueda
    // ver la imagen completa al refrescar. Si PERDIÓ, NO se lo damos:
    // firmarle el token le permitiría pedir /api/daily-image?t=... y ver
    // el coche entero, regalándole la respuesta. Ese es exactamente el
    // cheat "abrir incógnito → fallar adrede → leer/ver el coche →
    // jugar con la cuenta real ya sabiendo la respuesta". Asimetría
    // intencional. El cliente perdedor anónimo queda con la imagen
    // blurred + overlay de login (lo gestiona CarImage).
    let revealToken = null;
    if (anonValid && anon.s === "won") {
      try {
        revealToken = signRevealToken(today);
      } catch (err) {
        console.error("[get-daily-car] signRevealToken (anon):", err?.message || err);
      }
    }

    // No queremos que un CDN cachee el estado del usuario.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...base, revealToken });
  }

  // Usuario logueado: leemos su fila de user_guesses (RLS exige auth.uid()).
  const { data: row, error: rowErr } = await authClient
    .from("user_guesses")
    .select("guesses, status")
    .eq("user_id", user.id)
    .eq("car_id", todayCarId)
    .eq("date", today)
    .maybeSingle();

  if (rowErr) {
    console.error("[get-daily-car] read user_guesses:", rowErr);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(base);
  }

  const status = row?.status || "playing";
  const guesses = Array.isArray(row?.guesses) ? row.guesses : [];

  // Revelamos marca/modelo/año si el usuario ganó o si perdió. Leemos los
  // datos LIVE desde `cars` (no desde la copia congelada en user_guesses)
  // para que las correcciones que haga el admin en /admin/edit-car se
  // reflejen al instante en pantalla — hot-swap real.
  let reveal = null;
  if (status === "won" || status === "lost") {
    const { data: liveCar, error: liveErr } = await supabaseAdmin
      .from("cars")
      .select("make, model, year, pais, description, description_en")
      .eq("id", todayCarId)
      .maybeSingle();
    if (liveErr) {
      console.error("[get-daily-car] read cars (live):", liveErr);
    } else if (liveCar) {
      reveal = {
        marca: liveCar.make,
        modelo: liveCar.model,
        anio: liveCar.year,
        pais: liveCar.pais,
        description: liveCar.description ?? null,
        description_en: liveCar.description_en ?? null,
      };
    }
  }

  // Token de reveal cuando el usuario ya cerró la partida: permite que la
  // request a /api/daily-image sin `?z` reciba la imagen completa. Sin este
  // token, el endpoint cae al crop de seguridad (z=5) — bloquea el viejo
  // truco de "abrir DevTools → quitar &z=5 → ver foto entera".
  let revealToken = null;
  if (status === "won" || status === "lost") {
    try {
      revealToken = signRevealToken(today);
    } catch (err) {
      console.error("[get-daily-car] signRevealToken:", err?.message || err);
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    date: today,
    img: dailyImgUrl,
    blurData,
    guesses,
    status,
    reveal,
    revealToken,
  });
}
