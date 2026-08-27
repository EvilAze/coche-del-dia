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
//   2. NO LA TIENE YA INSTALADA. `esApp()` solo caza al que está jugando DENTRO
//      del APK; el que lo instaló y hoy entra por Chrome seguía viendo una
//      invitación a instalar lo que ya tiene. Lo resuelve
//      `comprobarAppInstalada()` — ver más abajo por qué es asíncrona y por qué
//      su respuesta se guarda.
//   3. TRES DÍAS JUGADOS. El jugador de una sola partida no tiene hábito que
//      trasladar. El de tres vuelve solo, y es a quien le ahorras teclear la
//      dirección cada mañana.
//   4. NO LO HA RECHAZADO. Una vez. Si dice que no, no se vuelve a preguntar.
//
// Las condiciones 1 y 2 son "¿le sirve la app?" y valen para las DOS superficies
// (`debeOfrecerApp()`); las 3 y 4 son "¿es buen momento?" y solo las pide el
// faldón del resultado (`debeOfrecerFaldon()`). La puerta del perfil no lleva
// cuota ni caducidad a propósito: hay que abrir el perfil y bajar hasta ella,
// o sea que quien la ve la estaba buscando.
//
// LO QUE NO PROMETEMOS: "te avisamos cada día" NO es exclusivo de la app — la
// web ya tiene Web Push (lib/webpush.js) y en Android Chrome funciona. El copy
// se apoya en lo que sí es verdad: el icono en la pantalla de inicio (un toque
// en vez de teclear la URL, que en un juego DIARIO es el factor de verdad) y un
// aviso que no depende de que el navegador siga vivo.
//
// LO QUE LA APP NO SE LLEVA: EL PROGRESO ANÓNIMO. La sesión anónima vive en el
// localStorage del NAVEGADOR y el WebView de la app sirve desde
// `https://localhost`, en el sandbox de la aplicación: no hay ningún camino por
// el que esa racha pueda viajar. Por eso el faldón tiene dos caras y por eso al
// anónimo se le pide cuenta ANTES de enseñarle Play — ofrecerle mudarse sin
// avisarle es mandarle a empezar de cero con nueve días a la espalda.
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
// Última respuesta de `getInstalledRelatedApps()`. Por qué se guarda: la API es
// asíncrona y aquí se decide SÍNCRONO en el primer render (para que no aparezca
// un bloque a mitad de lectura). Esperarla obligaría a elegir entre un parpadeo
// —pintar y retirar— o retrasar el faldón hasta después del primer paint, que
// es justo el salto que este componente evita. Con la respuesta del arranque
// anterior en almacenamiento, el render sigue leyendo un booleano ya listo.
const INSTALADA_KEY = "cd_app_instalada";
// El faldón tiene DOS caras y cada una lleva su memoria. Con una sola clave,
// decir «ahora no» a «créate una cuenta» apagaba también la oferta de Play para
// cuando el jugador ya tuviera cuenta: rechazar una cosa enterraba otra que aún
// no se le había ofrecido.
const DESCARTE_REGISTRO_KEY = "cd_registro_faldon_no";

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

export function faldonRegistroDescartado() {
  try {
    return localStorage.getItem(DESCARTE_REGISTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function marcarFaldonRegistroDescartado() {
  try {
    localStorage.setItem(DESCARTE_REGISTRO_KEY, "1");
  } catch {
    /* peor caso: se lo volvemos a ofrecer otro día */
  }
}

/**
 * ¿Sabemos ya que este jugador tiene la app instalada? Lectura síncrona de lo
 * que dejó `comprobarAppInstalada()` en el arranque. Sin dato todavía —primera
 * visita, o navegador sin la API— responde `false`, o sea "ofrécesela".
 */
export function appInstalada() {
  try {
    return localStorage.getItem(INSTALADA_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Pregunta al navegador si el APK de Play está instalado y guarda la respuesta
 * para el próximo render. Se llama una vez al arrancar (App.jsx) y no devuelve
 * nada útil: quien decide es `appInstalada()`, leyendo lo guardado.
 *
 * REQUISITOS, los dos ya cumplidos: `related_applications` en manifest.json
 * declarando el paquete, y el sitio verificado por Digital Asset Links
 * (public/.well-known/assetlinks.json, el mismo fichero que ya sostiene el App
 * Link del apex). Si alguien toca cualquiera de los dos, esto pasa a responder
 * siempre "no instalada" en silencio. Ojo con la otra mitad del manifest:
 * `prefer_related_applications` sigue SIN poner a propósito — pondría a Play por
 * delante del "añadir a pantalla de inicio" del navegador, y la web es el
 * producto principal, no un folleto de la app.
 *
 * EL FALLO SEGURO VA AL REVÉS QUE EN EL RESTO DEL MÓDULO. Aquí, ante la duda,
 * SE OFRECE. `getInstalledRelatedApps` no existe en Firefox Android ni en Chrome
 * antiguo, y tratar "no sé" como "la tiene" apagaría el embudo entero en esos
 * navegadores sin que nadie se enterase — un fallo invisible y mucho peor que la
 * molestia que esto viene a quitar. Enseñarle Play a alguien que ya la tiene es
 * un mal menor: Play le pone "Abrir".
 */
export async function comprobarAppInstalada() {
  // En iOS/escritorio/dentro del APK no hay nada que preguntar ni nadie a quien
  // ofrecerle la app: nos ahorramos la llamada y la escritura.
  if (!esAndroidWeb()) return;

  let instalada = false;
  try {
    const apps = (await navigator.getInstalledRelatedApps?.()) || [];
    instalada = apps.some((a) => a.platform === "play" && a.id === APP_ID);
  } catch {
    /* sin API, sin permiso o sin contexto seguro: se queda en false */
  }

  try {
    // Se reescribe en cada arranque, sin caducidad: así el dato se cura solo. Si
    // desinstala la app, el siguiente arranque borra la marca y la oferta vuelve
    // sin que haya que inventarse un TTL.
    if (instalada) localStorage.setItem(INSTALADA_KEY, "1");
    else localStorage.removeItem(INSTALADA_KEY);
  } catch {
    /* sin storage: `appInstalada()` seguirá diciendo false, que es ofrecer */
  }
}

/**
 * ¿Le sirve de algo la app a este jugador? Android en navegador y sin tenerla ya
 * instalada. Es la puerta MÍNIMA, la que comparten las dos superficies del
 * embudo: la portadilla del perfil no pide nada más.
 */
export function debeOfrecerApp() {
  return esAndroidWeb() && !appInstalada();
}

/**
 * ¿Es buen SITIO y buen MOMENTO para un faldón? Android en navegador, sin la
 * app instalada y con hábito (tres días). Deliberadamente NO mira los
 * descartes: cuál de las dos caras se puede enseñar depende de si hay cuenta, y
 * eso lo sabe el componente, no este módulo.
 */
export function momentoDeFaldon() {
  return debeOfrecerApp() && diasJugados() >= DIAS_MINIMOS;
}

/**
 * ¿Toca ofrecer el faldón de PLAY? Síncrono a propósito: el EndScreen decide en
 * el primer render y así no aparece un bloque a mitad de lectura (lo mismo que
 * hace NotificationOptIn con `initialMode`).
 */
export function debeOfrecerFaldon() {
  return momentoDeFaldon() && !faldonDescartado();
}
