// src/hooks/useOnline.js
// ¿Hay conexión? Sirve para AFINAR EL MENSAJE de un fallo que ya ha ocurrido,
// no para decidir si merece la pena intentarlo.
//
// Por qué esa distinción: `navigator.onLine` responde "¿tengo interfaz de red
// activa?", no "¿llego a internet?". Un móvil enganchado a un wifi de hotel sin
// autenticar, o con datos agotados, reporta `true` alegremente. Usarlo como
// puerta ("si está offline, ni lo intento") produce falsos negativos que dejan
// la app inútil teniendo cobertura. Al revés sí es fiable: si dice `false`, no
// hay red, punto.
//
// Por eso el flujo es: SIEMPRE se intenta la petición; si falla, este hook
// decide si el cartel dice "no hay conexión" o "no hemos podido cargar".

import { useEffect, useState } from "react";

function leerEstado() {
  if (typeof navigator === "undefined") return true;
  // `undefined` en navegadores viejos: asumimos que sí hay red, que es el
  // supuesto que menos daño hace (se intenta y, como mucho, falla).
  return navigator.onLine !== false;
}

export function useOnline() {
  const [online, setOnline] = useState(leerEstado);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const conectado = () => setOnline(true);
    const desconectado = () => setOnline(false);
    window.addEventListener("online", conectado);
    window.addEventListener("offline", desconectado);
    // Resincronizamos al montar: entre el primer render y este efecto puede
    // haber cambiado el estado (arranque en frío de la app Android, donde la
    // radio tarda en levantar).
    setOnline(leerEstado());
    return () => {
      window.removeEventListener("online", conectado);
      window.removeEventListener("offline", desconectado);
    };
  }, []);

  return online;
}
