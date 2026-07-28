// src/components/PuestoCifra.jsx
// EL MARCADOR DE PUESTO: «7º» en Fraunces sobre oro viejo, con su «de 128
// lectores» en cursiva al lado.
//
// POR QUÉ EXISTE: el puesto se pintaba en cuatro sitios con cuatro tipografías
// distintas — 38px oro en la faja de portada, 38px oro en el parte del final de
// partida (copiado a mano, no compartido), 13px oro en la faja fina y un `7`
// GRIS sin ordinal y en Libre Franklin en las filas del modal. El jugador tocaba
// una cifra dorada enorme y aterrizaba en una tabla donde su dato ya no se
// parecía a lo que había tocado: el reconocimiento se rompía justo al llegar.
//
// Un único glifo repetido en todas las superficies convierte el ordinal en la
// FIRMA de la sección: cuando aparece, no hace falta leer el ladillo para saber
// que estás mirando la clasificación. Cambia de cuerpo según el sitio, nunca de
// familia ni de color.
//
// El oro está reservado a lo premium (CLAUDE.md): el puesto lo es. En la tabla,
// del 4º en adelante baja a tinta apagada — si todo es oro, nada lo es; y plata
// y bronce completan el podio con los mismos tonos que el Archivo y los Logros.

import { useT } from "../i18n";

// Tono por puesto para las filas de una tabla: el podio en sus tres metales, el
// resto en tinta apagada. Fuera de una tabla (faja, parte) el puesto SIEMPRE va
// en oro: ahí no compite con nadie, es tu dato.
export function tonoPorPuesto(pos) {
  if (pos === 1) return "oro";
  if (pos === 2) return "plata";
  if (pos === 3) return "bronce";
  return "tinta";
}

// El ordinal escrito. En español es siempre «7º»; en inglés depende del número
// (1st, 2nd, 3rd, 7th) y esa regla la sabe `Intl.PluralRules` con
// type:"ordinal" — más fiable que un módulo-100 escrito a mano. Antes cada
// sitio ponía la «º» a pelo, así que un jugador en inglés leía «7º» en toda la
// web. try/catch porque un WebView antiguo puede no traer PluralRules: en ese
// caso preferimos el número desnudo a reventar el chunk.
const SUFIJOS_EN = { one: "st", two: "nd", few: "rd", other: "th" };

export function ordinal(n, locale) {
  if (n == null) return "";
  if (locale !== "en") return `${n}º`;
  try {
    const regla = new Intl.PluralRules("en", { type: "ordinal" }).select(n);
    return `${n}${SUFIJOS_EN[regla] || "th"}`;
  } catch {
    return `${n}`;
  }
}

export default function PuestoCifra({
  pos,
  // Cuando viene, se pinta «de N lectores» al lado (mismo copy que el parte).
  total = null,
  // xl = faja de portada y parte del final (38px) · l = cabecera del modal (30px)
  // s = faja fina y filas de la tabla (15px)
  size = "xl",
  tono = "oro",
  className = "",
}) {
  const { t, locale } = useT();
  if (pos == null) return null;

  return (
    <span className={`pm-puesto pm-puesto--${size} pm-puesto--${tono} ${className}`.trim()}>
      {/* El ordinal va entero dentro del mismo span para que el sufijo herede el
          color y no se despegue de la cifra al ajustar el interletraje. */}
      <span className="cifra">{ordinal(pos, locale)}</span>
      {total > 0 && <span className="de">{t("parte.of", { total })}</span>}
    </span>
  );
}
