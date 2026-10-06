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
import { menosMovimiento } from "../../lib/movimiento";
import { useCountdown } from "../../hooks/useCountdown";
import { useEscape } from "../../hooks/useEscape";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useHistoryClose } from "../../hooks/useHistoryClose";
import { useSelloSentido } from "../../hooks/useSelloSentido";
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
import FaldonApp from "../FaldonApp";
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

// ── LAS PIEZAS DEL PANEL «ASFALTO» ───────────────────────────────────────────
// El panel se compone de tarjetas, en el orden del diseño: la foto con su
// chapa, el coche, lo que hiciste (el marcador si ganas, tu partida si no),
// compartir y el reloj, y debajo lo que se lee si te quedas (la racha, la
// repesca, la clasificación, el mundo y la ficha).

// La cifra que sube de 0 a su valor al abrirse el panel. Con movimiento
// reducido salta directamente: el número es el dato, la subida es adorno.
function useCuenta(objetivo, ms = 700) {
  const [valor, setValor] = useState(() => (menosMovimiento() ? objetivo : 0));
  useEffect(() => {
    if (!objetivo || menosMovimiento()) { setValor(objetivo || 0); return undefined; }
    let raf;
    const inicio = performance.now();
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / ms);
      setValor(Math.round(objetivo * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [objetivo, ms]);
  return valor;
}

// La rejilla de la partida: tres cuadros por intento (marca, modelo, año) en
// el color de su veredicto. Es la misma rejilla que viaja en el texto de
// compartir, pero dibujada por nosotros, no con emoji del sistema.
function cuadro(status) {
  return status === "correct" ? "bien" : status === "partial" ? "cerca" : "mal";
}
function Rejilla({ guesses }) {
  return (
    <span className="fin-rejilla" aria-hidden="true">
      {guesses.map((g, i) => (
        <span key={i} className="fila">
          <i className={cuadro(g.marca?.status)} />
          <i className={cuadro(g.modelo?.status)} />
          <i className={cuadro(g.anio?.status)} />
        </span>
      ))}
    </span>
  );
}

// Lo que se puede decir de una partida perdida mirando qué campos llegaron a
// acertarse. Una frase, sin consuelo impostado: qué faltó.
function lecturaDerrota(guesses, car, t) {
  const tuvo = (campo) => guesses.some((g) => g[campo]?.status === "correct");
  const marca = tuvo("marca"), modelo = tuvo("modelo"), anio = tuvo("anio");
  if (!car?.modelo) return null;
  if (marca && anio && !modelo) return t("fin.faltoModelo", { modelo: car.modelo });
  if (marca && modelo && !anio) return t("fin.faltoAnio", { anio: car.anio });
  if (marca && !modelo && !anio) return t("fin.soloMarca");
  if (!marca) return t("fin.nada");
  return null;
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
  repescaAlert = false,
  necesitaNick = false,
  onOpenNickname,
  onClose,
  onOpenLogin,
  onOpenGarage,
  onOpenRanking,
  // true solo cuando el panel se abre SOLO al terminar la partida: entonces el
  // sello, al caer, hace sentir el acierto o la derrota (useSelloSentido).
  sentirSello = false,
  // La puntuación que devolvió el servidor al cerrar la partida (base, bonus de
  // racha, racha actual y mejor racha). Solo existe en la sesión en que se
  // terminó: al reabrir tras recargar, el marcador enseña lo que sabe.
  score = null,
  // La racha que había ANTES de esta partida. Al perder, `streak` ya vale 0 y
  // sin esto no se podría decir qué racha se acaba de cortar.
  rachaPrevia = 0,
}) {
  const { t, tn } = useT();
  const toast = useToast();
  const countdown = useCountdown();
  const [copied, setCopied] = useState(false);
  const alEstamparSello = useSelloSentido({ won, activo: sentirSello });

  // ── EL VÍDEO DEL COCHE (temporadas presentadas) ───────────────────────────
  // Llega en el `reveal`, o sea solo con la partida cerrada (regla 5: antes de
  // eso el ID de YouTube ES la respuesta). Sin vídeo, esta pantalla es la de
  // siempre y no se ejecuta nada de lo de abajo.
  //
  // FACHADA, NO EMBED DIRECTO. Un iframe de YouTube montado de entrada son ~1 MB
  // y cookies de terceros en el momento más importante de la partida, para todo
  // el mundo, lo vea o no. Así que de entrada se queda la MISMA fotografía que
  // ya había —que además es la portada correcta, y la única que podemos usar:
  // la miniatura de YouTube lleva el ID en la URL— con un sello de reproducir
  // encima. El iframe se monta al tocarlo, y ni un byte antes.
  //
  // `youtube-nocookie.com`: el dominio sin cookies de seguimiento hasta que hay
  // reproducción. No convierte esto en privado —sigue siendo una petición a
  // Google— pero es el mínimo decente cuando el usuario no ha pedido el vídeo.
  const [videoAbierto, setVideoAbierto] = useState(false);
  const videoId = car?.videoId || null;
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

  // El foco entra al panel al abrirlo, que es la otra mitad de lo que promete
  // `aria-modal` (ver el comentario del contenedor, abajo). Va en un rAF por el
  // mismo motivo que en ModalShell: el panel tiene animación de entrada y el
  // nodo aún se está montando cuando corre el efecto.
  const cardRef = useRef(null);
  useEffect(() => {
    // `preventScroll`: el panel es el que scrollea, y enfocarlo no debe moverlo
    // ni un píxel — el revelado del coche tiene que verse desde arriba.
    const id = requestAnimationFrame(() =>
      cardRef.current?.focus({ preventScroll: true })
    );
    return () => cancelAnimationFrame(id);
  }, []);

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

  const puntos = useCuenta(score?.totalPoints ?? 0);
  const lectura = !won && hasReveal ? lecturaDerrota(guesses, car, t) : null;
  const mejorRacha = score?.maxStreak ?? null;
  // «No eres el único»: cuántos de cada diez tampoco lo sacaron hoy.
  const deCadaDiez =
    !won && daily.ready && daily.totalGames > 0
      ? Math.round((daily.losses / daily.totalGames) * 10)
      : 0;

  return (
    // `aria-modal="true"` promete que lo de fuera NO existe para un lector de
    // pantalla: por eso el panel lleva nombre y recibe el foco al abrirse.
    <div className="cdd-end" role="dialog" aria-modal="true" aria-label={t("cdd.endScreenAria")}>
      <div className="cdd-end-scrim" onClick={onClose} />
      <div className="cdd-end-card fin outline-none" ref={cardRef} tabIndex={-1}>
        {/* Cerrar SIEMPRE a la vista: barra sticky de alto 0 con la ✕ flotando
            arriba a la izquierda (la derecha es de la chapa del veredicto). */}
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

        {/* LA FOTO, ya entera, con la chapa del veredicto: «Resuelto en 3 de 5»
            en verde o «Sin resolver» en neutro. La chapa cae con su rebote y su
            golpe háptico (useSelloSentido). */}
        <div className={"fin-foto" + (videoAbierto ? " reproduciendo" : "")}>
          {car?.img && (
            // apiUrl(): `car.img` es la ruta RELATIVA del proxy; en la app el
            // WebView sirve desde https://localhost y hay que absolutizarla.
            <img src={apiUrl(car.img)} alt="" draggable={false} className="fin-foto-img" />
          )}
          <div className={"prensa-sello" + (won ? "" : " tinta")} aria-hidden="true" onAnimationStart={alEstamparSello}>
            {won ? (
              <>
                <Icon d={I.check} size={15} />
                {t("fin.resueltoEn", { n: attempts, max })}
              </>
            ) : (
              <>
                <Icon d={I.x} size={14} />
                {t("prensa.selloLose")}
              </>
            )}
          </div>
          {/* El vídeo del coche (temporadas presentadas): fachada con la misma
              foto y un botón; el iframe solo existe a partir del toque. */}
          {videoId && !videoAbierto && (
            <button
              type="button"
              className="cdd-reveal-play"
              aria-label={t("result.verVideo")}
              onClick={() => { haptic.impactLight(); setVideoAbierto(true); }}
            >
              <span className="marca">
                <Icon d={I.play} size={17} />
                {t("result.verVideo")}
              </span>
            </button>
          )}
          {videoAbierto && (
            <iframe
              className="cdd-reveal-video"
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`}
              title={t("result.videoTitulo")}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </div>

        {/* EL COCHE: quién era, en grande, y su ficha corta en chapas. */}
        <header className="fin-titulo fin-entra">
          <span className="fin-kicker">{won ? t("fin.kickerWin") : t("fin.kickerLose")}</span>
          {hasReveal ? (
            <>
              <h2 className="fin-coche">{car.marca} {car.modelo}</h2>
              <div className="fin-chapas">
                {car.pais && (
                  <span className="fin-chapa">
                    <img className="bandera" src={flagImagePath(car.pais)} alt="" />
                    {getLocalizedCountry(car.pais)}
                  </span>
                )}
                <span className="fin-chapa mono">{car.anio}</span>
              </div>
            </>
          ) : (
            <p className="fin-sin-ficha">{t("cdd.revealUnavailable")}</p>
          )}
        </header>

        {/* LO QUE HICISTE. Ganando, el marcador: los puntos del día, de dónde
            salen y la racha. Perdiendo, tu partida intento a intento y lo que
            faltó, en una frase. */}
        {won ? (
          <section className="fin-tarjeta fin-entra" aria-label={t("score.yourScore")}>
            <div className="fin-marcador">
              <div className="fin-marcador-cifra">
                <span className="fin-etiqueta">{t("fin.puntosHoy")}</span>
                {score ? (
                  <span className="fin-puntos">
                    {puntos}
                    <small>{t("score.points")}</small>
                  </span>
                ) : (
                  <span className="fin-puntos fin-puntos--sin">—</span>
                )}
              </div>
              <Rejilla guesses={guesses} />
            </div>
            {score && (
              <dl className="fin-desglose">
                <div>
                  <dt>{t("fin.base", { n: attempts })}</dt>
                  <dd>+{score.basePoints}</dd>
                </div>
                {score.streakBonus > 0 && (
                  <div>
                    <dt>{t("fin.bonusRacha")}</dt>
                    <dd className="oro">+{score.streakBonus}</dd>
                  </div>
                )}
              </dl>
            )}
            {streak > 0 && (
              <div className="fin-racha">
                <span className="fin-icono oro"><Icon d={I.flame} size={18} /></span>
                <span className="fin-fila-texto">
                  <b className="oro">{tn("fin.diasSeguidos", streak)}</b>
                  {mejorRacha ? <span>{t("fin.mejorRacha", { n: mejorRacha })}</span> : null}
                </span>
              </div>
            )}
          </section>
        ) : (
          <section className="fin-tarjeta fin-entra">
            <h3 className="fin-tarjeta-titulo">{t("fin.tuPartida")}</h3>
            <ol className="fin-partida">
              {guesses.map((g, i) => (
                <li key={i} style={{ animationDelay: `calc(var(--ms-hoja) + ${i} * var(--ms-paso) * 2)` }}>
                  <span className="cuadros" aria-hidden="true">
                    <i className={cuadro(g.marca?.status)} />
                    <i className={cuadro(g.modelo?.status)} />
                    <i className={cuadro(g.anio?.status)} />
                  </span>
                  <span className="texto">{[g.marca?.val, g.modelo?.val, g.anio?.val].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ol>
            {lectura && <p className="fin-lectura">{lectura}</p>}
          </section>
        )}

        {/* COMPARTIR y EL RELOJ: la acción y su respuesta («vuelve mañana»). */}
        <div className="fin-acciones fin-entra">
          <button className="cdd-submit cdd-share-btn" onClick={copyShare}>
            <Icon d={I.share} size={17} /> <span>{copied ? t("cdd.copied") : t("cdd.copyResult")}</span>
          </button>
          <div className="fin-reloj">
            <span className="fin-reloj-k">
              <Icon d={I.reloj} size={17} />
              {won ? t("result.nextCar") : t("fin.revancha")}
            </span>
            <span className="fin-reloj-cifra">{countdown.formatted}</span>
          </div>
        </div>

        <div className="fin-extra">
          {/* Nueva portada en el Archivo: un renglón, no una caja (es la acción
              menos importante y no debe competir con compartir). */}
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
          {/* Sin cuenta: conservar lo jugado (con la racha nombrada si la hay). */}
          {!user && (
            <button className="cdd-submit cdd-submit--ghost" onClick={() => onOpenLogin?.("endscreen")}>
              <span>
                {streak > 1 ? tn("result.saveStreakCta", streak) : t("result.saveProgressCta")}
              </span>
            </button>
          )}
          {/* Ganó, tiene cuenta y le falta firma: el único momento en que elegir
              nick tiene una consecuencia visible (salir en la tabla). */}
          {won && user && necesitaNick && (
            <button className="cdd-submit cdd-submit--ghost" onClick={onOpenNickname}>
              <span>{t("result.pickNickCta")}</span>
            </button>
          )}
          {/* Recordatorio diario: se ofrece UNA vez y devuelve null si ya se
              preguntó o no hay soporte. */}
          <NotificationOptIn />
        </div>

        {/* LA RACHA CORTADA, solo al perder y si había racha. Sin rojo: perder
            se cuenta, no se castiga. */}
        {!won && rachaPrevia > 0 && (
          <section className="fin-tarjeta fin-fila fin-entra">
            <span className="fin-icono"><Icon d={I.flame} size={19} /></span>
            <span className="fin-fila-texto">
              <b>{tn("fin.rachaCortada", rachaPrevia)}</b>
              {mejorRacha ? <span>{t("fin.mejorSigue", { n: mejorRacha })}</span> : null}
            </span>
            <span className="fin-salto mono" aria-hidden="true">
              <s>{rachaPrevia}</s>
              <Icon d={I.arrowR} size={13} />
              <b>0</b>
            </span>
          </section>
        )}

        {/* LA REPESCA. Al perder con cuenta, este coche se queda pendiente en el
            Archivo y vuelve en la repesca (en Modo Veterano). Al ganar, la
            tarjeta solo sale si hay una repesca esperando hoy. Ámbar: «hay algo
            disponible», nunca aviso. */}
        {((!won && user) || repescaAlert) && (
          <button
            type="button"
            className="fin-tarjeta fin-fila fin-repesca fin-entra"
            onClick={() => {
              haptic.impactLight();
              track("repesca_from_endscreen");
              onOpenGarage?.();
            }}
          >
            <span className="fin-icono ambar"><Icon d={I.shuffle} size={19} /></span>
            <span className="fin-fila-texto">
              <b>{!won && user ? t("fin.vuelveTitulo") : t("cdd.repescaKicker")}</b>
              <span>{!won && user ? t("fin.vuelveCuerpo") : t("cdd.repescaCta")}</span>
            </span>
            <Icon d={I.chevR} size={17} className="fin-chev" />
          </button>
        )}

        {/* El parte de la clasificación: cuánto subes o bajas, y a cuánto estás
            del de arriba. Toda la tarjeta lleva a la tabla. */}
        <RankParte rank={rank} user={user} onOpenRanking={onOpenRanking} />

        {/* HOY EN EL MUNDO: la distribución del día, con tu barra en tinta (la
            de ✕ si perdiste) y una frase que la lee. */}
        {daily.ready && (
          <section className="fin-tarjeta fin-entra">
            <div className="fin-tarjeta-cabeza">
              <h3 className="fin-tarjeta-titulo">{t("dailyStats.title")}</h3>
              <span>{t("dailyStats.gamesPlayed", { count: daily.totalGames })} · {t("dailyStats.winRate", { pct: daily.winRate })}</span>
            </div>
            <Distribution data={daily} attempts={attempts} won={won} sinPie />
            {won && pct > 0 && <p className="fin-pie">{t("dailyStats.betterThanShare", { pct })}</p>}
            {!won && deCadaDiez >= 1 && <p className="fin-pie">{t("fin.noEresElUnico", { n: deCadaDiez })}</p>}
          </section>
        )}

        {/* LA FICHA: la crónica del coche, que solo se revela al acertar. */}
        {won && hasReveal && description && (
          <section className="fin-tarjeta fin-entra">
            <h3 className="fin-tarjeta-titulo">{t("fin.ficha")}</h3>
            <p className="cdd-note">{description}</p>
          </section>
        )}

        {/* La edición Android: devuelve null salvo Android-en-navegador con días
            jugados. */}
        <FaldonApp user={user} streak={streak} onOpenLogin={onOpenLogin} />

        <div className="cdd-end-links">
          <button type="button" className="cdd-end-link" onClick={onClose}>
            {t("cdd.seeGame")}
          </button>
        </div>
      </div>
    </div>
  );
}
