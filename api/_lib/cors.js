// api/_lib/cors.js
// Allowlist de orígenes para CORS. Solo la app Android (Capacitor) necesita
// CORS: la web es same-origin. Como la sesión anónima viaja por header
// X-Anon-Session (no por cookie), NO usamos credenciales → nunca "*" pero
// tampoco Allow-Credentials. Módulo puro (edge-safe, sin APIs de Node).

const ALLOWED_APP_ORIGINS = ["https://localhost"];

export function isAllowedOrigin(origin) {
  return typeof origin === "string" && ALLOWED_APP_ORIGINS.includes(origin);
}

export const CORS_ALLOW_HEADERS = "Content-Type, Authorization, X-Anon-Session";
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
