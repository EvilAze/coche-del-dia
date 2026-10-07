// src/components/SumarioModal.jsx
// EL MENÚ (sistema «Asfalto») — lo que hay detrás del botón de las tres rayas.
//
// En el móvil las cuatro secciones ya están en la barra de pestañas, así que el
// menú deja de ser una portada de secciones (la rejilla 2×2 de portadillas que
// componía la prensa) y pasa a ser lo que es en cualquier app: una lista
// agrupada. Arriba, si no has entrado, la única invitación que importa; luego
// las secciones, cada una con el dato que te interesa de ella (tu puesto, tu
// racha, la repesca pendiente); y debajo, los ajustes que se cambian viendo el
// efecto —tema e idioma—, los mismos dos renglones que el Perfil (Ajustes.jsx).
//
// En el escritorio no hay barra de pestañas y este menú es la puerta a todo,
// por eso conserva las cuatro secciones aunque en el móvil repitan la barra.
//
// Sin iconos dentro de cuadritos de color: el icono va suelto, en el gris del
// texto secundario, y lo que tiene que llamar la atención (la repesca) lo dice
// un punto ámbar, que es lo que significa ese color en todo el juego.

import { useT } from "../i18n";
import { useEscape } from "../hooks/useEscape";
import { haptic } from "../lib/haptics";
import Superficie from "./Superficie";
import CloseButton from "./CloseButton";
import { FilaTema, FilaIdioma } from "./Ajustes";
import { Icon, I } from "./configurator/icons";
import { ordinal } from "./PuestoCifra";

// `enBarra`: la sección ya tiene puerta propia fuera del menú (la barra de
// pestañas, o el «?» de la cabecera para la ayuda). Con la barra a la vista
// —móvil y web estrecha— esas filas se ocultan por CSS y el menú se queda en
// cuenta, ajustes y legal: cuatro puertas a lo mismo no la hacen más fácil de
// encontrar, diluyen lo demás (auditoría 7-oct, J5). Una fila con AVISO no se
// oculta nunca: el punto del menú promete algo dentro y tiene que estar.
function Seccion({ icono, nombre, apunte, aviso = false, enBarra = false, onClick }) {
  return (
    <button
      type="button"
      className={"grupo-fila" + (enBarra && !aviso ? " en-barra" : "")}
      onClick={() => {
        haptic.impactLight();
        onClick?.();
      }}
    >
      <span className="grupo-icono" aria-hidden="true">
        <Icon d={icono} size={21} />
      </span>
      <span className="grupo-fila-texto">
        <b>{nombre}</b>
        {apunte && <span className={aviso ? "ambar" : undefined}>{apunte}</span>}
      </span>
      {aviso ? (
        <span className="grupo-aviso" aria-hidden="true" />
      ) : (
        <Icon d={I.chevR} size={18} className="grupo-chev" />
      )}
    </button>
  );
}

export default function SumarioModal({
  open,
  onClose,
  user,
  rank = null,
  rankCargando = false,
  streak = 0,
  repescaAlert = false,
  onOpenGarage,
  onOpenRanking,
  onOpenProfile,
  onOpenLogin,
  onOpenHowTo,
}) {
  const { t, tn, locale } = useT();
  useEscape(open, onClose);

  // El puesto solo se enseña cuando hay uno: un «—º» no le dice nada a nadie.
  const puesto = user && rank && !rankCargando ? rank.rank : null;

  return (
    <Superficie
      open={open}
      onClose={onClose}
      label={t("sumario.menu")}
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-[78] flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-[78] flex items-end justify-center"
      panelWeb="modal-panel-flat panel-seccion w-full max-w-sm max-h-full overflow-y-auto overscroll-contain p-5"
    >
      <div className="clas-cab">
        <h2 className="clas-titulo">{t("sumario.menu")}</h2>
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      {/* Sin sesión, lo primero es la puerta: guardar la racha es la razón por
          la que alguien abre este menú sin saber muy bien qué busca. */}
      {!user && (
        <div className="sum-entrar">
          <p>
            <b>{t("sumario.entrarTitulo")}</b>
            <span>{t("sumario.entrarApunte")}</span>
          </p>
          <button type="button" className="pm-btn" onClick={() => onOpenLogin?.("sumario")}>
            {t("common.signIn")}
          </button>
        </div>
      )}

      <div className="grupo-lista">
        <Seccion
          icono={I.rejilla}
          nombre={t("prensa.garaje")}
          aviso={repescaAlert}
          apunte={repescaAlert ? t("sumario.garajeRepesca") : t("sumario.garajeApunte")}
          enBarra
          onClick={onOpenGarage}
        />
        <Seccion
          icono={I.trophy}
          nombre={t("prensa.clasificacion")}
          apunte={
            puesto != null
              ? t("sumario.puestoTemporada", { pos: ordinal(puesto, locale) })
              : t("sumario.clasificacionApunte")
          }
          enBarra
          onClick={() => onOpenRanking?.("sumario")}
        />
        {user && (
          <Seccion
            icono={I.user}
            nombre={t("prensa.perfil")}
            apunte={
              streak > 0
                ? tn("sumario.perfilRacha", streak, { count: streak })
                : t("sumario.perfilApunte")
            }
            enBarra
            onClick={onOpenProfile}
          />
        )}
        <Seccion
          icono={I.ayuda}
          nombre={t("cdd.helpAria")}
          apunte={t("sumario.comoApunte")}
          enBarra
          onClick={onOpenHowTo}
        />
      </div>

      {/* Lo que se ajusta, no lo que se visita: ninguno de los dos cierra el
          menú, se eligen viendo el efecto. */}
      <h3 className="grupo-titulo">{t("myStats.settings")}</h3>
      <div className="grupo-lista">
        <FilaTema />
        <FilaIdioma />
      </div>

      <div className="sum-pie">
        <a href="/privacidad" onClick={() => haptic.impactLight()}>
          {t("app.footerPrivacy")}
        </a>
      </div>
    </Superficie>
  );
}
