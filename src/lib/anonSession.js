// src/lib/anonSession.js
// Token de sesión anónima del coche del día. Lo emite el servidor firmado
// (HMAC) y lo guardamos en localStorage para reenviarlo en el header
// X-Anon-Session en get-daily-car y validate-guess. Sustituye a la cookie
// HttpOnly anterior: la app Android (origen distinto a la API) no puede
// depender de cookies cross-site. Para usuarios logueados no se usa (su estado
// vive server-side en user_guesses).

const STORAGE_KEY = "cd_anon_token";
export const ANON_HEADER = "X-Anon-Session";

export function getAnonToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setAnonToken(token) {
  if (!token || typeof token !== "string") return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // modo privado / storage lleno: el servidor regenerará el token en la
    // próxima petición. No rompemos el juego.
  }
}

/**
 * Cabeceras para una request anónima al API. Objeto vacío si aún no hay token
 * (primera visita): get-daily-car lo creará y devolverá uno.
 */
export function anonHeaders() {
  const token = getAnonToken();
  return token ? { [ANON_HEADER]: token } : {};
}
