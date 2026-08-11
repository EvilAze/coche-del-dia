// vitest.config.js
// Configuración de los tests, SEPARADA de vite.config.js a propósito: el build
// de producción no debe cambiar ni un byte por lo que necesiten las pruebas.
//
// POR QUÉ EXISTE. Hasta ahora ninguna suite renderizaba JSX —eran lógica pura—
// y Vitest tiraba con la config de Vite sin enterarse de nada. Al escribir la
// primera que MONTA un componente de verdad (GuessForm.app.test.jsx, la única
// forma de ejecutar la rama de la app), todos los tests morían con «React is
// not defined» dentro del propio componente: en el pipeline de Vitest no entra
// el plugin de React, así que el JSX lo transformaba esbuild con el runtime
// CLÁSICO, que espera un `React` en ámbito que ningún componente importa.
//
// `jsx: "automatic"` lo arregla en la raíz: el transform inyecta el runtime
// (`react/jsx-runtime`) igual que hace el plugin en el build.
//
// El entorno por defecto sigue siendo `node`, que es lo que quieren las 41
// suites de lógica; la única que necesita DOM lo pide en su primera línea con
// `// @vitest-environment jsdom`. Así jsdom se levanta una vez y no en cada
// fichero, que multiplicaría por tres el tiempo de la suite.

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",

    // LOS WORKTREES NO SON CÓDIGO DE ESTE PROYECTO, y sin esta línea Vitest los
    // trataba como si lo fueran. Viven en `.claude/worktrees/`, que no está en
    // el `exclude` por defecto (solo lo están node_modules, dist y compañía), así
    // que ejecutar la suite desde el checkout principal recogía una copia de cada
    // test por cada rama abierta: 268 ficheros y 2486 tests en vez de 46 y 428.
    //
    // Y no era solo lentitud. Dos ramas abandonadas dejaban su `locales.test.js`
    // en rojo por cadenas que ya no existen en ningún sitio, así que `npm test`
    // en el checkout principal FALLABA por código que no se publica. Eso es lo
    // caro: desde que los cambios de app van directos a `main` sin PR (regla 13),
    // esta suite es la única red antes de producción, y una red que da rojo por
    // motivos ajenos se acaba mirando de reojo — que es como se cuela el rojo de
    // verdad.
    //
    // `build/` va también: es salida generada, y sus copias del bundle no son
    // tests pero sí ficheros que rastrear.
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**", "**/build/**"],
  },
});
