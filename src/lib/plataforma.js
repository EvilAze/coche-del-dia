// src/lib/plataforma.js
// ¿Estamos dentro de la app Android o en el navegador?
//
// Existe para que los COMPONENTES no importen `@capacitor/core` directamente:
// en este proyecto todo lo nativo entra por `lib/` (notifications, webpush,
// splash, nativeAuth…) y los componentes consumen helpers con nombre. Aquí el
// consumidor es el copy — hay textos escritos para una web que dentro del APK
// dicen cosas que no existen («recarga la página», «este navegador»).
//
// CONVENCIÓN DEL COPY: la clave web es la canónica y la variante de app añade
// el sufijo `App` (`app.dayRolloverBody` → `app.dayRolloverBodyApp`). Se elige
// con un ternario EXPLÍCITO en el componente, con las dos claves escritas
// enteras:
//
//   {esApp() ? t("app.dayRolloverBodyApp") : t("app.dayRolloverBody")}
//
// y no con una clave construida (`t("…Body" + sufijo)`), porque el test de
// i18n que caza claves inexistentes solo ve las literales — una clave montada
// a mano se le escapa, que es exactamente cómo llegaron a producción los
// literales «prensa.fajaDistancia.one» (ver src/i18n/locales.test.js).

import { Capacitor } from "@capacitor/core";

/**
 * true dentro del WebView de la app Android (Capacitor); false en web.
 * No se cachea: es una llamada trivial y cachearla en módulo obligaría a
 * mockear el orden de imports en cada test que la toque.
 */
export function esApp() {
  return Capacitor.isNativePlatform();
}
