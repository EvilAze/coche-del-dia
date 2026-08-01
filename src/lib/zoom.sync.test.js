// src/lib/zoom.sync.test.js
// Red de seguridad de CLAUDE.md #7: api/_lib/zoom.js y src/lib/zoom.js son
// RÉPLICAS deliberadas (las Edge Functions de Vercel no pueden importar desde
// src/, así que no se puede compartir un único módulo). Este test rompe el CI
// — vercel.json ejecuta `vitest run` en el build — si alguien cambia las
// constantes o la fórmula en un lado y olvida el otro.

import { describe, it, expect } from "vitest";
import * as client from "./zoom.js";
import * as server from "../../api/_lib/zoom.js";

describe("sincronía src/lib/zoom.js ↔ api/_lib/zoom.js", () => {
  it("las constantes clave son idénticas", () => {
    expect(client.DEFAULT_ZOOM_BASE).toBe(server.DEFAULT_ZOOM_BASE);
    expect(client.ZOOM_STEP).toBe(server.ZOOM_STEP);
    expect(client.ZOOM_ATTEMPTS).toBe(server.ZOOM_ATTEMPTS);
    expect(client.ZOOM_BASE_MIN).toBe(server.ZOOM_BASE_MIN);
    expect(client.ZOOM_BASE_MAX).toBe(server.ZOOM_BASE_MAX);
  });

  it("clampZoomBase se comporta igual en ambos lados", () => {
    const samples = [null, undefined, NaN, "3.9", 0, 3.2, 3.7, 4.5, 6.0, 99];
    for (const v of samples) {
      expect(client.clampZoomBase(v)).toBe(server.clampZoomBase(v));
    }
  });

  // "Sin dato" (null de la columna, "" de un input vacío) tiene que caer al
  // DEFAULT, no al MIN. Number(null) es 0 y 0 es finito, así que sin el guard
  // explícito ambos lados coincidían… en el valor equivocado (3.2).
  it("un zoom_base ausente cae al default, no al mínimo", () => {
    for (const mod of [client, server]) {
      expect(mod.clampZoomBase(null)).toBe(mod.DEFAULT_ZOOM_BASE);
      expect(mod.clampZoomBase("")).toBe(mod.DEFAULT_ZOOM_BASE);
      expect(mod.clampZoomBase(undefined)).toBe(mod.DEFAULT_ZOOM_BASE);
      // Un 0 explícito SÍ es un número fuera de rango: se acota al mínimo.
      expect(mod.clampZoomBase(0)).toBe(mod.ZOOM_BASE_MIN);
    }
  });

  it("zoomForAttempt y cropPctForAttempt coinciden para todo intento y base", () => {
    const bases = [undefined, 3.2, 3.7, 4.4, 6.0];
    for (const base of bases) {
      for (let z = 1; z <= client.ZOOM_ATTEMPTS; z++) {
        expect(client.zoomForAttempt(z, base)).toBe(server.zoomForAttempt(z, base));
        expect(client.cropPctForAttempt(z, base)).toBe(server.cropPctForAttempt(z, base));
      }
    }
  });

  // ── EL PREVIO DEL ADMIN TIENE QUE SER LO QUE VE EL JUGADOR ────────────────
  // Son dos caminos distintos hacia la misma imagen y por eso pueden divergir
  // sin que nadie se entere:
  //
  //   · admin (FocusPicker / PreviewPanel) recorta DIRECTO al intento N:
  //       cropPctForAttempt(N, base)
  //   · el juego recibe SIEMPRE el crop del intento 5 y cierra el resto con un
  //     scale CSS:
  //       cropPctForAttempt(5, base) / cssZoomLevels(base)[N-1]
  //
  // Álgebra: (1/z5) / (zN/z5) = 1/zN. Se cancelan… pero SOLO si los dos usan el
  // MISMO base. Cuando useGame perdía el zoomBase del coche, el servidor
  // recortaba con el base real y el cliente escalaba con el default: un coche a
  // 6.0 enseñaba un 11,5% en el intento 1 donde el admin previsualizaba 16,7%
  // (más difícil de lo balanceado), y uno a 3.2 enseñaba 38,3% frente a 31,3%
  // (más fácil). Solo cuadraba en el intento 5, donde el scale es 1, y en el
  // propio 3.7 — por eso pasó desapercibido. Este test es el que lo caza.
  it("el previo del admin muestra lo mismo que el juego, intento a intento", () => {
    for (const base of [3.2, 3.7, 4.5, 6.0]) {
      const cropServido = client.cropPctForAttempt(client.ZOOM_ATTEMPTS, base);
      const escalas = client.cssZoomLevels(base);
      for (let n = 1; n <= client.ZOOM_ATTEMPTS; n++) {
        const loQuePintaElAdmin = client.cropPctForAttempt(n, base);
        const loQueVeElJugador = cropServido / escalas[n - 1];
        expect(loQueVeElJugador).toBeCloseTo(loQuePintaElAdmin, 12);
      }
    }
  });
});
