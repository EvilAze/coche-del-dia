// src/lib/edicionApp.js
// La derivada web → app Android: a quién se le ofrece la app, cuándo, y con qué
// enlace. Toda la puerta de entrada vive aquí para que los componentes solo
// pregunten `debeOfrecerFaldon()` y no repartan condiciones de plataforma.
//
// POR QUÉ EXISTE UNA PUERTA Y NO UN BANNER A SECAS: el 99% de las partidas
// entran por navegador, así que este aviso lo verían casi todos los jugadores
// del juego. Un aviso que ve todo el mundo en su primera visita no es sutil, es
// el banner de "descarga nuestra app" que la gente ha aprendido a cerrar sin
// leer — y encima se lo comería quien todavía no sabe si el juego le gusta. Las
// tres condiciones de abajo existen para que solo lo vea alguien a quien la app
// de verdad le sirve:
//
//   1. ANDROID EN NAVEGADOR. No hay app de iOS, y dentro del APK ofrecer el APK
//      es absurdo (`esApp()`). En escritorio tampoco: el enlace de Play ahí no
//      instala nada.
//   2. TRES DÍAS JUGADOS. El jugador de una sola partida no tiene hábito que
//      trasladar. El de tres vuelve solo, y es a quien le ahorras teclear la
//      dirección cada mañana.
//   3. NO LO HA RECHAZADO. Una vez. Si dice que no, no se vuelve a preguntar.
//
// LO QUE NO PROMETEMOS: "te avisamos cada día" NO es exclusivo de la app — la
// web ya tiene Web Push (lib/webpush.js) y en Android Chrome funciona. El copy
// se apoya en lo que sí es verdad: el icono en la pantalla de inicio (un toque
// en vez de teclear la URL, que en un juego DIARIO es el factor de verdad) y un
// aviso que no depende de que el navegador siga vivo.
//
// Todo falla en silencio (regla 9): sin localStorage, sin UA o sin nada, la
// respuesta es "no ofrecer" y el juego sigue igual.

import { esApp } from "./plataforma";

const APP_ID = "com.cochedeldia";

// Días DISTINTOS en que este navegador ha terminado una partida. No guardamos
// la lista de fechas, solo el contador y la última: para decidir "¿tres días?"
// sobra, y así la clave no crece sin fin en el almacenamiento del jugador.
const DIAS_KEY = "cd_dias_jugados";
const DESCARTE_KEY = "cd_app_faldon_no";

// Tres días jugados. Es el primer número en que "vuelve cada día" ya no es
// casualidad: con uno no hay hábito y con dos podrían ser dos tardes seguidas.
export const DIAS_MINIMOS = 3;

/**
 * Enlace a la ficha de Play con el referrer de Play Install Referrer, que es lo
 * que hace que Play Console → Adquisición separe cuánto instala cada sitio de
 * la web. Va URL-encodeado DENTRO del parámetro (`utm_source%3Dweb`): Play
 * espera el referrer como una sola cadena con sus propios pares, no como
 * parámetros sueltos de la URL de la ficha.
 *
 * @param {string} medium  De dónde sale el clic (`faldon_final`, `perfil`…).
 */
export function urlPlay(medium) {
  const referrer = encodeURIComponent(`utm_source=web&utm_medium=${medium}`);
  return `https://play.google.com/store/apps/details?id=${APP_ID}&referrer=${referrer}`;
}

/** Android, pero en el navegador: ni dentro del APK ni en iOS/escritorio. */
export function esAndroidWeb() {
  if (typeof navigator === "undefined") return false;
  if (esApp()) return false;
  return /Android/i.test(navigator.userAgent || "");
}

/** Días distintos jugados por este navegador (0 si no hay dato o no se puede leer). */
export function diasJugados() {
  try {
    const raw = localStorage.getItem(DIAS_KEY);
    if (!raw) return 0;
    const { n } = JSON.parse(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Suma un día al contador SI la fecha es distinta de la última registrada.
 * Idempotente dentro del mismo día: el jugador puede reabrir el resultado, o
 * volver a entrar por la tarde, y sigue siendo un día.
 *
 * @param {string} fecha  Día de juego en Madrid (`getMadridDateStr()`).
 */
export function registrarDiaJugado(fecha) {
  try {
    const raw = localStorage.getItem(DIAS_KEY);
    const prev = raw ? JSON.parse(raw) : null;
    if (prev?.ultima === fecha) return;
    const n = Number.isFinite(prev?.n) ? prev.n + 1 : 1;
    localStorage.setItem(DIAS_KEY, JSON.stringify({ n, ultima: fecha }));
  } catch {
    /* sin storage: el faldón no aparecerá, que es el fallo seguro */
  }
}

export function faldonDescartado() {
  try {
    return localStorage.getItem(DESCARTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function marcarFaldonDescartado() {
  try {
    localStorage.setItem(DESCARTE_KEY, "1");
  } catch {
    /* peor caso: se lo volvemos a ofrecer otro día */
  }
}

/**
 * ¿Toca ofrecer el faldón del final de partida? Síncrono a propósito: el
 * EndScreen decide en el primer render y así no aparece un bloque a mitad de
 * lectura (lo mismo que hace NotificationOptIn con `initialMode`).
 */
export function debeOfrecerFaldon() {
  return esAndroidWeb() && !faldonDescartado() && diasJugados() >= DIAS_MINIMOS;
}
