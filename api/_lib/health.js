// api/_lib/health.js
// Lógica del health-check usada por /api/health. Separada del endpoint para
// poder testearla aislada (mockeando el cliente Supabase), porque la parte
// frágil es la CARRERA contra el timeout, no el envoltorio HTTP.
//
// Devuelve true si Supabase responde a una lectura trivial dentro del plazo;
// false si hay error de DB, excepción de red, timeout o cliente ausente. No
// lanza nunca: el endpoint traduce el booleano a 200/503.

/**
 * @param {object|null} client  Cliente Supabase (anónimo). null si faltan envs.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<boolean>}
 */
export async function checkDbHealth(client, { timeoutMs = 4000 } = {}) {
  // Sin cliente (envs ausentes) la app no puede hablar con la DB: no sano.
  if (!client) return false;

  // Sentinel para distinguir "ganó el timeout" de un resultado real.
  const TIMEOUT = Symbol("timeout");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });

  try {
    // Lectura mínima por el mismo camino anon (RLS) que un jugador. limit(1)
    // lee como mucho una fila; NO usamos pick_daily_car (no filtrar el coche).
    const result = await Promise.race([
      client.from("cars").select("id").limit(1),
      timeout,
    ]);
    if (result === TIMEOUT) {
      console.error("[health] timeout consultando Supabase");
      return false;
    }
    if (result?.error) {
      // No propagamos el detalle al body; sí a los logs de Vercel.
      console.error("[health] error de Supabase:", result.error?.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[health] excepción consultando Supabase:", err?.message || err);
    return false;
  } finally {
    // Liberamos el timer para no dejar el handler vivo esperando al setTimeout.
    clearTimeout(timer);
  }
}
