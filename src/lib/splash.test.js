// src/lib/splash.test.js
// Ata las DOS condiciones que hacen que el splash nativo no se quede eterno.
//
// EL FALLO QUE CUBRE, porque conviene que quede escrito: con
// `launchAutoHide: false` en capacitor.config.json, el splash de Android solo
// se cierra desde JS. Su red de seguridad —un temporizador— vivía DENTRO de
// hideSplashWhenReady(), que index.jsx llama después de todos los imports y del
// render; y el import de ./lib/splash iba DEBAJO del de ./App. Con esas dos
// cosas, cualquier excepción durante la evaluación de módulos (el caso real: un
// `.env` sin las variables de Supabase, que hace lanzar a supabaseClient.js)
// dejaba la app clavada en el splash: parecía tostada y no había forma de ver el
// error desde el móvil. El propio splash.js prometía en su comentario que la red
// se armaba «en cuanto se importa el módulo» — y no era verdad.
//
// Las dos condiciones son inseparables: el temporizador a nivel de módulo no
// sirve de nada si el módulo no llega a evaluarse, y evaluarlo primero no sirve
// si el temporizador está escondido en una función que nadie llama. Por eso van
// en el mismo test.
//
// Son comprobaciones ESTÁTICAS sobre el fuente a propósito: lo que se protege es
// el ORDEN de evaluación de los módulos, que es exactamente lo que un test que
// importase los módulos ya habría alterado.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexJsx = readFileSync(join(SRC, "index.jsx"), "utf8");
const splashJs = readFileSync(join(SRC, "lib", "splash.js"), "utf8");

describe("el splash nativo no puede quedarse eterno", () => {
  it("index.jsx importa ./lib/splash ANTES que ./App", () => {
    const splash = indexJsx.indexOf('from "./lib/splash"');
    const app = indexJsx.indexOf('from "./App"');

    expect(splash, "index.jsx ya no importa ./lib/splash").toBeGreaterThan(-1);
    expect(app, "index.jsx ya no importa ./App").toBeGreaterThan(-1);
    expect(
      splash < app,
      "El import de ./lib/splash tiene que ir ANTES del de ./App. Los imports ES " +
        "se evalúan en orden: si App lanza durante su evaluación, lo que viene " +
        "detrás no llega a existir y la red de seguridad del splash no se arma → " +
        "la app se queda clavada en el splash."
    ).toBe(true);
  });

  it("splash.js arma el temporizador al evaluarse el módulo, no dentro de hideSplashWhenReady", () => {
    const temporizador = splashJs.indexOf("setTimeout(cerrar, TOPE_MS)");
    const funcion = splashJs.indexOf("export function hideSplashWhenReady");

    expect(temporizador, "ya no hay setTimeout(cerrar, TOPE_MS) en splash.js").toBeGreaterThan(-1);
    expect(funcion, "ya no existe hideSplashWhenReady").toBeGreaterThan(-1);
    expect(
      temporizador < funcion,
      "El setTimeout de emergencia tiene que estar en el cuerpo del MÓDULO, por " +
        "encima de hideSplashWhenReady(). Dentro de la función se arma después " +
        "del peligro que dice cubrir: si el bundle revienta antes de que nadie " +
        "la llame, el splash no se cierra nunca."
    ).toBe(true);
  });

  it("el bloque de init nativo de index.jsx no puede tumbar el arranque", () => {
    // Corre antes de root.render(), así que una excepción se lleva por delante
    // el render Y el hideSplashWhenReady() de después.
    expect(
      /if \(Capacitor\.isNativePlatform\(\)\) try \{/.test(indexJsx),
      "El bloque `if (Capacitor.isNativePlatform())` de index.jsx tiene que ir en " +
        "try/catch: corre antes del render, y si lanza, la app se queda en el splash."
    ).toBe(true);
  });
});
