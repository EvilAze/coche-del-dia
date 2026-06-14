// api/_lib/rate-limit.js
// Extracción de la IP del cliente para endpoints Node (Vercel). El rate limit
// en sí es ahora distribuido (Upstash) en api/_lib/ratelimit.js; este módulo
// conserva solo getClientIp, que daily-image y repesca usan para auditoría.
//
// Carpeta `_lib`: excluida del routing serverless de Vercel.

export function getClientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(",")[0].trim();
  }
  const real = req.headers?.["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket?.remoteAddress || "unknown";
}
