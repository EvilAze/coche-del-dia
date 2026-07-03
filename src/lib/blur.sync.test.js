// src/lib/blur.sync.test.js
// Red de seguridad de CLAUDE.md #7 (mismo patrón que zoom.sync.test.js):
// api/_lib/blur.js y src/lib/blur.js son RÉPLICAS deliberadas — las funciones
// serverless no pueden importar desde src/ — y este test rompe el CI si
// alguien cambia la curva de desenfoque del Túnel en un lado y olvida el otro.
// Si divergieran, el blur CSS del cliente dejaría de componer con el horneado
// del servidor y los niveles de dificultad percibidos se romperían en silencio.

import { describe, it, expect } from "vitest";
import * as client from "./blur.js";
import * as server from "../../api/_lib/blur.js";

describe("sincronía src/lib/blur.js ↔ api/_lib/blur.js", () => {
  it("las constantes clave son idénticas", () => {
    expect(client.BLUR_ATTEMPTS).toBe(server.BLUR_ATTEMPTS);
    expect(client.BLUR_START_PCT).toBe(server.BLUR_START_PCT);
    expect(client.BLUR_END_PCT).toBe(server.BLUR_END_PCT);
    expect(client.BLUR_EASE).toBe(server.BLUR_EASE);
  });

  it("sigmaPctForAttempt coincide para todo intento", () => {
    for (let z = 1; z <= client.BLUR_ATTEMPTS; z++) {
      expect(client.sigmaPctForAttempt(z)).toBe(server.sigmaPctForAttempt(z));
    }
  });

  it("serverSigmaPx y cssBlurPxForAttempt coinciden en anchos típicos", () => {
    const widths = [320, 400, 448, 640, 1280];
    for (const w of widths) {
      expect(client.serverSigmaPx(w)).toBe(server.serverSigmaPx(w));
      for (let z = 1; z <= client.BLUR_ATTEMPTS; z++) {
        expect(client.cssBlurPxForAttempt(z, w)).toBe(
          server.cssBlurPxForAttempt(z, w)
        );
      }
    }
  });

  it("la curva es monótona decreciente y el último intento no añade CSS", () => {
    // Propiedades que el juego asume: cada intento aclara (sigma baja) y el
    // intento final se ve tal cual lo sirvió el servidor (extra = 0).
    for (let z = 2; z <= client.BLUR_ATTEMPTS; z++) {
      expect(client.sigmaPctForAttempt(z)).toBeLessThan(
        client.sigmaPctForAttempt(z - 1)
      );
    }
    expect(client.cssBlurPxForAttempt(client.BLUR_ATTEMPTS, 400)).toBe(0);
  });
});
