// api/garage.js
// Devuelve "El Archivo" (la colección de portadas) del usuario autenticado:
// catálogo entero agrupado por país, marcando cuáles ha desbloqueado.
// (El endpoint conserva el nombre histórico `garage`; el producto se llama
// «El Archivo» desde el rediseño de colección.)
//
// Reglas:
//   - Solo usuarios autenticados. El archivo es un beneficio de registrarse.
//   - Cromo desbloqueado = el usuario tiene una fila en user_guesses con
//     status='won' para ese car_id (no importa la fecha; un coche que ya
//     no es el del día sigue contando en el álbum).
//   - Cromos bloqueados se devuelven con id solamente (sin marca/modelo
//     /año/imagen): no queremos filtrar pistas sobre el coche del día.
//   - Cromos desbloqueados llevan info completa incluida la URL pública
//     de la imagen, que el frontend muestra directo (las imágenes son
//     públicas; lo restringido era el cruce con el coche-del-día, ya
//     mitigado por el sistema de proxy + RPC).

import { pseudoIdFor } from "./_lib/repesca-token.js";
import { repescaJugada, repescaEnCurso } from "./_lib/repesca/consumo.js";
import { repescaActiva } from "./_lib/repesca/activa.js";
import {
  signImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
} from "./_lib/image-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { requireUser } from "./_lib/auth.js";
import { todayInMadrid } from "./_lib/date.js";
import { methodGuard, applyCors } from "./_lib/http.js";
import { captureServerError } from "./_lib/sentry.js";

// Helper local: arma la URL del proxy server-side de imágenes del garaje.
// Tanto unlocked como locked van por aquí: simetría de URLs en el front
// y, para los bloqueados, garantía de que el image_url real NUNCA llega
// al navegador (no se puede "abrir DevTools" para spoilear el coche).
function carImageProxyUrl(carId, mode) {
  return `/api/car-image?t=${signImageToken({ carId, mode })}`;
}

// Nº de intentos con los que se ganó una partida. `guesses` es el historial
// completo que persiste validate-guess; su longitud ES el nº de intentos.
// Aceptamos array (jsonb) y string (si la columna viajase como text/json),
// porque el SQL de temporadas castea `guesses::jsonb` y esa ambigüedad
// sugiere que no siempre llega tipada.
// Columnas del catálogo. La rareza va aparte porque se pide en un select
// separado que puede fallar si la migración aún no está aplicada (ver abajo).
const CAR_COLS =
  "id, make, model, year, pais, description, description_en, image_url";
const RARITY_COLS = "rarity_owners, rarity_collectors, rarity_pct";

// Coleccionistas mínimos para que un porcentaje de rareza signifique algo.
// Con menos, cada usuario nuevo mueve el dato varios puntos y la etiqueta
// («número agotado») sería puro ruido con aires de dato.
const MIN_COLLECTORS_FOR_RARITY = 20;

