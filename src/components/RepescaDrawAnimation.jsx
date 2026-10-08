// src/components/RepescaDrawAnimation.jsx
// EL SORTEO DE LA REPESCA (sistema «Asfalto»): «el visor busca tu coche».
//
// Sustituye al mazo de cartas genéricas. El sorteo pasa DENTRO del mismo marco
// 4:3 de la foto del juego, con sus esquinas de visor y el canto ámbar de la
// repesca, y se cuenta con piezas que el jugador ya conoce:
//
//   1. ABRIR (≈260 ms): el visor aparece y las cuatro esquinas entran desde
//      fuera hasta encuadrar — una cámara que encuadra.
//   2. GIRAR (GIRO_MS): un carrete de números sin revelar —las fichas rayadas
//      del Archivo, con «Nº ?» y las dos rayas de la marca— pasa por el visor.
//      Arranca rápido, con algo de desenfoque, y frena largo. La mano nota un
//      tic por cada número que cruza el centro, cada vez más espaciados: un
//      trinquete (lib/sorteo.js calcula los tics con la MISMA curva que mueve
//      el carrete).
//   3. ENFOCAR: el carrete se clava con un pequeño rebote, las esquinas muerden
//      hacia dentro y vuelven, y un golpe firme. Aquí se ESPERA, si hace falta,
//      a que el servidor haya elegido y a que la foto esté decodificada: el
//      revelado no se adelanta a lo que tiene que enseñar.
//   4. REVELAR: la ficha se recoge como una persiana y debajo está la foto del
//      primer intento, con la escala y la lectura de aumento del juego. Cae el
//      sello «Tu coche» (o «Modo Veterano», en oro) con su golpe, y al rato el
//      padre navega a /repesca — donde la misma foto está en el mismo marco.
//
// LA FOTO NO ENSEÑA DE MÁS. /api/repesca/image (phase=playing) sirve el recorte
// del ÚLTIMO intento; el juego cierra el primero con una escala CSS. Aquí se
// aplica la misma (`cssZoomLevels`), y en el Veterano la del último intento,
// que es la que ve en su partida (regla 5: ni un píxel más que el jugador
// legítimo).
//
// Con «menos movimiento» no hay carrete ni mordisco: el visor abre, espera y la
// ficha se funde con la foto. El velo es oscuro en los dos temas, así que el
// color de la escena es fijo (claro sobre grafito), como en el juego de noche.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { menosMovimiento } from "../lib/movimiento";
import { MS_HASTA_IMPACTO_SELLO } from "../lib/veredicto";
import { FICHAS, GIRO_MS, curvaGiroCss, ticsCarrete, patronTrinquete } from "../lib/sorteo";
import { cssZoomLevels, zoomForAttempt, ZOOM_ATTEMPTS, DEFAULT_ZOOM_BASE } from "../lib/zoom";
import { Icon, I } from "./configurator/icons";

// Lo que tarda el visor en abrirse antes de que arranque el carrete.
const APERTURA_MS = 260;
// El mordisco de las esquinas (var(--ms-sello) en el CSS, con margen).
const MORDISCO_MS = 300;
// Tope de espera de la foto una vez elegido el coche: si no llega, se revela
// igual (sin persiana) y /repesca la cargará por su cuenta.
const ESPERA_FOTO_MS = 2500;
// Del revelado al sello, y del revelado al aviso de «ya está» para el padre:
// lo justo para leer el sello y la frase, no una pausa de relleno.
const SELLO_MS = 220;
const FIN_MS = 1250;

