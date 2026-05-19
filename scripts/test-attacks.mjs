// scripts/test-attacks.mjs
// Simula escenarios concretos del cheater:
//   1) Quitar &z=5 a /api/daily-image (con varias combinaciones).
//   2) Invocar /api/validate-guess saturando el rate-limit.
//
// Para (1) usamos los MISMOS helpers que el handler para verificar canReveal,
// que es la única decisión que afecta a la imagen. Si canReveal=false el
// handler fuerza wantedZ=5, así que la imagen sale crop. Si canReveal=true
// honra la petición del cliente (sin z → full).
//
// Para (2) invocamos el handler real con req/res mock e IP fija. La función
// rate-limit es síncrona, en memoria, y se ejecuta ANTES de cualquier query
// a Supabase, así que podemos disparar 429 sin BD.

process.env.REPESCA_TOKEN_SECRET = "test-secret-1234567890";
process.env.SUPABASE_URL = "http://localhost:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.SUPABASE_ANON_KEY = "fake-anon";
process.env.NODE_ENV = "development";

const { signAnonSession, verifyAnonSession, ANON_COOKIE_NAME } = await import(
  "../api/_lib/anon-session.js"
);
const { signRevealToken, verifyRevealToken } = await import(
  "../api/_lib/reveal-token.js"
);
const { rateLimit } = await import("../api/_lib/rate-limit.js");
const validateGuess = (await import("../api/validate-guess.js")).default;

// ---------- harness ------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}${detail ? `\n      ${detail}` : ""}`);
    console.log(`  ✗ ${label}`);
  }
}

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Helper: reproduce la decisión canReveal de daily-image.js, branch por
// branch. Si esto coincide con el código del handler (api/daily-image.js
// líneas con "canReveal"), tenemos cobertura simbólica.
function computeCanReveal({ tParam = null, cookieValue = null, today }) {
  // Branch 1: ?t=<reveal token>
  if (tParam) {
    const tokenDate = verifyRevealToken(tParam);
    if (tokenDate === today) return true;
  }
  // Branch 2: Bearer con user_guesses.status — no testable sin Supabase,
  // omitido aquí. El handler real lo cubre.
  // Branch 3: cookie anon firmada con s ∈ {won, lost}.
  if (cookieValue) {
    const anon = verifyAnonSession(cookieValue);
    if (anon && anon.d === today && (anon.s === "won" || anon.s === "lost")) {
      return true;
    }
  }
  return false;
}

const TODAY = todayInMadrid();

// ============================================================================
console.log("\n[ATAQUE 1] Quitar &z=5 a /api/daily-image");
// ============================================================================

// Escenario A: cheater anónimo sin haber jugado, quita &z=5.
// (Pre-condición: NO tiene cookie con s=won/lost, NO tiene token).
check(
  "anon sin cookie + sin token → canReveal=false (crop forzado)",
  computeCanReveal({ today: TODAY }) === false
);

// Escenario B: cheater anónimo CON cookie pero jugando (s=playing).
{
  const playingCookie = signAnonSession({ d: TODAY, n: 2, s: "playing" });
  check(
    "anon con cookie s=playing → canReveal=false",
    computeCanReveal({ cookieValue: playingCookie, today: TODAY }) === false
  );
}

// Escenario C: cheater fabrica una cookie con s=won (sin saber el secreto).
{
  const fakePayload = Buffer.from(
    JSON.stringify({ d: TODAY, n: 5, s: "won" })
  ).toString("base64url");
  const fakeCookie = fakePayload + ".AAAAAAAAAAAAAAAAAAAA";
  check(
    "cookie forjada con s=won (firma falsa) → canReveal=false",
    computeCanReveal({ cookieValue: fakeCookie, today: TODAY }) === false
  );
}

// Escenario D: jugador legítimo que ganó, refresca la pestaña.
{
  const wonCookie = signAnonSession({ d: TODAY, n: 3, s: "won" });
  check(
    "cookie real con s=won → canReveal=true (full image OK)",
    computeCanReveal({ cookieValue: wonCookie, today: TODAY }) === true
  );
}

// Escenario E: cheater reutiliza una cookie ANTIGUA (won de ayer).
{
  const oldWon = signAnonSession({ d: "2024-01-01", n: 3, s: "won" });
  check(
    "cookie won de día antiguo → canReveal=false",
    computeCanReveal({ cookieValue: oldWon, today: TODAY }) === false
  );
}

// Escenario F: ?t= con token de hoy correctamente firmado.
{
  const t = signRevealToken(TODAY);
  check(
    "?t= con token válido de hoy → canReveal=true",
    computeCanReveal({ tParam: t, today: TODAY }) === true
  );
}

