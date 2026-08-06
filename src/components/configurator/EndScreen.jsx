// src/components/configurator/EndScreen.jsx
// EL CIERRE DE LA EDICIÓN: una sola columna, en orden de lectura, SIN PESTAÑAS.
//
// Tuvo dos (COMPARTIR / FICHA) y fallaban por dos motivos. El de fondo: el
// contenido no era paralelo. «Compartir» era tu resultado + la acción; «Ficha»
// era la historia del coche + el mundo. Una barra de pestañas promete «dos vistas
// de lo mismo» y aquí escondía la mitad del premio detrás de una elección, justo
// en el pico de dopamina de la partida. El otro: un segmentado es vocabulario de
// app, y este es un periódico — un periódico no te hace elegir entre el titular y
// el artículo, los apila y deja que el pliegue priorice.
//
// El orden ES la jerarquía: revelado → el pie de tu partida (una línea) →
// COMPARTIR → lo que ganaste → la crónica → el parte → el mundo → el reloj. Lo
// que hay por encima del pliegue es tu resultado y la acción; lo de abajo es para
// quien quiera quedarse.
//
// REGLA DE ATENCIÓN: en esta pantalla solo UNA cosa lleva relleno saturado, y es
// COMPARTIR (rojo de rotativa, el color de acción del juego). Todo lo demás es
// tipografía y filete. Antes competían cuatro elementos por delante del botón —
// tres ✅ emoji dibujados por el sistema operativo, el sello, la caja de oro de la
// portada y el marco de doble filete del parte—, así que el CTA era el quinto
// objeto más llamativo de una pantalla que solo tiene un trabajo.
//
// La copia usa el texto de compartir de producción; las piezas críticas
// (compartir nativo/clipboard, CTA de registro para anónimos) se conservan.

import { useEffect, useRef, useState } from "react";
import { useCountdown } from "../../hooks/useCountdown";
import { useEscape } from "../../hooks/useEscape";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useHistoryClose } from "../../hooks/useHistoryClose";
import { useT, getCarDescription, getLocalizedCountry } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { esApp } from "../../lib/plataforma";
import { track } from "../../lib/analytics";
import { flagImagePath } from "../../data/countries";
import { apiUrl } from "../../lib/apiUrl";
import { useToast } from "../Toast";
import { Icon, I } from "./icons";
// `Percentile` se retiró de dailyStats: era una caja con el porcentaje y ahora ese
// dato viaja como el remate del pie de la partida, en una línea.
import { useDailyStats, Distribution } from "./dailyStats";
// Opt-in de recordatorio (web push / notif nativa). Vive aquí, en la pestaña
// COMPARTIR (la de por defecto al ganar), que es el pico de engagement tras la
// partida diaria — su pantalla viva es ESTA.
import NotificationOptIn from "../NotificationOptIn";
import RankParte from "./RankParte";
// (Aquí se importaba `shareGrid` para pintar la rejilla ✅/❌ EN PANTALLA. Esa
// función existe para el TEXTO que se copia a WhatsApp, donde el emoji es el
// idioma de Wordle y lo dibuja la app destino — por eso `shareText.js` tiene su
// excepción razonada en check-estetica. Usarla también para pintar metía esa
// excepción DENTRO de nuestro lienzo: tres cuadros verdes dibujados por el
// sistema operativo, a su tamaño y con su color, los píxeles más saturados de la
// web, justo al lado del botón al que tenía que irse el ojo.
// En pantalla el resultado lo cuentan los pips de negativo del pie de foto, que
// es vocabulario que la app ya habla; el emoji se queda en el portapapeles. El
// jugador tampoco pierde la rejilla: sus intentos siguen en el historial, igual
// que en Wordle el tablero ES la rejilla.)

