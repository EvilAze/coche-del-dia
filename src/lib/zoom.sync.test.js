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

  it("zoomForAttempt y cropPctForAttempt coinciden para todo intento y base", () => {
    const bases = [undefined, 3.2, 3.7, 4.4, 6.0];
    for (const base of bases) {
      for (let z = 1; z <= client.ZOOM_ATTEMPTS; z++) {
        expect(client.zoomForAttempt(z, base)).toBe(server.zoomForAttempt(z, base));
        expect(client.cropPctForAttempt(z, base)).toBe(server.cropPctForAttempt(z, base));
      }
    }
  });
});
