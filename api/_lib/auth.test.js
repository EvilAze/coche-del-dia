// api/_lib/auth.test.js
// Tests de la resolución de sesión contra GoTrue. Lo que hay que demostrar es
// el comportamiento ante un GoTrue que TARTAMUDEA, que es el fallo real que se
// observó el 23 de agosto de 2026: no estaba caído —contestaba a unas
// peticiones y a otras no— y por eso el reintento importa más que el plazo.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del módulo de clientes: authClientAndUser solo necesita que
// createAuthClient le devuelva algo con .auth.getUser().
const getUserMock = vi.fn();
const getClaimsMock = vi.fn();
vi.mock("./supabase.js", () => ({
  createAuthClient: vi.fn(() => ({
    auth: { getUser: getUserMock, getClaims: getClaimsMock },
  })),
}));

// El JWKS se mockea: qué claves haya es cosa de jwks.js y tiene su propio
// contrato; aquí lo que se prueba es a quién se le pregunta la identidad.
const jwksMock = vi.fn();
vi.mock("./jwks.js", () => ({ getJwks: (...a) => jwksMock(...a) }));

const { authClientAndUser, requireUser } = await import("./auth.js");

// Nunca resuelve: así se comporta GoTrue cuando se atranca (no falla, calla).
const seAtranca = () => new Promise(() => {});
const usuario = { data: { user: { id: "u1", email: "a@b.c" } }, error: null };

// Token de mentira con cabecera decodificable: lo único que auth.js le lee es
// el `kid`, para saber qué clave pedir.
function tokenCon(cabecera) {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
  return `${b64(cabecera)}.${b64({ sub: "u1" })}.firma`;
}
const TOKEN_ASIMETRICO = tokenCon({ alg: "ES256", kid: "k1" });
const TOKEN_SIMETRICO = tokenCon({ alg: "HS256" });

const claims = {
  data: { claims: { sub: "u1", email: "a@b.c", user_metadata: { nick: "ruben" } } },
  error: null,
};

beforeEach(() => {
  getUserMock.mockReset();
  getClaimsMock.mockReset();
  jwksMock.mockReset();
  // Por defecto: hay claves y la firma verifica.
  jwksMock.mockResolvedValue({ keys: [{ kid: "k1" }] });
  getClaimsMock.mockResolvedValue(claims);
});

describe("identidad verificada en local", () => {
  it("con JWKS y token asimétrico NO se llama a GoTrue", async () => {
    // Es el punto entero del cambio: durante la degradación del 23 de agosto
    // de 2026, /auth/v1/user no contestaba en 10 s y esto tumbaba la web.
    const r = await authClientAndUser(TOKEN_ASIMETRICO);
    expect(r.user).toEqual({
      id: "u1",
      email: "a@b.c",
      user_metadata: { nick: "ruben" },
      app_metadata: {},
    });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("le pide al JWKS la clave del kid que trae el token", async () => {
    await authClientAndUser(TOKEN_ASIMETRICO);
    expect(jwksMock).toHaveBeenCalledWith({ kid: "k1" });
    expect(getClaimsMock).toHaveBeenCalledWith(TOKEN_ASIMETRICO, {
      keys: [{ kid: "k1" }],
    });
  });

  it("token con firma inválida o caducada → NO se pregunta a GoTrue", async () => {
    // Un token que no vale es un NO definitivo; caer al respaldo sería pedirle
    // a GoTrue que nos repita lo mismo, y encima con GoTrue caído daría 503.
    const err = new Error("Invalid JWT signature");
    err.name = "AuthInvalidJwtError";
    getClaimsMock.mockRejectedValue(err);
    const r = await authClientAndUser(TOKEN_ASIMETRICO);
    expect(r.user).toBeNull();
    expect(r.timedOut).toBeUndefined();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("token simétrico (HS256, sin kid) → respaldo a GoTrue", async () => {
    getUserMock.mockResolvedValue(usuario);
    const r = await authClientAndUser(TOKEN_SIMETRICO);
    expect(r.user.id).toBe("u1");
    expect(getClaimsMock).not.toHaveBeenCalled();
    expect(getUserMock).toHaveBeenCalledWith(TOKEN_SIMETRICO);
  });

  it("sin claves en el JWKS → respaldo a GoTrue", async () => {
    jwksMock.mockResolvedValue({ keys: [] });
    getUserMock.mockResolvedValue(usuario);
    const r = await authClientAndUser(TOKEN_ASIMETRICO);
    expect(r.user.id).toBe("u1");
    expect(getUserMock).toHaveBeenCalled();
  });
});

describe("authClientAndUser", () => {
  it("sin token no llama a GoTrue siquiera", async () => {
    expect(await authClientAndUser(null)).toEqual({ client: null, user: null });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("le pasa el JWT EXPLÍCITO a getUser (camino corto de la librería)", async () => {
    getUserMock.mockResolvedValue(usuario);
    await authClientAndUser("jwt-123");
    // Sin argumento, getUser se va por initializePromise + _acquireLock +
    // _useSession para leer un almacén que aquí siempre está vacío.
    expect(getUserMock).toHaveBeenCalledWith("jwt-123");
  });

  it("token válido a la primera → usuario", async () => {
    getUserMock.mockResolvedValue(usuario);
    const r = await authClientAndUser("jwt-123");
    expect(r.user.id).toBe("u1");
    expect(r.timedOut).toBeUndefined();
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });

  it("SE ATRANCA UNA VEZ Y RESPONDE A LA SEGUNDA → usuario, no error", async () => {
    // El caso que motiva todo esto: sin reintento, este usuario veía un 503
    // aunque GoTrue estaba dispuesto a contestarle.
    getUserMock.mockImplementationOnce(seAtranca).mockResolvedValueOnce(usuario);
    const r = await authClientAndUser("jwt-123");
    expect(r.user.id).toBe("u1");
    expect(getUserMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("se atranca las DOS veces → timedOut (no un 401 mentiroso)", async () => {
    getUserMock.mockImplementation(seAtranca);
    const r = await authClientAndUser("jwt-123");
    expect(r).toEqual({ client: null, user: null, timedOut: true });
    expect(getUserMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("token que NO vale → sin usuario y SIN timedOut, y no se reintenta", async () => {
    // Un token inválido es definitivo: reintentarlo seria gastar otro viaje
    // para que nos digan lo mismo.
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const r = await authClientAndUser("jwt-malo");
    expect(r.user).toBeNull();
    expect(r.timedOut).toBeUndefined();
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});

describe("requireUser", () => {
  const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("sin token → 401", async () => {
    const r = await requireUser(req(null));
    expect(r.error.status).toBe(401);
  });

  it("token que no vale → 401", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    expect((await requireUser(req("malo"))).error.status).toBe(401);
  });

  it("GoTrue atrancado → 503, NO 401", async () => {
    // La diferencia no es cosmética: un 401 manda al usuario a iniciar sesión
    // otra vez para arreglar algo que no es suyo y que se va solo.
    getUserMock.mockImplementation(seAtranca);
    const r = await requireUser(req("bueno"));
    expect(r.error.status).toBe(503);
    expect(r.error.retryAfter).toBe(5);
  }, 20000);

  it("token válido → usuario y cliente", async () => {
    getUserMock.mockResolvedValue(usuario);
    const r = await requireUser(req("bueno"));
    expect(r.error).toBeUndefined();
    expect(r.user.id).toBe("u1");
    expect(r.authClient).toBeTruthy();
  });
});
