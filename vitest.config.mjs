// vitest.config.mjs
// Config DEDICADA de tests, separada de vite.config.js a propósito:
//   - Los tests son lógica pura (JS, sin JSX) → no necesitan
//     @vitejs/plugin-react. Cargarlo aquí, además, rompía: vitest carga la
//     config vía CJS y ese plugin es ESM-only.
//   - Al existir vitest.config, vitest la prioriza y NO carga vite.config.js,
//     evitando el conflicto.
// Este fichero es .mjs (ESM) para importar limpio de "vitest/config".

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // api/**: los helpers puros de _lib (compare-guess, zoom…) también se
    // testean aquí — son JS plano sin runtime de Vercel, vitest los traga.
    // lib/**: la lógica de los handlers admin vive fuera de api/ (ver la
    // estructura en CLAUDE.md) y hasta ahora no la cubría NINGÚN test — por eso
    // el KPI de repesca pudo estar mal calculado desde el día uno sin que
    // saltara nada.
    include: [
      "src/**/*.test.{js,jsx}",
      "api/**/*.test.js",
      "lib/**/*.test.js",
    ],
  },
});