function attemptsFromGuesses(guesses) {
  try {
    const arr = typeof guesses === "string" ? JSON.parse(guesses) : guesses;
    return Array.isArray(arr) && arr.length > 0 ? arr.length : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  if (methodGuard(req, res, "GET")) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.error(`[garage] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { user, authClient, error: authError } = await requireUser(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    // 1) Catálogo completo (con image_url, description y rareza: columnas
    //    privilegiadas → service_role).
    //    rarity_* lo precalcula el cron nocturno (recompute_cover_rarity);
    //    aquí solo se lee y se adjunta a los cromos ya desbloqueados.
    //
    //    El reintento SIN las columnas de rareza no es paranoia: el SQL de
    //    scripts/2026-07-rareza-portadas.sql se aplica a mano en Supabase, así
    //    que existe una ventana en la que este código ya está desplegado y las
    //    columnas todavía no. Sin el fallback, esa ventana deja El Archivo
    //    entero en 500 por una función de adorno. Con él, el archivo funciona
    //    igual y solo falta la línea de rareza.
    let { data: cars, error: carsErr } = await supabaseAdmin
      .from("cars")
      .select(`${CAR_COLS}, ${RARITY_COLS}`)
      .order("year", { ascending: true });
    let rarityColumnsExist = !carsErr;
    if (carsErr) {
      console.warn(
        "[garage] rarity columns unavailable, degrading:",
        carsErr.message || carsErr.code
      );
      ({ data: cars, error: carsErr } = await supabaseAdmin
        .from("cars")
        .select(CAR_COLS)
        .order("year", { ascending: true }));
    }
    if (carsErr) {
      console.error("[garage] read cars:", carsErr);
      return res.status(500).json({ error: "Failed to read catalog" });
    }

    // La rareza solo se publica con MUESTRA SUFICIENTE. Con 8 coleccionistas,
    // uno solo mueve el dato 12 puntos: enseñar «lo tiene el 12,5 %» sería
    // inventarse una escasez que no significa nada. Por debajo del umbral, el
    // dorso simplemente no habla de rareza.
    const rarityCollectors =
      cars?.find((c) => c.rarity_collectors > 0)?.rarity_collectors ?? 0;
    const rarityReady =
      rarityColumnsExist && rarityCollectors >= MIN_COLLECTORS_FOR_RARITY;

    // 2) Coches que el usuario ha ganado (status='won').
    //    user_guesses tiene RLS (auth.uid()=user_id), authClient incluye
    //    el bearer del usuario, así que la query devuelve solo SU historial.
    //
    //    Traemos también `date` y `guesses`: son la MEMORIA de cómo conseguiste
    //    cada portada (cuándo y en cuántos intentos), y es lo que convierte la
    //    cuadrícula en una colección — tu cromo deja de ser idéntico al mío.
    //    Coste: `guesses` es el historial entero de cada partida ganada, así que
    //    el payload Supabase→función crece con las victorias del usuario (mismo
    //    datacenter, decenas de KB). Se descarta aquí mismo: al cliente solo le
    //    viaja la longitud. Si algún día pesa, la salida limpia es un RPC que
    //    devuelva jsonb_array_length(guesses) en vez del array.
    const { data: wins, error: winsErr } = await authClient
      .from("user_guesses")
      .select("car_id, date, guesses")
      .eq("user_id", user.id)
      .eq("status", "won");
    if (winsErr) {
      console.error("[garage] read user_guesses:", winsErr);
      return res.status(500).json({ error: "Failed to read wins" });
    }

    const unlockedIds = new Set((wins || []).map((w) => w.car_id));

    // 2b) Coches que el usuario ha jugado y PERDIDO (status='lost') en
    //     algún momento. Sirve para detectar Modo Veterano:
    //       - Cromos bloqueados con lost previa → veteran:true (al
    //         repescarlos se aplicarán reglas duras: 1 intento, sin
    //         pistas), para que el frontend pueda advertir al usuario.
    //       - Cromos desbloqueados con lost previa → wonAsVeteran:true
    //         (lo ganó después de haberlo visto al fallar), para mostrar
    //         insignia discreta en el garaje.
    const { data: losses, error: lossesErr } = await authClient
      .from("user_guesses")
      .select("car_id")
      .eq("user_id", user.id)
      .eq("status", "lost");
    if (lossesErr) {
      console.error("[garage] read losses:", lossesErr);
      // Degradación segura: si no podemos leer pérdidas, los flags
      // veteran/wonAsVeteran salen como false. La info del garaje
      // sigue siendo válida; solo perdemos los matices.
    }
    const lostIds = new Set((losses || []).map((l) => l.car_id));

    // 3) Historial de coches del día. Usamos service_role: pick_daily_car y
    //    daily_cars están revocados para anon/authenticated por hardening previo.
    //
    //    Pedimos hasta HOY inclusive (antes era `< hoy`) porque de aquí sale
    //    también el Nº DE EDICIÓN de cada portada, y el coche de hoy ya puede
    //    estar ganado. Los dos usos se separan justo debajo:
    //      - repesca  → solo fechas ESTRICTAMENTE anteriores a hoy.
    //      - nº       → el orden cronológico completo (la edición nº 1 es el
    //                   primer coche del día que existió).
    const todayDate = todayInMadrid();
    const { data: dailies, error: dailiesErr } = await supabaseAdmin
      .from("daily_cars")
      .select("car_id, date")
      .lte("date", todayDate)
      .order("date", { ascending: true });
    if (dailiesErr) {
      console.error("[garage] read daily_cars:", dailiesErr);
      return res.status(500).json({ error: "Failed to read history" });
    }
    const pastDailyIds = new Set(
      (dailies || []).filter((d) => d.date < todayDate).map((d) => d.car_id)
    );
    // Nº de edición = posición cronológica del coche en la serie de portadas.
    // Solo se adjunta a cromos DESBLOQUEADOS (ver el loop de abajo): en un
    // bloqueado revelaría `wasDaily`, que es justo la señal que este endpoint
    // dejó de exponer por-coche para cerrar el cheat pasivo.
    const issueByCarId = new Map();
    (dailies || []).forEach((d, i) => {
      if (!issueByCarId.has(d.car_id)) issueByCarId.set(d.car_id, i + 1);
    });
    // Pares «fecha|coche» que SÍ fueron partida del día. Es lo único que
    // distingue una victoria del día de una de repesca: ambas persisten igual
    // en user_guesses (user_id, car_id, date=hoy), y en la repesca ese car_id
    // es el de un número atrasado, así que NO coincide con el daily de su
    // fecha. Sin este cruce no hay forma de saber de dónde salió la portada.
    const dailyKeys = new Set(
      (dailies || []).map((d) => `${d.date}|${d.car_id}`)
    );

    // Metadatos de la victoria por coche. Un mismo coche podría tener más de
    // una fila ganada (la PK es user_id+car_id+date), así que nos quedamos con
    // la PRIMERA vez que se ganó: es la fecha que el jugador recuerda como
    // "cuándo lo conseguí".
    const winMetaById = new Map();
    for (const w of wins || []) {
      const prev = winMetaById.get(w.car_id);
      if (prev && prev.wonAt && w.date && prev.wonAt <= w.date) continue;
      winMetaById.set(w.car_id, {
        wonAt: w.date || null,
        attempts: attemptsFromGuesses(w.guesses),
        // viaRepesca: la ganó rescatando un número atrasado, no jugando el
        // coche del día. Importa porque en repesca veterana solo hay UN
        // intento, así que toda victoria salía con `attempts: 1` y el archivo
        // la sellaba como «Pleno» — el mérito de acertar a la primera en una
        // partida de cinco. El cromo mentía sobre cómo se consiguió.
        viaRepesca: !(w.date && dailyKeys.has(`${w.date}|${w.car_id}`)),
      });
    }

    // 4) Estado de la repesca del usuario: si ya sorteó hoy, no puede sortear
    //    otra. Si hay una partida activa (sorteada hoy o cualquier día
    //    anterior, mientras siga viva), lo indicamos para que el frontend
    //    ofrezca "Continuar" en lugar de "Iniciar".
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
    // La repesca activa es la ÚLTIMA SORTEADA, y su partida se juega en la
    // fecha del sorteo — que no siempre es hoy. Aquí había un
    // `last_repesca_at === todayDate`: al cambiar el día, una partida viva
    // desaparecía del garaje igual que se caía en start/validate/image
    // (ver _lib/repesca/activa.js).
    const activa = repescaActiva(statsRow);
    const drawnCarId = activa?.carId || null;

    // La repesca se gasta con el PRIMER INTENTO, no con el sorteo (ver
    // _lib/repesca/consumo.js: el sorteo apunta el coche, pero entre ese apunte
    // y la primera tecla hay una navegación entera que en la app reinicia el
    // WebView; si se rompe ahí, el jugador se quedaba sin repesca sin haber
    // visto una pista). Por eso preguntamos a user_guesses si la partida llegó
    // a existir, en vez de fiarnos de la fecha del sorteo.
    let drawnRow = null;
    if (activa) {
      const { data, error: drawErr } = await authClient
        .from("user_guesses")
        .select("guesses, status")
        .eq("user_id", user.id)
        .eq("car_id", activa.carId)
        .eq("date", activa.fecha)
        .maybeSingle();
      if (drawErr) {
        console.error("[garage] read repesca draw:", drawErr);
        // Degradación conservadora: si no sabemos si jugó, damos el sorteo por
        // jugado. Es el comportamiento de siempre y no regala repescas.
        drawnRow = { status: "playing", guesses: [null] };
      } else {
        drawnRow = data;
      }
    }
    // El presupuesto SÍ es por día natural: solo gasta la repesca de hoy una
    // partida sorteada hoy. La de ayer, jugada o no, ya no cuenta contra ella
    // — si contase, terminar una partida de anoche costaría la repesca de hoy.
    const repescaConsumedToday =
      activa?.fecha === todayDate && repescaJugada(drawnRow);
    const repescaAvailable = !repescaConsumedToday;
    // "Continuar" solo si la partida está empezada Y VIVA. Los dos extremos
    // tienen su propio estado y ninguno es continuar:
    //   · sorteo de HOY que nunca se jugó → CTA "Jugar", que repite el flujo
    //     completo (y /api/repesca/start, que sigue viendo el sorteo de hoy,
    //     devuelve EL MISMO coche: reintentar no es re-sortear). Si el sorteo
    //     sin jugar es de otro día, el CTA sí sortea uno nuevo.
    //   · partida ya cerrada       → CTA apagado y "vuelve mañana". Antes seguía
    //     diciendo "Continuar" y devolvía a una partida terminada.
    const repescaActiveCarId = repescaEnCurso(drawnRow) ? drawnCarId : null;

    // 3) Agrupar por país. Sin clase de coche → "Sin país" como cubo
    //    fallback (en la práctica no debería pasar porque pais es required
    //    en /admin/add-car, pero defensivo).
    // Contador agregado de "cromos pendientes": coches que YA fueron coche
    // del día y el usuario aún no ha ganado. Es el tamaño de la pool de
    // repesca y lo que el header usa para pintar el badge ámbar.
    //
    // Crítico: NO exponemos `wasDaily` por-coche. Hacerlo permitía un cheat
    // pasivo — el atacante filtraba locked + wasDaily=false y obtenía la
    // lista exacta de candidatos a coche-del-día de hoy (pick_daily_car
    // solo elige de coches con image_ready=true que aún no han salido).
    // Cruzando con /api/list-cars (image_ready expuesto) reducía el espacio
    // de adivinación a 1-2 intentos. Al pasar a un agregado top-level
    // perdemos esa señal sin perder la funcionalidad de la repesca.
    let repescaPoolSize = 0;

    const byCountry = new Map();
    for (const c of cars || []) {
      const pais = c.pais || "Sin país";
      if (!byCountry.has(pais)) {
        byCountry.set(pais, { pais, cars: [] });
      }
      const unlocked = unlockedIds.has(c.id);
      const wasDaily = pastDailyIds.has(c.id);
      const wasLost = lostIds.has(c.id);
      if (!unlocked && wasDaily) repescaPoolSize++;
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
              // wonAsVeteran: lo ganó tras haberlo fallado previamente.
              // Insignia discreta en el archivo (más mérito que ganar a la
              // primera, porque tuvo que recordar marca+modelo+año
              // exactos en un único intento).
              wonAsVeteran: wasLost,
              // ── Memoria de la conquista (solo en cromos ya ganados) ──
              // El jugador ya conoce este coche, así que nada de esto filtra
              // información: es SU historia con la portada.
              //   issue    → nº de edición (portada nº 128). null si el coche
              //              nunca fue coche del día (no debería pasar: toda
              //              victoria viene de un daily o de su repesca).
              //   wonAt    → fecha (Madrid) de la primera vez que lo ganó.
              //   attempts → intentos que le costó. 1 = pleno, pero SOLO si la
              //              portada vino del coche del día (ver viaRepesca).
              //   viaRepesca → la desbloqueó rescatando un número atrasado.
              issue: issueByCarId.get(c.id) ?? null,
              wonAt: winMetaById.get(c.id)?.wonAt ?? null,
              attempts: winMetaById.get(c.id)?.attempts ?? null,
              viaRepesca: winMetaById.get(c.id)?.viaRepesca ?? false,
              //   rarity → cuántos coleccionistas tienen esta portada. Es lo
              //            que hace que dos cromos del mismo coche no valgan
              //            igual. Solo en desbloqueados: en un bloqueado
              //            filtraría que el coche ya fue coche del día.
              rarity:
                rarityReady && Number.isFinite(c.rarity_pct)
                  ? { pct: c.rarity_pct, owners: c.rarity_owners ?? 0 }
                  : null,
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
              // veteran: si lo repesca, será en Modo Veterano (1 intento,
              // sin pistas) porque ya lo vio revelado al fallar antes.
              // Solo informativo; el enforcement está en /api/repesca/*.
              veteran: wasLost,
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
      // Nº de coleccionistas sobre el que se calculó la rareza. El front lo usa
      // para poder decir «de 340 coleccionistas» en vez de un % huérfano; 0
      // significa que la rareza no se está publicando (muestra insuficiente o
      // migración sin aplicar) y el dorso omite la línea entera.
      rarityCollectors: rarityReady ? rarityCollectors : 0,
      // Repesca (sistema "una al día"):
      //   repescaPoolSize      → cuántos coches del catálogo ya fueron daily
      //                          pero el usuario no ha ganado. Sustituye al
      //                          antiguo `wasDaily` por-coche para no filtrar
      //                          qué cromos son candidatos a coche-del-día
      //                          (ver comentario arriba del loop).
      //   repescaAvailable     → true si al usuario le queda repesca hoy. Se
      //                          gasta con el primer intento, no con el sorteo
      //                          (ver _lib/repesca/consumo.js): un sorteo que
      //                          se quedó por el camino no cuenta, y el CTA
      //                          reintenta el MISMO coche.
      //   repescaActiveCarId   → si hay una partida de repesca empezada y viva,
      //                          aquí va su car_id. Permite "Continuar". No
      //                          caduca a medianoche: la partida se juega en la
      //                          fecha en que se sorteó.
      repescaPoolSize,
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
    await captureServerError(err, { endpoint: "garage" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
