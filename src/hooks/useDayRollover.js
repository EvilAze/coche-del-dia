// src/hooks/useDayRollover.js
// Detecta cuándo el día (Europe/Madrid) cambia mientras la pestaña está
// abierta — el típico "dejé la web abierta a las 23:55 y vuelvo a las 00:05".
//
// Cuando ocurre, devuelve `staleDay = true` para que la UI muestre un aviso
// "nuevo coche del día, recarga" en vez de seguir mostrando los datos de
// ayer (que ya no se corresponden con la imagen, la fecha en el header,
// los intentos válidos en el backend, etc.).
//
// Estrategia de detección, en orden de coste:
//   1. visibilitychange   → cuando el usuario vuelve a la pestaña tras
//                            cambiar de app / desbloquear el móvil. Es el
//                            caso 99%.
//   2. focus              → desktop, alt-tab entre ventanas.
//   3. setTimeout exacto  → calculamos los ms hasta la próxima medianoche
//                            de Madrid y disparamos el check ahí. Cubre el
//                            usuario que deja la pestaña visible toda la
//                            noche sin tocar nada.
//   4. setInterval(60s)   → safety net si el setTimeout falla por throttle
//                            de pestañas en segundo plano (Chrome reduce
//                            timers a 1/min en background). Comprueba una
//                            vez por minuto, despreciable.
//
// Cuando `staleDay` pasa a true, no vuelve a false: la única salida es
// recargar la página (que remontará el hook con el día nuevo).

import { useEffect, useRef, useState } from "react";
// "Hoy" en zona Madrid: helper único compartido (antes había aquí una copia
// local idéntica de este formateador, también en dates.js y useGame).
import { getMadridDateStr } from "../lib/dates";

function msUntilNextMadridMidnight() {
  // Igual que useCountdown pero en ms y con tope mínimo de 1s para no
  // disparar un setTimeout de 0 ms en bucle si justo se ha pasado.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  const secs = 86400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
  return Math.max(1000, secs * 1000);
}

export function useDayRollover() {
  // Capturamos el día al montar el hook. Snapshot estable durante toda la
  // vida del componente raíz — solo cambia al recargar la página.
  const initialDayRef = useRef(getMadridDateStr());
  const [staleDay, setStaleDay] = useState(false);

  useEffect(() => {
    // Si el hook se monta justo después de medianoche (caso raro pero
    // posible: refresh exactamente a las 00:00), staleDay arranca false
    // porque initialDay ya es el nuevo. OK.
    let mounted = true;

    function check() {
      if (!mounted || staleDay) return;
      if (getMadridDateStr() !== initialDayRef.current) {
        setStaleDay(true);
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") check();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    // Timeout exacto hasta medianoche + un colchón de 2 s para que el
    // reloj de Madrid ya esté en el día siguiente cuando comparemos.
    const exactId = setTimeout(check, msUntilNextMadridMidnight() + 2000);
    // Safety net: cada 60 s. Cubre el caso de pestaña en background donde
    // el navegador throttlea timers (Chrome → 1 evento/min en background).
    const intervalId = setInterval(check, 60_000);

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      clearTimeout(exactId);
      clearInterval(intervalId);
    };
  }, [staleDay]);

  return staleDay;
}
