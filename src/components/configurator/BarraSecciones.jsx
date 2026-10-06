// src/components/configurator/BarraSecciones.jsx
// LA BARRA DE PESTAÑAS (sistema «Asfalto»): Jugar, Clasificación, Archivo y
// Perfil, fija abajo en el móvil (app y web estrecha).
//
// POR QUÉ UNA BARRA. Las tres secciones de detrás vivían plegadas en el
// sumario de la cabecera (y la clasificación, además, en su ficha): para un
// recién llegado eran invisibles, y para el habitual costaban dos toques. Una
// barra abajo las deja a un pulgar y dice de un vistazo qué más hay en el juego.
//
// LO QUE NO CAMBIA. Clasificación, Archivo y Perfil siguen siendo HOJAS que
// suben sobre el juego (regla 24: un sitio al que vas se presenta como hoja en
// la app). La barra es la puerta, no un enrutador: al abrir una sección su hoja
// la tapa, y al cerrarla vuelves a Jugar, que es la única pestaña con pantalla
// propia. Por eso «Jugar» va siempre marcada.
//
// En el escritorio no se pinta (CSS): allí la cabecera conserva sus accesos.

import { useT } from "../../i18n";
import { Icon, I } from "./icons";

function Pestana({ icono, texto, activa = false, aviso = null, onClick }) {
  return (
    <button
      type="button"
      className={"barra-pestana" + (activa ? " activa" : "")}
      aria-current={activa ? "page" : undefined}
      aria-label={aviso ? `${texto} · ${aviso}` : undefined}
      onClick={onClick}
    >
      <span className="barra-icono">
        <Icon d={icono} size={23} />
        {aviso && <span className="barra-aviso" aria-hidden="true" />}
      </span>
      <span className="barra-texto">{texto}</span>
    </button>
  );
}

export default function BarraSecciones({
  repescaAlert = false,
  onJugar,
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
}) {
  const { t } = useT();
  return (
    <nav className="barra-secciones" aria-label={t("prensa.navAria")}>
      <Pestana icono={I.volante} texto={t("barra.jugar")} activa onClick={onJugar} />
      <Pestana icono={I.trophy} texto={t("prensa.clasificacion")} onClick={() => onOpenRanking?.("barra")} />
      <Pestana
        icono={I.rejilla}
        texto={t("prensa.garaje")}
        aviso={repescaAlert ? t("sumario.garajeRepesca") : null}
        onClick={onOpenGarage}
      />
      <Pestana icono={I.user} texto={t("prensa.perfil")} onClick={onOpenProfile} />
    </nav>
  );
}
