// api/_lib/image-token.test.js
// signImageToken/verifyImageToken cifran (carId, mode) con AES-256-GCM usando
// como llave el SHA-256 de REPESCA_TOKEN_SECRET. Tanto la lectura del env
// como la derivación de la llave se hacían A NIVEL DE MÓDULO — igual que el
// patrón que la regla 2 de CLAUDE.md prohíbe para los clientes de Supabase.
// Si el env llega después del import (aquí, fijado en `beforeAll`, que en ESM
// corre DESPUÉS de que los imports se evalúen), la llave se queda congelada en
// `null` para siempre: firmar lanza "not configured" y verificar devuelve
// `null` aunque el entorno esté perfectamente configurado.

import { describe, it, expect, beforeAll } from "vitest";
import {
  signImageToken,
  verifyImageToken,
  IMAGE_MODE_CLEAR,
  IMAGE_MODE_BLURRED,
} from "./image-token.js";

beforeAll(() => {
  process.env.REPESCA_TOKEN_SECRET = "secreto-de-test";
});

const COCHE_A = "11111111-1111-4111-8111-111111111111";

describe("la llave AES se deriva por llamada, no al importar", () => {
  it("signImageToken no lanza aunque el env llegue después del import", () => {
    expect(() =>
      signImageToken({ carId: COCHE_A, mode: IMAGE_MODE_CLEAR })
    ).not.toThrow();
  });

  it("roundtrip: lo que firma verifyImageToken lo descifra igual", () => {
    const token = signImageToken({ carId: COCHE_A, mode: IMAGE_MODE_BLURRED });
    expect(verifyImageToken(token)).toEqual({
      carId: COCHE_A,
      mode: IMAGE_MODE_BLURRED,
    });
  });

  it("el IV es determinista: mismo (carId, mode) produce el mismo token", () => {
    const uno = signImageToken({ carId: COCHE_A, mode: IMAGE_MODE_CLEAR });
    const dos = signImageToken({ carId: COCHE_A, mode: IMAGE_MODE_CLEAR });
    expect(uno).toBe(dos);
  });
});
