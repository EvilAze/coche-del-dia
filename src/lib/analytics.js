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
// Propiedad implícita en TODOS los eventos:
//   - plataforma  "app" (WebView de Capacitor) | "web" (navegador)
//     No hace falta pasarla: track() la añade sola. Ver plataforma() abajo.
//
// Convención de eventos:
//   - profile_view          { source }                — abrir perfil ajeno
//   - garage_open           { auth }                  — abrir el garaje (auth: user|anon)
//   - garage_from_endscreen {}                        — abrir garaje desde el desbloqueo de la victoria
//   - repesca_from_endscreen {}                       — abrir el Archivo desde el aviso de repesca del final
//        Mide si la repesca deja de ser invisible: hasta ago-2026 la segunda
//        partida del día no se nombraba en el EndScreen, así que solo la
//        encontraba quien ya sabía que existía. Su denominador natural es
//        `daily_win` + `daily_lose`; su continuación, `repesca_start`.
//   - repesca_start         { mode }                  — iniciar repesca
//   - repesca_win           { mode, attempts }        — ganarla
//   - daily_win             { attempts }              — ganar partida diaria
//   - daily_lose            {}                        — perder partida diaria
//   - share                 { method, where, result } — compartir COMPLETADO
//        method: native|clipboard|legacy · where: result_panel|end_screen
//        result: win|lose. Solo cuenta comparticiones reales (cancelar el
//        share nativo NO dispara evento): es la métrica del bucle viral.
//   - push_prompt_shown      { surface }                — se muestra el opt-in web
//   - push_optin             { result, surface }        — accept|decline|dismiss
//   - push_subscribed        { locale }                 — suscriptor REAL captado
//   - push_unsubscribed      {}                         — se da de baja
//        Embudo de retención Web Push: shown → optin(accept) → subscribed. El
//        RETORNO desde una notificación se mide por UTM (?utm_source=push), que
//        Umami atribuye solo (no hace falta evento).
//   - app_promo_shown        { surface }   — se pinta la oferta de la app Android
//   - app_promo_click        { surface }   — clic hacia la ficha de Play
//   - app_promo_dismiss      { surface }   — "ahora no" (cierra el faldón para siempre)
//        surface: faldon_final (final de partida, una vez) | perfil (puerta fija).
//        Embudo web→app: shown → click. La otra mitad (click → instalación real)
//        NO la ve Umami: la da Play Console → Adquisición, gracias al referrer
//        que monta lib/edicionApp.js. Son dos números de dos paneles distintos y
//        no van a cuadrar exactamente — Play solo cuenta instalaciones.

// Plataforma de origen, añadida a TODOS los eventos como `plataforma`.
//
// Por qué: hasta ahora la app Android no reportaba nada (su hostname,
// `localhost`, no estaba en el `data-domains` de index.html, y Umami usa esa
// lista como puerta). Al abrirla, los eventos de la app se mezclarían con los de
// la web y no habría forma de saber cuánto uso viene de Play. Con esta
// propiedad el dashboard separa los dos mundos sin tocar los nombres de evento
// ya establecidos.
//
// Se calcula UNA vez: Capacitor.isNativePlatform() no cambia en caliente.
// Exportada además de usarse aquí: Sentry etiqueta con ella sus reportes de
// repesca. "App o web" fue LA pregunta que separó al jugador que se quedó sin
// repesca del que jugó sin problema (12-ago-2026), y no tenerla obligó a
// deducirla del user-agent en la tabla de auditoría.
let plataformaCache;
export function plataforma() {
  if (plataformaCache) return plataformaCache;
  try {
    // Import estático no: analytics.js lo usa también el bundle web, y no
    // queremos que el arranque dependa de resolver el core de Capacitor.
    plataformaCache = window.Capacitor?.isNativePlatform?.() ? "app" : "web";
  } catch {
    plataformaCache = "web";
  }
  return plataformaCache;
}

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
      umami.track(eventName, { ...data, plataforma: plataforma() });
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
