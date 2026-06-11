// src/lib/analytics.js
// Wrapper minimalista sobre Umami Analytics.
//
// Umami expone window.umami.track(eventName, data?) cuando su script ya
// se ha cargado. Aquí envolvemos en una función que es:
//   - Segura en SSR / dev: si window.umami no existe (script bloqueado
//     por adblock, aún no cargado, o data-website-id sin rellenar), no
//     tira; solo loguea en consola en dev y sigue.
//   - Idempotente: llamarla no-block el flujo del usuario nunca.
//   - Tipada por convención: usa nombres `snake_case` para eventos para
//     que el dashboard de Umami los ordene alfabéticamente sin saltos.
//
// Convención de eventos:
//   - achievement_unlocked  { id, category, tier? }  — al desbloquear medalla
//   - profile_view          { source }                — abrir perfil ajeno
//   - garage_open           { auth }                  — abrir el garaje (auth: user|anon)
//   - garage_from_endscreen {}                        — abrir garaje desde el desbloqueo de la victoria
//   - repesca_start         { mode }                  — iniciar repesca
//   - repesca_win           { mode, attempts }        — ganarla
//   - daily_win             { attempts }              — ganar partida diaria
//   - daily_lose            {}                        — perder partida diaria

/**
 * Dispara un evento custom en Umami. Falla en silencio si el script
 * no está disponible (adblock, dev local sin script, etc.).
 *
 * @param {string} eventName  Nombre del evento (snake_case).
 * @param {Record<string, any>} [data] Propiedades opcionales del evento.
 */
export function track(eventName, data) {
  if (typeof window === "undefined") return;
  try {
    const umami = window.umami;
    if (umami && typeof umami.track === "function") {
      umami.track(eventName, data);
    } else if (import.meta.env.DEV) {
      // En dev mostramos por consola para poder verificar que la llamada
      // ocurre. En prod, simplemente no se envía (script no cargado).
      // eslint-disable-next-line no-console
      console.debug("[analytics] (umami not loaded)", eventName, data);
    }
  } catch {
    // Nunca, NUNCA, romper la UX por culpa de analytics.
  }
}
