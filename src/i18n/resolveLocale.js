// src/i18n/resolveLocale.js
// Regla de convivencia entre los DOS selectores de idioma que tiene la app
// Android: el suyo propio (LanguageStrip → override en localStorage) y el de
// Android por app (localeConfig, leído vía LocaleBridgePlugin).
//
// Pura a propósito (todo entra por parámetro, sin DOM ni localStorage ni
// navigator): i18n/index.js toca `document` al cargarse y no se puede importar
// desde los tests (entorno node). Mismo patrón que reminderCopy / deepLink.
//
// ── El problema, y por qué el intento anterior no valía ──
//   Un primer intento sellaba el `navigator.language` vigente al elegir dentro
//   de la app, para caducar el override si el sistema cambiaba luego. No sirve:
//   con el móvil en inglés, poner la app en English desde los ajustes de Android
//   deja navigator.language en "en" —igual que antes— y no hay cambio que
//   detectar. La señal que faltaba es "¿ELIGIÓ el usuario un idioma por app, o
//   es el defecto del sistema?", y eso solo lo da el nativo
//   (AppCompatDelegate.getApplicationLocales(): vacío = no elegido).
//
// ── La regla ──
//   Cuando hay un override de la app, sellamos junto a él el idioma NATIVO por
//   app que había en ese momento. Si al arrancar el nativo por app es OTRO, el
//   usuario tocó los ajustes de Android DESPUÉS de elegir dentro de la app —una
//   acción más reciente— así que gana el nativo y el override queda obsoleto.
//   Si no cambió, sigue mandando lo que se eligió dentro de la app.
//
//   Esto hace que los DOS selectores funcionen y que el último en tocarse gane,
//   sin necesidad de escribir nada en el sistema (que provocaría recreaciones).
//   Único hueco conocido: reafirmar en Android el MISMO idioma que ya estaba
//   sellado no se detecta (nativo "en" → "en" no cambia). Es un caso de tres
//   acciones encadenadas y una reafirmación redundante; se asume.

/** "en-GB" → "en". Devuelve "" si no hay nada aprovechable. */
export function normalizaLocale(valor) {
  return typeof valor === "string" ? valor.slice(0, 2).toLowerCase() : "";
}

/**
 * @param {object} señales
 * @param {string} señales.nativo    idioma por app de Android ("" si no elegido)
 * @param {string|null} señales.override  elección guardada de la app ("es"|"en"|null)
 * @param {string|null} señales.sello     idioma nativo por app sellado al guardar el override
 * @param {string} señales.navegador  navigator.language de reserva
 * @param {string[]} soportados
 * @param {string} fallback
 * @returns {string} el locale a usar
 */
export function resolveLocale({ nativo, override, sello, navegador }, soportados, fallback) {
  const n = normalizaLocale(nativo);
  const tieneOverride = override != null && soportados.includes(override);

  if (tieneOverride) {
    // ¿Tocó el usuario los ajustes de Android DESPUÉS de elegir en la app?
    const androidCambioDespues = sello != null && normalizaLocale(sello) !== n;
    if (androidCambioDespues && soportados.includes(n)) return n;
    return override;
  }

  // Sin override de la app: manda el idioma por app de Android si lo hablamos,
  // luego el del navegador/sistema, y por último el defecto.
  if (soportados.includes(n)) return n;
  const b = normalizaLocale(navegador);
  if (soportados.includes(b)) return b;
  return fallback;
}
