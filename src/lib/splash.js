// src/lib/splash.js
// Cierre del splash nativo de la app Android. En web es no-op total.
//
// Por qué existe:
//   Antes el splash se cerraba solo con `launchShowDuration: 800`, un temporizador
//   CIEGO: a los 800 ms se quitaba tanto si la app había pintado como si no. Un
//   WebView en frío en gama media tarda del orden de 1-2 s en montar React, así
//   que la secuencia real era splash → hueco vacío → app. El hueco es lo que
//   hace que una app parezca lenta aunque tarde lo mismo.
//
//   Ahora `launchAutoHide: false` (capacitor.config.json) deja el splash puesto
//   hasta que alguien lo cierre, y ese alguien es este módulo: lo cerramos
//   cuando el navegador ya ha PINTADO el primer frame de la app.
//
// Qué contamos como "listo":
//   El app-shell pintado, NO los datos del día cargados. useGame enseña su
//   skeleton mientras espera al servidor, y ese skeleton ya va con el tema y la
//   tipografía correctos: es una espera con contexto. Encadenar el splash a la
//   red haría que sin cobertura se quedara pegado para siempre.
//
// La red de seguridad (importante):
//   Con `launchAutoHide: false`, si este módulo no llega a llamar a hide() el
//   splash se queda ETERNO y la app parece colgada. Puede pasar si el bundle
//   revienta antes de este punto. Por eso el temporizador se arma AL EVALUARSE
//   EL MÓDULO —no dentro de hideSplashWhenReady()— y dispara pase lo que pase:
//   en el peor caso volvemos al comportamiento anterior (splash que se va sin
//   esperar a nadie), nunca a una pantalla muerta.
//
//   ESTO ESTUVO ROTO, y de la peor manera: el comentario prometía justo lo de
//   arriba pero el `setTimeout` vivía DENTRO de hideSplashWhenReady(), que
//   index.jsx llama DESPUÉS de todos los imports y del render. O sea que la red
//   se armaba después del peligro que dice cubrir. Cualquier excepción a nivel
//   de módulo —el caso real: `.env` sin las variables de Supabase, que hace
//   lanzar a supabaseClient.js— dejaba el splash puesto para siempre: la app
//   parecía tostada y no había forma de ver el error desde el móvil.
//
//   Y no basta con mover el temporizador: para que este módulo llegue a
//   EVALUARSE, su import tiene que ir ANTES que el de App en index.jsx (los
//   imports ES se evalúan en orden, y si el de App lanza, lo que viene detrás
//   no existe). Está anotado allí; si alguien reordena los imports, esto vuelve
//   a romperse en silencio. Lo cubre splash.test.js.

import { Capacitor } from "@capacitor/core";

// Tope duro. Generoso comparado con los 800 ms de antes porque ya no es el
// camino normal sino el de emergencia: preferimos que un móvil lento aguante el
// splash 4 s a que enseñe el hueco vacío. Si se llega aquí, algo ha ido mal.
const TOPE_MS = 4000;

let cerrado = false;

// Carga perezosa del plugin. Devolvemos la PROMESA del import (el módulo), NUNCA
// el proxy del plugin: devolver o await-ear un proxy de Capacitor accede a su
// `.then`, y eso lo interpreta como una llamada nativa → peta con
// "SplashScreen.then() is not implemented on android".
function loadSplash() {
  return import("@capacitor/splash-screen");
}

async function cerrar() {
  if (cerrado) return;
  cerrado = true;
  try {
    const { SplashScreen } = await loadSplash();
    await SplashScreen.hide();
  } catch {
    /* plugin ausente o ya oculto: no hay nada que recuperar */
  }
}

// LA RED DE SEGURIDAD, armada al evaluarse el módulo. Es un efecto de import a
// propósito: es la única forma de cubrir el caso «el bundle revienta antes de
// que nadie llame a hideSplashWhenReady()», que es precisamente cuando el
// usuario se queda mirando un splash que no se va.
if (Capacitor.isNativePlatform()) {
  setTimeout(cerrar, TOPE_MS);
}

// Llamar UNA vez, justo después de root.render(). Idempotente.
export function hideSplashWhenReady() {
  if (!Capacitor.isNativePlatform()) return;

  // Doble rAF: el primer callback corre ANTES del paint del frame en curso, el
  // segundo ya con ese frame pintado. Es la señal más temprana y fiable de "hay
  // algo en pantalla" sin depender de heurísticas de React.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cerrar();
    });
  });
}
