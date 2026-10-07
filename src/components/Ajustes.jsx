// src/components/Ajustes.jsx
// Las piezas de ajuste que comparten el Perfil y el Sumario: el conmutador
// segmentado y las dos filas que lo usan (tema e idioma). Viven juntas para
// que «cambiar el tema» sea el mismo gesto en las dos pantallas: antes el
// sumario tenía dos chips Día/Noche y el perfil no tenía tema, y la misma
// decisión se tomaba con dos objetos distintos según por dónde entraras.
import { useT, listLocales } from "../i18n";
import { useTheme } from "../lib/theme";
import { haptic } from "../lib/haptics";
import { isNative, REMINDER_HOUR } from "../lib/notifications";
import { useAvisoDiario } from "../hooks/useAvisoDiario";

// La opción elegida, levantada sobre el hueco. `aria-pressed` en cada botón,
// que es lo que son: conmutadores. Tocar la que ya está no hace nada (ni vibra:
// una vibración sin cambio es un falso acuse).
export function Segmentado({ opciones, valor, onCambio, etiqueta }) {
  return (
    <div className="segmentado" role="group" aria-label={etiqueta}>
      {opciones.map(([id, texto]) => (
        <button
          key={id}
          type="button"
          aria-pressed={valor === id}
          className={valor === id ? "on" : undefined}
          onClick={() => {
            if (valor === id) return;
            haptic.selection();
            onCambio(id);
          }}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

// Tema: Noche, Día o Auto (lo que diga el sistema). «Auto» es no haber elegido:
// ver `modoTema` en lib/theme.js.
export function FilaTema() {
  const { t } = useT();
  const { modo, setModo } = useTheme();
  return (
    <div className="grupo-fila">
      <span className="grupo-fila-texto">
        <b>{t("perfil.tema")}</b>
      </span>
      <Segmentado
        etiqueta={t("perfil.tema")}
        valor={modo}
        onCambio={setModo}
        opciones={[
          ["noche", t("perfil.temaNoche")],
          ["dia", t("perfil.temaDia")],
          ["auto", t("perfil.temaAuto")],
        ]}
      />
    </div>
  );
}

export function FilaIdioma() {
  const { t, locale, setLocale } = useT();
  return (
    <div className="grupo-fila">
      <span className="grupo-fila-texto">
        <b>{t("header.language")}</b>
      </span>
      <Segmentado
        etiqueta={t("header.language")}
        valor={locale}
        onCambio={setLocale}
        opciones={listLocales().map((o) => [o.code, o.name])}
      />
    </div>
  );
}

// El aviso diario, con su interruptor. En la app es el recordatorio local de
// las 20:00 (REMINDER_HOUR) si aún no has jugado; en la web, el push de las 16:00
// (la hora que promete notif.webOptInBody). Sin forma de avisar aquí —un
// navegador sin push—, la fila no existe: un interruptor muerto no explica nada.
export function FilaAviso({ abierto = true }) {
  const { t } = useT();
  const { disponible, activo, ocupado, bloqueado, cambiar } = useAvisoDiario(abierto);
  if (!disponible) return null;
  // En la web no se promete una hora: el push lo dispara un cron de GitHub a
  // las 15:00 UTC (.github/workflows/daily-push.yml), que son las 16:00 en
  // invierno y las 17:00 en verano, y GitHub no garantiza puntualidad. «Por la
  // tarde» es verdad todo el año; «a las 16:00» lo era medio año.
  const nota = bloqueado
    ? t("perfil.avisoBloqueado")
    : isNative()
    ? t("perfil.avisoHora", { hora: `${REMINDER_HOUR}:00` })
    : t("perfil.avisoTarde");
  return (
    <div className="grupo-fila">
      <span className="grupo-fila-texto">
        <b>{t("perfil.aviso")}</b>
        <span>{nota}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(activo)}
        aria-label={t("perfil.aviso")}
        className={"interruptor" + (activo ? " on" : "")}
        disabled={activo === null || ocupado || (bloqueado && !activo)}
        onClick={() => {
          haptic.selection();
          cambiar(!activo);
        }}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