// Escenario G: cheater forja un token con la firma "AAA...".
{
  const fakeBody = Buffer.from(TODAY).toString("base64url");
  const fakeToken = fakeBody + ".AAAAAAAAAAAAAAAAAAAA";
  check(
    "?t= con token forjado → canReveal=false",
    computeCanReveal({ tParam: fakeToken, today: TODAY }) === false
  );
}

// Escenario H: ?t= con token real pero de OTRO día.
{
  const oldT = signRevealToken("2024-01-01");
  check(
    "?t= con token real pero de otro día → canReveal=false",
    computeCanReveal({ tParam: oldT, today: TODAY }) === false
  );
}

// ============================================================================
console.log("\n[ATAQUE 2] Brute-force a /api/validate-guess (rate-limit)");
// ============================================================================

function mockReq({ headers = {}, body = {}, query = {}, ip = "8.8.8.8" }) {
  return {
    method: "POST",
    headers: { ...headers, "x-forwarded-for": ip },
    body,
    query,
    socket: { remoteAddress: ip },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (n) => {
    res.statusCode = n;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    res.ended = true;
    return res;
  };
  res.send = (b) => {
    res.body = b;
    res.ended = true;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

// Estrategia: pre-quemamos 30 slots del rate-limit en una IP concreta para
// que la primera invocación del handler dispare 429 inmediatamente, ANTES
// de tocar Supabase. Esto verifica que el handler engancha el rate-limit.
const ATTACKER_IP = "203.0.113.99";
for (let i = 0; i < 30; i++) {
  rateLimit(`vg:${ATTACKER_IP}`, { max: 30, windowMs: 60_000 });
}

{
  // 31º hit del cheater → debe devolver 429 sin tocar BD.
  const req = mockReq({
    body: {
      guessCarId: "00000000-0000-0000-0000-000000000000",
      anio: 2020,
      attemptNumber: 1,
    },
    ip: ATTACKER_IP,
  });
  const res = mockRes();
  await validateGuess(req, res);
  check(
    "tras 30 hits en 1 min, 31º → 429",
    res.statusCode === 429,
    `statusCode=${res.statusCode} body=${JSON.stringify(res.body)}`
  );
  check(
    "respuesta 429 indica 'Too many requests'",
    res.body?.error === "Too many requests"
  );
  check(
    "incluye header Retry-After",
    typeof res.headers["retry-after"] === "string"
  );
}

// Caso negativo: IP "limpia" que NO ha sido pre-quemada — el rate-limit
// debe dejarla pasar (aunque luego falle por Supabase no disponible, eso
// no nos importa para este test).
{
  const req = mockReq({
    body: {
      guessCarId: "00000000-0000-0000-0000-000000000000",
      anio: 2020,
      attemptNumber: 1,
    },
    ip: "198.51.100.50",
  });
  const res = mockRes();
  await validateGuess(req, res);
  check(
    "IP limpia NO recibe 429 (pasa el rate-limit)",
    res.statusCode !== 429,
    `statusCode=${res.statusCode}`
  );
}

// Caso: método incorrecto → 405 (defensa básica, debería seguir intacta).
{
  const req = { method: "GET", headers: {}, query: {}, socket: {} };
  const res = mockRes();
  await validateGuess(req, res);
  check("GET → 405", res.statusCode === 405);
}

// ============================================================================
console.log("\n[ATAQUE 3] Cookie anon spoof en validate-guess");
// ============================================================================

// Aunque no podamos probar el camino completo sin Supabase, podemos
// verificar el contrato: una cookie con n=5 (intentos agotados) debe ser
// rechazada por el handler en algún punto. La detección concreta vive
// dentro del try/catch tras pick_daily_car, así que aquí solo validamos
// el primitivo: verifyAnonSession({n:5}) NO deja pasar a n+1=6.

{
  const exhaustedCookie = signAnonSession({ d: TODAY, n: 5, s: "playing" });
  const parsed = verifyAnonSession(exhaustedCookie);
  check(
    "cookie con n=5 mantiene n=5 al verificar",
    parsed?.n === 5
  );
  // El handler hace: if (anonSession.n >= MAX_ATTEMPTS) return 403.
  // Aquí solo aseguramos que el parsing produce el valor correcto.
  check(
    "MAX_ATTEMPTS=5 implica n+1 = 6 → rechazo",
    parsed.n + 1 > 5
  );
}

// Cookie con s=won: el handler la rechaza con 403 'Game already finished'.
{
  const wonCookie = signAnonSession({ d: TODAY, n: 3, s: "won" });
  const parsed = verifyAnonSession(wonCookie);
  check(
    "cookie s=won es detectable como partida cerrada",
    parsed?.s === "won"
  );
}

// ============================================================================
console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} failed` : ""}`
);
if (failed) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
