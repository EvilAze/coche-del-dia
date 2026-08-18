// src/lib/nickname.js
// LA REGLA DEL NICK, EN UN SOLO SITIO DEL LADO DEL CLIENTE.
//
// Vivía copiada en statsService.js y en NicknameModal.jsx: el mismo regex
// escrito dos veces, con el mensaje de error escrito dos veces. Un módulo puro
// para poder testearlo sin montar React, igual que el resto de src/lib/.
//
// ─── ESTO NO ES LA DEFENSA ──────────────────────────────────────────────────
// La autoridad es el CHECK de la base de datos
// (scripts/2026-08-nick-validado-en-servidor.sql). El guardado del nick es un
// upsert directo a PostgREST, así que cualquier regla que solo esté aquí se
// salta escribiendo la petición a mano con el JWT propio — que es exactamente
// lo que pasaba hasta agosto de 2026.
//
// Lo de aquí es CORTESÍA: el error inmediato bajo el campo, sin viaje a la red,
// que es lo que hace usable el modal. Los dos regex son RÉPLICAS deliberadas
// (una en JS, otra en SQL, y no se pueden compartir), así que se aplican las
// mismas reglas que al zoom: nickname.sync.test.js lee el .sql y compara el
// patrón carácter a carácter. Si tocas uno y no el otro, el build cae.

// El patrón, como CADENA y no como literal /…/: es lo que permite compararlo
// con el del SQL sin depender de cómo serialice cada motor su regex.
export const NICK_PATTERN = "^[A-Za-z0-9]{1,12}$";

export const NICK_MAX = 12;

export const NICK_RE = new RegExp(NICK_PATTERN);

// Los espacios de los bordes se PERDONAN, no se rechazan: pegar un nombre con
// un espacio detrás es un accidente de copiar y pegar, no una infracción. Lo
// que se guarda es siempre el valor ya recortado, así que la base de datos
// nunca ve ese espacio.
export function limpiarNick(value) {
  return String(value ?? "").trim();
}

// Lo que el campo deja TECLEAR. No es lo mismo que validar: aquí no se rechaza
// nada, se descarta el carácter mientras se escribe, que es lo que hace que el
// input no pueda llegar a un estado inválido por el camino de la interfaz.
// Vive aquí y no en el modal porque el juego de caracteres permitido es el
// mismo dato que el del regex, y tenerlo suelto en un `onChange` es justo cómo
// se separan dos copias de una regla.
export function filtrarNick(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "");
}

// ¿Es válido lo que el jugador ha escrito? Recorta primero, por lo de arriba.
//
// SUTILEZA QUE PARECE UN DETALLE Y NO LO ES: en JavaScript `$` también casa
// justo ANTES de un salto de línea final, así que /^[A-Za-z0-9]{1,12}$/ acepta
// "PEPE\n". En Postgres no: `~` sin flags ancla al final real de la cadena. El
// trim de aquí arriba borra ese salto antes de la comprobación, así que las dos
// réplicas deciden lo mismo sobre el mismo valor — y en el caso raro en que no
// lo hicieran, la estricta es la de la base de datos, que es la que manda. El
// test lo fija para que nadie "simplifique" quitando el trim.
export function nickValido(value) {
  return NICK_RE.test(limpiarNick(value));
}