function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// EL PIE DE TU PARTIDA: una sola línea, en la voz de los pies de foto.
// Sustituye a tres elementos que decían lo mismo por separado —la etiqueta «TU
// PARTIDA», la caja con la rejilla de emoji y la frase del percentil— más el
// «ACERTADO · 1/5» que iba estampado sobre la fotografía y era redundante con el
// sello RESUELTO de la esquina. Un renglón: qué hiciste, en cuántos, y cómo te
// deja eso frente al resto.
// Exportado porque la Repesca monta su propio panel de fin con las mismas clases
// `cdd-end`, y tenía su propia copia de estas piezas (la píldora del veredicto
// sobre la foto y la rejilla de emoji). Dos paneles con el mismo trabajo deben
// usar el mismo objeto: es la razón por la que el marcador de puesto también es
// un solo componente en las cinco superficies donde aparece.
export function PiePartida({ won, attempts, max, pct = 0 }) {
  const { t } = useT();
  return (
    <div className="cdd-partida">
      <span className="cdd-partida-txt">
        {won ? t("cdd.pieSolved", { n: attempts, max }) : t("cdd.pieUnsolved", { max })}
      </span>
      {/* Los pips del pie de foto: un cuadradito por intento, gastados en tinta y
          el que acertó en verde. Mismo objeto que la tira del escenario. */}
      <span className="prensa-pips" aria-hidden="true">
        {Array.from({ length: max }).map((_, i) => (
          <i
            key={i}
            className={
              "pip" +
              (i < attempts ? " gastado" : "") +
              (won && i === attempts - 1 ? " acierto" : "")
            }
          />
        ))}
      </span>
      {pct > 0 && (
        <span className="cdd-partida-pct">{t("dailyStats.betterThanShare", { pct })}</span>
      )}
    </div>
  );
}

