import { useEffect, useState } from "react";

// Segundos restantes hasta la próxima medianoche en Europe/Madrid.
// Usa Intl con hourCycle h23 para evitar el caso "24:00" que devuelven
// algunas implementaciones de Firefox.
function secondsUntilNextMadridMidnight() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = fmt.formatToParts(new Date());
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

  const h = get("hour");
  const m = get("minute");
  const s = get("second");

  return 86400 - (h * 3600 + m * 60 + s);
}

function format(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function useCountdown() {
  const [seconds, setSeconds] = useState(() => secondsUntilNextMadridMidnight());

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(secondsUntilNextMadridMidnight());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return { seconds, formatted: format(seconds) };
}
