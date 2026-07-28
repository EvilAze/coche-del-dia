// src/lib/authCallback.test.js
// El parser del error que trae la vuelta de OAuth. Lo que protege es que un
// login fallido NUNCA vuelva a desaparecer sin decir nada: ese silencio es lo
// que convirtió un fallo concreto en un «no funciona» imposible de diagnosticar.

import { describe, it, expect } from "vitest";
import { leerErrorAuth, esIdentidadYaVinculada } from "./authCallback";

const loc = (search = "", hash = "") => ({ search, hash });

describe("leerErrorAuth", () => {
  it("lee el error del QUERY (flujo PKCE, el de por defecto en navegador)", () => {
    const e = leerErrorAuth(
      loc("?error=server_error&error_description=Identity+is+already+linked")
    );
    expect(e).toEqual({
      code: "server_error",
      description: "Identity is already linked",
    });
  });

  it("lee el error del FRAGMENTO (flujo implícito)", () => {
    const e = leerErrorAuth(loc("", "#error=access_denied&error_description=User+denied"));
    expect(e.code).toBe("access_denied");
    expect(e.description).toBe("User denied");
  });

  it("cae a error_code cuando no viene `error`", () => {
    expect(leerErrorAuth(loc("?error_code=identity_already_exists")).code).toBe(
      "identity_already_exists"
    );
  });

  it("sin descripción, se queda con el código en vez de dejarlo vacío", () => {
    expect(leerErrorAuth(loc("?error=server_error")).description).toBe("server_error");
  });

  it("una URL normal no inventa errores", () => {
    expect(leerErrorAuth(loc("", ""))).toBeNull();
    expect(leerErrorAuth(loc("?d=28-07", "#algo"))).toBeNull();
    // El fragmento con tokens de una sesión BUENA no es un error.
    expect(leerErrorAuth(loc("", "#access_token=abc&expires_in=3600"))).toBeNull();
  });

  it("no lanza sin location", () => {
    expect(leerErrorAuth(null)).toBeNull();
  });
});

describe("esIdentidadYaVinculada", () => {
  // Laxo a propósito: Supabase no documenta qué código emite exactamente en
  // este caso, y atarnos a una cadena concreta sería dar por buena otra
  // suposición sin comprobarla. Fallar aquí solo degrada al aviso genérico,
  // que también ofrece entrar.
  it("reconoce las formas que puede tomar", () => {
    for (const d of [
      "Identity is already linked to another user",
      "identity_already_exists",
      "User already exists",
      "Manual linking is disabled",
    ]) {
      expect(esIdentidadYaVinculada({ code: "server_error", description: d })).toBe(true);
    }
  });

  it("no confunde otros errores", () => {
    expect(
      esIdentidadYaVinculada({ code: "access_denied", description: "User denied access" })
    ).toBe(false);
    expect(esIdentidadYaVinculada(null)).toBe(false);
  });
});