export default function EndScreen({
  won,
  car,
  guesses,
  max,
  streak,
  shareText,
  user,
  rank,
  necesitaNick = false,
  onOpenNickname,
  onClose,
  onOpenLogin,
  onOpenGarage,
  onOpenRanking,
}) {
  const { t, tn } = useT();
  const toast = useToast();
  const countdown = useCountdown();
  const [copied, setCopied] = useState(false);
  // (Aquí vivía `tab`. Ya no hay pestañas: la columna es única y el orden de
  // lectura hace de jerarquía. Ver la cabecera del archivo.)
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // El EndScreen es un modal a medida: aquí le damos el mismo comportamiento
  // que al resto (Escape cierra, se bloquea el scroll del fondo) y, sobre todo,
  // que la "atrás" del móvil lo CIERRE en vez de sacar de la web. Como solo se
  // monta cuando está visible, el "active" de los tres es constante (true).
  useScrollLock(true);
  useEscape(true, onClose);
  useHistoryClose(true, onClose);

  const hasReveal = Boolean(car?.marca && car?.modelo && car?.anio);
  const attempts = guesses.length;
  const description = getCarDescription(car)?.trim();
  // Datos reales del día (un solo fetch): alimenta el percentil (COMPARTIR) y
  // la distribución de intentos (FICHA).
  const daily = useDailyStats(attempts, won);
  // Percentil: solo se enseña si hay dato y ventaja real (el hook lo deja en 0
  // para quien pierde o cuando aún no hay partidas suficientes).
  const pct = daily.ready && won ? daily.betterThanPct : 0;

  async function copyShare() {
    haptic.impactLight();
    try {
      const finalShareText = shareText;

      if (navigator.share) {
        await navigator.share({ text: finalShareText });
        // Solo resuelve si se completó (cancelar → AbortError al catch): el
        // evento cuenta comparticiones REALES, la métrica de viralidad.
        track("share", { method: "native", where: "end_screen", result: won ? "win" : "lose" });
        return;
      }
      let ok = false;
      let method = "legacy";
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(finalShareText);
        ok = true;
        method = "clipboard";
      } else {
        ok = legacyCopy(finalShareText);
      }
      if (ok) {
        haptic.success();
        setCopied(true);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1800);
        toast.push(t("result.shareCopied"), { type: "success" });
        track("share", { method, where: "end_screen", result: won ? "win" : "lose" });
      } else {
        // En la app no hay «navegador» al que echarle la culpa: el mensaje web
        // señala al Chrome del usuario, y dentro del APK eso solo confunde.
        toast.push(
          esApp() ? t("result.shareUnsupportedApp") : t("result.shareUnsupported"),
          { type: "error" }
        );
      }
    } catch (err) {
      if (err?.name === "AbortError") return;
      haptic.error();
      toast.push(t("result.shareError"), { type: "error" });
    }
  }

  return (
    <div className="cdd-end" role="dialog" aria-modal="true">
      <div className="cdd-end-scrim" onClick={onClose} />
      <div className="cdd-end-card">
        {/* Cerrar SIEMPRE a la vista: botón fijo (sticky) arriba a la IZQUIERDA
            —la derecha la ocupa el sello del veredicto— con área táctil de 44px.
            Antes el único cierre era un enlace diminuto al final del panel, que
            obligaba a scrollear hasta abajo para salir. La barra sticky es de
            alto 0 (no empuja la banda de revelado); el botón flota sobre ella y
            se queda a la vista aunque el cuerpo del panel scrollee. */}
        <div className="cdd-end-topbar">
          <button
            type="button"
            className="cdd-end-close"
            aria-label={t("cdd.seeGame")}
            onClick={() => { haptic.impactLight(); onClose?.(); }}
          >
            <Icon d={I.x} size={20} />
          </button>
        </div>

        {/* (Confetti retirado: en el lenguaje prensa la celebración es el
            SELLO estampándose — spec §2 del rediseño.) */}

        {/* Banda de revelado con el sello del veredicto */}
        <div className="cdd-reveal">
          <div className={"prensa-sello" + (won ? "" : " tinta")} aria-hidden="true">
            {won ? t("prensa.selloWin") : t("prensa.selloLose")}
          </div>
          {car?.img && (
            <img
              // apiUrl(): `car.img` es la ruta RELATIVA del proxy
              // (/api/daily-image?…). En la app el WebView sirve desde
              // https://localhost, donde esa ruta no existe → la foto del
              // revelado salía rota justo en el momento del premio. El <img>
              // no pasa por el shim de fetch, así que hay que absolutizar a
              // mano, igual que hacen CarImage y PhotoPeek.
              src={apiUrl(car.img)}
              alt=""
              draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          <div className="cdd-reveal-grad" />
          <div className="cdd-reveal-head">
            {/* (Aquí iba `.cdd-verdict`: «ACERTADO · 1/5» sobre la fotografía. Lo
                decía ya el sello RESUELTO de la esquina, y el recuento de
                intentos lo dice mejor el pie de la partida, justo debajo, donde
                además puede acompañarse del percentil. Sobre la foto quedaba una
                tercera etiqueta pisando la carrocería.) */}
            {hasReveal ? (
              <>
                <div className="cdd-reveal-name">
                  <span className="cdd-reveal-brand">{car.marca}</span>
                  <span className="cdd-reveal-model">{car.modelo}</span>
                </div>
                <div className="cdd-reveal-meta cdd-mono">
                  {car.pais && <img className="cdd-flag" src={flagImagePath(car.pais)} alt="" />}
                  {car.pais ? getLocalizedCountry(car.pais) : ""} · {car.anio}
                </div>
              </>
            ) : (
              <div className="cdd-reveal-meta cdd-mono">{t("cdd.revealUnavailable")}</div>
            )}
          </div>
        </div>

        {/* EL PIE DE TU PARTIDA: el renglón que resume el resultado. Va pegado a
            la fotografía porque es su pie, y por encima del CTA porque es lo que
            le da sentido a compartir. */}
        <PiePartida won={won} attempts={attempts} max={max} pct={pct} />

        <div className="cdd-end-body">
          {/* EL CTA. Único relleno saturado de la pantalla: rojo de rotativa, el
              mismo color de acción que ADIVINAR. Antes era un bloque de tinta que
              competía con tres emoji verdes, una caja de oro y un marco doble. */}
          <button className="cdd-submit cdd-share-btn" onClick={copyShare}>
            <Icon d={I.share} size={17} /> <span>{copied ? t("cdd.copied") : t("cdd.copyResult")}</span>
          </button>

          {/* Desbloqueo de cromo: cierra el bucle juego→colección JUSTO en el
              pico de dopamina (ganar). Antes el desbloqueo ocurría en silencio
              en el servidor y nada en la victoria apuntaba al garaje — la
              colección era un huérfano. Solo logueado (el anónimo no persiste
              colección; a ese ya le habla el CTA de "guardar progreso").
              DELIBERADAMENTE subordinado a COMPARTIR, y desde este rediseño de
              verdad: es UN RENGLÓN con su chevrón, por DEBAJO del botón. Era una
              caja de oro por encima, o sea lo primero que veía el ojo al salir de
              la foto — el objeto que más gritaba de la pantalla para la acción
              menos importante. Tappable → abre el archivo (+ evento para medir si
              el bucle realmente tira). */}
          {won && user && hasReveal && (
            <button
              type="button"
              className="cdd-unlock"
              aria-label={t("cdd.garageAria")}
              onClick={() => { haptic.impactLight(); track("garage_from_endscreen"); onOpenGarage?.(); }}
            >
              <span className="cdd-unlock-kicker">{t("cdd.unlockKicker")}</span>
              <span className="cdd-unlock-name">{car.modelo}</span>
              <Icon d={I.chevR} size={15} className="cdd-unlock-chev" />
            </button>
          )}

          {/* CTA de registro para CUALQUIER anónimo que termina, gane o
              pierda. Antes solo se ofrecía al que ganaba, porque al que perdía
              ya se le empujaba a la cuenta con un muro ("inicia sesión para
              ver la respuesta"). Retirado el muro, la invitación se hace aquí
              y en su forma sana: el jugador ya tiene su coche revelado y lo
              que se le ofrece es CONSERVAR lo jugado, no comprar el desenlace.
              Estilo SECUNDARIO (ghost): es otra clase de acción y no debe
              competir con compartir. */}
          {/* Sin cuenta. Si ya lleva racha —la sesión anónima se la guarda de
              verdad desde su primer intento—, se la nombramos: «no pierdas tu
              racha de 5 días» pesa lo que no pesa «guarda tu progreso», porque
              habla de algo que el jugador YA tiene y puede perder. Con racha 0
              o 1 no hay nada que presumir y se queda el genérico. */}
          {!user && (
            <button className="cdd-submit cdd-submit--ghost" onClick={onOpenLogin}>
              <span>
                {streak > 1
                  ? tn("result.saveStreakCta", streak)
                  : t("result.saveProgressCta")}
              </span>
            </button>
          )}

          {/* Logueado, ha GANADO y aún no tiene firma: su resultado de hoy
              puntúa pero no sale en la tabla. Este es el único momento en que
              elegir nick tiene una consecuencia inmediata y visible, así que
              es aquí donde se pide — no en un modal obligatorio al registrarse.
              Solo en victoria: al que acaba de perder, ofrecerle entrar en una
              clasificación es sordera. Mismo estilo ghost que el CTA anónimo:
              compartir sigue siendo el único bloque relleno de la pantalla. */}
          {won && user && necesitaNick && (
            <button className="cdd-submit cdd-submit--ghost" onClick={onOpenNickname}>
              <span>{t("result.pickNickCta")}</span>
            </button>
          )}

          {/* Recordatorio diario: se ofrece UNA vez (persiste la decisión).
            En web pide Web Push; en nativo, notif local; en iOS-no-instalado,
            el hint de "añadir a inicio". Devuelve null si ya se preguntó o no
            hay soporte, así que no molesta en cada apertura del EndScreen. */}
          <NotificationOptIn />
        </div>

        {/* ── DEBAJO DEL PLIEGUE: para quien quiera quedarse ──────────────────
            Esto era la pestaña FICHA. Ahora son secciones del pliego, cada una
            con su ladillo, en el orden en que se leerían en papel: la crónica del
            coche, el parte de la clasificación y el mundo. Nadie tiene que elegir
            entre esto y compartir; basta con bajar (o no bajar). */}
        {hasReveal && description && (
          <section className="cdd-end-sec">
            <div className="prensa-ladillo">{t("cdd.ladilloCronica")}</div>
            <p className="cdd-note">{description}</p>
            {/* Origen y año como UN renglón de datos, no dos fichas en rejilla:
                son dos palabras y ocupaban media pantalla en cajas. */}
            <p className="cdd-ficha-datos">
              {car.pais && (
                <>
                  <span className="k">{t("cdd.labelOrigin")}</span> {getLocalizedCountry(car.pais)}
                  {" · "}
                </>
              )}
              <span className="k">{t("cdd.labelAnio")}</span> {car.anio}
            </p>
          </section>
        )}

        {/* El parte de la clasificación: puesto + movimiento vs ayer (palanca de
            retorno). Ya no es la única "caja" de la pantalla: es una sección más,
            con su ladillo, como la crónica y el mundo. */}
        <RankParte rank={rank} user={user} onOpenRanking={onOpenRanking} />

        {daily.ready && (
          <section className="cdd-end-sec">
            {/* El ladillo lo pone el llamante: `Distribution` ya no trae título
                propio, porque donde la monta el Configurator convivían dos
                encabezados seguidos («La estadística del día» + «Hoy en el
                mundo») diciendo lo mismo. */}
            <div className="prensa-ladillo">{t("dailyStats.title")}</div>
            <Distribution data={daily} attempts={attempts} won={won} />
          </section>
        )}

        {/* Cuenta atrás: el cierre de edición, la última línea del pliego. */}
        <div className="cdd-next">
          <div className="cdd-mono cdd-next-k">{t("cdd.nextCar")}</div>
          <div className="cdd-next-clock cdd-mono">{countdown.formatted}</div>
        </div>

        {/* Cerrar el revelado y volver a la partida: enlace discreto (Compartir
            sigue siendo el único CTA primario de la pantalla). */}
        <div className="cdd-end-links">
          <button type="button" className="cdd-end-link cdd-mono" onClick={onClose}>
            {t("cdd.seeGame")}
          </button>
        </div>
      </div>
    </div>
  );
}
