// src/components/Ajustes.jsx
// Las piezas de ajuste que comparten el Perfil y el Sumario: el conmutador
// segmentado y las dos filas que lo usan (tema e idioma). Viven juntas para
// que «cambiar el tema» sea el mismo gesto en las dos pantallas: antes el
// sumario tenía dos chips Día/Noche y el perfil no tenía tema, y la misma
// decisión se tomaba con dos objetos distintos según por dónde entraras.
import { useT, listLocales } from "../i18n";
import { useTheme } from "../lib/theme";
import { haptic } from "../lib/haptics";

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
