// src/components/AttemptsGauge.jsx
// Línea de estado de intentos: vive JUSTO BAJO LA IMAGEN (zona de juego), no
// en la cabecera — la cabecera queda reservada para marca (título + fecha).
// Formato barra: label a la izquierda, pips a la derecha. Los pips encendidos
// (oro, con glow) son los intentos que QUEDAN; los gastados son un punto
// sólido tenue (presente pero subordinado). Se lee de un vistazo y habla el
// mismo lenguaje dorado del resto de la web.
//
// Accesible: contenedor role="img" con aria-label de conteo exacto ("3 de 5
// intentos restantes"); los pips van aria-hidden (decorativos).

import { useT } from "../i18n";

export default function AttemptsGauge({ attempts = 0, max = 5 }) {
  const { t } = useT();
  const remaining = Math.max(0, max - attempts);

  return (
    <div
      className="mt-3 flex items-center justify-between gap-3"
      role="img"
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max })}
    >
      <span className="text-[10px] uppercase tracking-[0.22em] text-muted">
        {t("app.attempts")}
      </span>

      <div className="flex items-center gap-2" aria-hidden="true">
        {Array.from({ length: max }).map((_, i) => {
          const active = i < remaining;
          return (
            <span
              key={i}
              className={`
                h-3 w-3 rounded-full transition-all duration-300
                ${active ? "bg-accent" : "bg-white/20"}
              `}
              style={
                active
                  ? { boxShadow: "0 0 7px rgba(232,200,122,0.5)" }
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}
