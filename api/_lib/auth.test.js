// api/_lib/auth.test.js
// Tests de la resolución de sesión contra GoTrue. Lo que hay que demostrar es
// el comportamiento ante un GoTrue que TARTAMUDEA, que es el fallo real que se
// observó el 23 de agosto de 2026: no estaba caído —contestaba a unas
// peticiones y a otras no— y por eso el reintento importa más que el plazo.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock del módulo de clientes: authClientAndUser solo necesita que
// createAuthClient le devuelva algo con .auth.getUser().
const getUserMock = vi.fn();
vi.mock("./supabase.js", () => ({
  createAuthClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
}));

const { authClientAndUser, requireUser } = await import("./auth.js");

// Nunca resuelve: así se comporta GoTrue cuando se atranca (no falla, calla).
const seAtranca = () => new Promise(() => {});
const usuario = { data: { user: { id: "u1", email: "a@b.c" } }, error: null };

beforeEach(() => {
  getUserMock.mockReset();
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