export default function RepescaDrawAnimation({
  // El servidor ya eligió (hay carId). Hasta entonces el sorteo enfoca y espera.
  confirmado = false,
  veteran = false,
  // URL (objeto) de la foto del primer intento, ya descargada por el padre.
  foto = null,
  zoomBase = DEFAULT_ZOOM_BASE,
  pendientes = 0,
  // Se llama UNA vez, cuando el sorteo ha terminado de enseñarse.
  onFin,
}) {
  const { t, tn, locale } = useT();
  const quieto = useRef(menosMovimiento()).current;
  const [fase, setFase] = useState("abrir"); // abrir → girar → enfocar → revelado → sello
  const [giroHecho, setGiroHecho] = useState(false);
  const [fotoLista, setFotoLista] = useState(false);
  const [sinFoto, setSinFoto] = useState(false);
  const onFinRef = useRef(onFin);
  onFinRef.current = onFin;

  // 1-3: abrir, girar (con su trinquete) y enfocar.
  useEffect(() => {
    const relojes = [];
    const luego = (ms, fn) => relojes.push(setTimeout(fn, ms));
    if (quieto) {
      luego(APERTURA_MS, () => {
        setFase("enfocar");
        setGiroHecho(true);
      });
    } else {
      luego(APERTURA_MS, () => setFase("girar"));
      const tics = ticsCarrete();
      if (tics.length) luego(APERTURA_MS + tics[0], () => haptic.trinquete(patronTrinquete(tics)));
      luego(APERTURA_MS + GIRO_MS, () => {
        haptic.impactMedium();
        setFase("enfocar");
      });
      luego(APERTURA_MS + GIRO_MS + MORDISCO_MS, () => setGiroHecho(true));
    }
    return () => relojes.forEach(clearTimeout);
  }, [quieto]);

  // La foto, decodificada ANTES de revelarla: una persiana que se recoge sobre
  // un hueco gris es peor que esperar un instante con el visor enfocando.
  useEffect(() => {
    if (!foto) return undefined;
    let vivo = true;
    const img = new Image();
    img.src = foto;
    (img.decode ? img.decode() : Promise.resolve())
      .then(() => vivo && setFotoLista(true))
      .catch(() => vivo && setSinFoto(true));
    return () => {
      vivo = false;
    };
  }, [foto]);

  // Si la foto se atasca, no se espera para siempre.
  useEffect(() => {
    if (!giroHecho || !confirmado || fotoLista || sinFoto) return undefined;
    const r = setTimeout(() => setSinFoto(true), ESPERA_FOTO_MS);
    return () => clearTimeout(r);
  }, [giroHecho, confirmado, fotoLista, sinFoto]);

  // 4: revelar, sellar y avisar.
  const listo = giroHecho && confirmado && (fotoLista || sinFoto);
  useEffect(() => {
    if (!listo) return undefined;
    setFase("revelado");
    const relojes = [
      setTimeout(() => setFase("sello"), SELLO_MS),
      // El golpe suena cuando el sello TOCA, no cuando empieza a caer.
      setTimeout(() => haptic.impactHeavy(), SELLO_MS + MS_HASTA_IMPACTO_SELLO),
      setTimeout(() => onFinRef.current?.(), FIN_MS),
    ];
    return () => relojes.forEach(clearTimeout);
  }, [listo]);

  const revelado = fase === "revelado" || fase === "sello";
  const conFoto = Boolean(foto) && fotoLista && !sinFoto;
  const zooms = cssZoomLevels(zoomBase);
  const escala = veteran ? zooms[zooms.length - 1] : zooms[0];
  const lectura =
    zoomForAttempt(veteran ? ZOOM_ATTEMPTS : 1, zoomBase).toLocaleString(
      locale === "en" ? "en-US" : "es-ES",
      { minimumFractionDigits: 1, maximumFractionDigits: 1 }
    ) + "×";

  return (
    <motion.div
      className="sorteo fixed inset-0 z-dialogo-sobre"
      data-fase={fase}
      data-modo={veteran ? "veterano" : "normal"}
      data-foto={conFoto ? "si" : "no"}
      data-quieto={quieto ? "si" : undefined}
      style={{ "--giro-ms": `${GIRO_MS}ms`, "--giro-curva": curvaGiroCss() }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={t("garage.drawAria")}
    >
      <div className="sorteo-columna">
        <div className="sorteo-cab">
          <span className="sorteo-kicker">
            {veteran ? t("garage.sorteoKickerVet") : t("garage.sorteoKicker")}
          </span>
          {pendientes > 0 && (
            <span className="sorteo-pendientes">{tn("garage.pendientes", pendientes)}</span>
          )}
        </div>

        <div className="sorteo-visor">
          {foto && !sinFoto && (
            <div className="sorteo-foto">
              <img
                src={foto}
                alt={revelado ? t("garage.sorteoFotoAlt") : ""}
                draggable={false}
                style={{ transform: `scale(${escala})` }}
              />
            </div>
          )}

          <div className="sorteo-carrete" aria-hidden="true">
            {Array.from({ length: FICHAS }, (_, i) => (
              <div
                key={i}
                className={"sorteo-ficha" + (i % 2 ? " b" : "") + (i === FICHAS - 1 ? " ultima" : "")}
              >
                <span className="rayas">
                  <i />
                  <i />
                </span>
                <Icon d={I.candado} size={26} />
                <span className="num">Nº ?</span>
              </div>
            ))}
          </div>

          <span className="sorteo-marca izq" aria-hidden="true" />
          <span className="sorteo-marca der" aria-hidden="true" />
          <span className="sorteo-aro" aria-hidden="true" />
          <span className="sorteo-esq ai" aria-hidden="true" />
          <span className="sorteo-esq ad" aria-hidden="true" />
          <span className="sorteo-esq bi" aria-hidden="true" />
          <span className="sorteo-esq bd" aria-hidden="true" />

          <span className="sorteo-lente" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M20 20l-4.2-4.2M8.5 11h5" />
            </svg>
            {conFoto && revelado ? lectura : "—"}
          </span>

          {fase === "sello" && (
            <span className="sorteo-sello" aria-hidden="true">
              {veteran && <Icon d={I.galones} size={16} strokeWidth="2.2" />}
              {veteran ? t("garage.drawVeteran") : t("garage.drawYours")}
            </span>
          )}
        </div>

        <div className="sorteo-texto" aria-live="polite">
          {revelado ? (
            <div className="sorteo-revelado">
              <b>{veteran ? t("garage.sorteoTituloVet") : t("garage.sorteoTitulo")}</b>
              <span>{veteran ? t("garage.sorteoBajadaVet") : t("garage.sorteoBajada")}</span>
            </div>
          ) : (
            <p key={fase === "enfocar" ? "enfocar" : "barajar"} className="sorteo-estado">
              {fase === "enfocar"
                ? t("garage.sorteoEnfocando")
                : pendientes > 0
                ? tn("garage.drawBarajando", pendientes)
                : t("garage.drawShuffling")}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
