// scripts/test-security.mjs
// Smoke tests de los fixes de seguridad. Se ejecutan SIN desplegar y SIN
// Supabase: validan los primitivos (HMAC, cookie, rate-limit) y los caminos
// del handler que se decide antes de tocar la BD.
//
// Uso:
//   node scripts/test-security.mjs
//
// Las env vars se setean dentro del script para que sea autosuficiente.

// Importante: REPESCA_TOKEN_SECRET debe estar ANTES de cualquier import de
// los _lib, porque esos archivos leen el secreto al cargarse.
process.env.REPESCA_TOKEN_SECRET = "test-secret-1234567890";
process.env.SUPABASE_URL = "http://localhost:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.SUPABASE_ANON_KEY = "fake-anon";
process.env.NODE_ENV = "development";

const {
  signAnonSession,
  verifyAnonSession,
  parseCookies,
  buildSetCookie,
  ANON_COOKIE_NAME,
} = await import("../api/_lib/anon-session.js");

const { signRevealToken, verifyRevealToken } = await import(
  "../api/_lib/reveal-token.js"
);

const { rateLimit, getClientIp } = await import("../api/_lib/rate-limit.js");

// ---------- harness mínimo de assertions --------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label}\n      actual:   ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`);
    console.log(`  ✗ ${label}`);
  }
}

function truthy(label, value) {
  if (value) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label} (expected truthy, got ${JSON.stringify(value)})`);
    console.log(`  ✗ ${label}`);
  }
}

function falsy(label, value) {
  if (!value) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(`${label} (expected falsy, got ${JSON.stringify(value)})`);
    console.log(`  ✗ ${label}`);
  }
}

// ============================================================================
console.log("\n[anon-session]");
// ============================================================================

{
  const payload = { d: "2026-05-20", n: 3, s: "playing" };
  const token = signAnonSession(payload);
  const back = verifyAnonSession(token);
  eq("roundtrip preserva payload", back, payload);
}

{
  // Tamper en el body: cambiar n=3 → n=0 (simular cheater bajando contador
  // para volver a jugar). La firma no coincide → null.
  const token = signAnonSession({ d: "2026-05-20", n: 3, s: "playing" });
  const [body, sig] = token.split(".");
  // body es base64url del JSON. Decodificamos, alteramos, re-encodeamos.
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  decoded.n = 0;
  const tampered =
    Buffer.from(JSON.stringify(decoded)).toString("base64url") + "." + sig;
  const result = verifyAnonSession(tampered);
  falsy("body modificado → null", result);
}

{
  // Tamper en la firma.
  const token = signAnonSession({ d: "2026-05-20", n: 3, s: "playing" });
  const [body] = token.split(".");
  const result = verifyAnonSession(body + ".AAAAAAAAAAAAAAAAAAAA");
  falsy("firma falsa → null", result);
}

{
  falsy("token vacío → null", verifyAnonSession(""));
  falsy("token sin punto → null", verifyAnonSession("garbage"));
  falsy("token con punto al final → null", verifyAnonSession("body."));
  falsy("token con punto al inicio → null", verifyAnonSession(".sig"));
}

{
  // Cookie HttpOnly y flags correctos en buildSetCookie.
  const sc = buildSetCookie({ d: "2026-05-20", n: 0, s: "playing" });
  truthy("cookie incluye HttpOnly", sc.includes("HttpOnly"));
  truthy("cookie incluye SameSite=Lax", sc.includes("SameSite=Lax"));
  truthy("cookie incluye Path=/", sc.includes("Path=/"));
  truthy("cookie incluye Max-Age", /Max-Age=\d+/.test(sc));
  // En NODE_ENV=development NO esperamos Secure (test arriba lo setea).
  falsy("cookie SIN Secure en dev", sc.includes("Secure"));
}

{
  // parseCookies sobrevive a varios formatos.
  const req = {
    headers: {
      cookie: `${ANON_COOKIE_NAME}=abc.def; otherCookie=xyz; spacey  =  yes  `,
    },
  };
  const cookies = parseCookies(req);
  eq("parseCookies extrae cd_anon", cookies[ANON_COOKIE_NAME], "abc.def");
  eq("parseCookies extrae otra cookie", cookies.otherCookie, "xyz");
}

// ============================================================================
console.log("\n[reveal-token]");
// ============================================================================

{
  const t = signRevealToken("2026-05-20");
  eq("roundtrip reveal-token", verifyRevealToken(t), "2026-05-20");
}

{
  // Tamper en la fecha.
  const t = signRevealToken("2026-05-20");
  const [body, sig] = t.split(".");
  const tampered = Buffer.from("2026-05-21").toString("base64url") + "." + sig;
  falsy("fecha alterada → null", verifyRevealToken(tampered));
}

{
  falsy("token vacío → null", verifyRevealToken(""));
  falsy("token sin firma → null", verifyRevealToken("abc."));
  falsy("token sin body → null", verifyRevealToken(".abc"));
}

{
  // Día distinto: el helper solo devuelve la fecha; el caller compara. La
  // verificación per se NO rechaza por fecha vieja — eso es responsabilidad
  // del handler (daily-image, get-daily-car). Documentamos el contrato.
  const old = signRevealToken("2024-01-01");
  eq("verifyRevealToken devuelve la fecha tal cual", verifyRevealToken(old), "2024-01-01");
}

// ============================================================================
console.log("\n[rate-limit]");
// ============================================================================

{
  const ip = "10.0.0.1";
  let lastOk = null;
  for (let i = 1; i <= 30; i++) {
    lastOk = rateLimit(`vg:${ip}`, { max: 30, windowMs: 60_000 });
  }
  truthy("30 hits dentro del límite", lastOk.ok);
  eq("remaining=0 en el 30º hit", lastOk.remaining, 0);

  const over = rateLimit(`vg:${ip}`, { max: 30, windowMs: 60_000 });
  falsy("31º hit excede límite", over.ok);
}

{
  // Ventana corta para no esperar 60 s en el test: 100 ms.
  const ip = "10.0.0.2";
  for (let i = 0; i < 5; i++) rateLimit(`win:${ip}`, { max: 5, windowMs: 100 });
  const over = rateLimit(`win:${ip}`, { max: 5, windowMs: 100 });
  falsy("excede tras 5 hits en 100ms", over.ok);

  await new Promise((r) => setTimeout(r, 150));
  const afterReset = rateLimit(`win:${ip}`, { max: 5, windowMs: 100 });
  truthy("ventana reseteada tras esperar", afterReset.ok);
}

{
  // getClientIp prioriza x-forwarded-for primer hop, luego x-real-ip,
  // luego remoteAddress.
  eq(
    "x-forwarded-for (string múltiple)",
    getClientIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }),
    "1.2.3.4"
  );
  eq(
    "x-real-ip fallback",
    getClientIp({ headers: { "x-real-ip": "9.9.9.9" } }),
    "9.9.9.9"
  );
  eq(
    "remoteAddress fallback",
    getClientIp({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }),
    "127.0.0.1"
  );
}

// ============================================================================
// Resumen
// ============================================================================
console.log(
  `\n${passed}/${passed + failed} passed${failed ? `, ${failed} failed` : ""}`
);
if (failed) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
