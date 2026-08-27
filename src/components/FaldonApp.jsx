// src/components/FaldonApp.jsx
// EL FALDÓN DEL FINAL DE PARTIDA. Único sitio de la web donde se ofrece la app.
//
// DÓNDE: al final del pliego del resultado, justo DEBAJO de la cuenta atrás.
// El renglón de encima acaba de decir "próximo coche en 07:41:12", o sea
// "vuelve mañana": es el único momento de la web en que ofrecer un icono en la
// pantalla de inicio es la consecuencia de lo que estás leyendo y no un anuncio
// interrumpiendo. Por eso no está en la cabecera (taparía la fotografía, que es
// el juego) ni en un modal de bienvenida (se lo comería quien aún no ha jugado).
//
// DOS CARAS, Y EL ORDEN NO ES NEGOCIABLE. La sesión anónima vive en el
// localStorage del navegador; el WebView de la app sirve desde
// `https://localhost`, en el sandbox de la aplicación. La racha NO VIAJA. A un
// anónimo con nueve días a la espalda, «instálate la app» es «empieza de cero»
// sin decírselo. Así que:
//
//   - SIN CUENTA → se le pide cuenta, y con el argumento verdadero: lo que
//     tiene y puede perder. Es, de paso, el mejor motivo para registrarse que
//     hay en toda la web — mucho mejor que «guarda tus estadísticas en la
//     nube», que no le urge a nadie.
//   - CON CUENTA → la oferta de Play de siempre.
//
// Al registrarse desde aquí, `user` aparece y este mismo bloque cambia de cara:
// la cadena se cierra sola, sin mandar al jugador a ninguna otra pantalla.
//
// A QUIÉN: `momentoDeFaldon()` — Android en navegador, sin tenerla ya instalada
// y con tres días jugados. El razonamiento de cada condición está en
// lib/edicionApp.js. Los descartes son DOS, uno por cara: rechazar el registro
// no puede enterrar una oferta de Play que todavía no se ha hecho.
//
// FORMA: el mismo recuadro de "suscripción al boletín" que NotificationOptIn
// (filete de tinta, kicker rojo, cuerpo en Fraunces). Deliberadamente NO parece
// una tarjeta de tienda de aplicaciones: ni icono de la app, ni estrellas, ni
// captura. En este lenguaje una edición nueva se anuncia con tipografía.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";
import { track } from "../lib/analytics";
import {
  momentoDeFaldon,
  faldonDescartado,
  faldonRegistroDescartado,
  marcarFaldonDescartado,
  marcarFaldonRegistroDescartado,
  urlPlay,
} from "../lib/edicionApp";

const SURFACE = "faldon_final";

export default function FaldonApp({ user = null, streak = 0, onOpenLogin }) {
  const { t, tn } = useT();

  // La puerta común (sitio y hábito), en el PRIMER render y síncrona: igual que
  // NotificationOptIn, para que no aparezca un bloque a mitad de lectura.
  const [enMomento] = useState(momentoDeFaldon);
  // Los dos descartes se leen una vez y viven en estado para que pulsar «ahora
  // no» se note al instante sin volver a tocar localStorage.
  const [descartes, setDescartes] = useState(() => ({
    registro: faldonRegistroDescartado(),
    play: faldonDescartado(),
  }));

  const pideCuenta = !user;
  const visible = enMomento && (pideCuenta ? !descartes.registro : !descartes.play);

  // Denominador del embudo: impresiones → clics. Se re-emite si cambia la cara
  // porque son dos ofertas distintas con dos tasas distintas — quien se
  // registra aquí y ve entonces la de Play ha visto DOS cosas, no una.
  useEffect(() => {
    if (visible) track("app_promo_shown", { surface: SURFACE, auth: pideCuenta ? "anon" : "user" });
  }, [visible, pideCuenta]);

  if (!visible) return null;

  function irAPlay() {
    haptic.impactLight();
    track("app_promo_click", { surface: SURFACE });
    // No marcamos descarte: si vuelve sin instalar, el faldón sigue ahí. Lo que
    // cierra el faldón para siempre es un "no", no un "sí" a medias.
    window.open(urlPlay(SURFACE), "_blank", "noopener,noreferrer");
  }

  function crearCuenta() {
    haptic.impactLight();
    // Tampoco marca descarte, y por el mismo motivo: abrir la puerta de entrada
    // no es haber entrado.
    onOpenLogin?.("faldon");
  }

  function descartar() {
    haptic.impactLight();
    track("app_promo_dismiss", { surface: SURFACE, auth: pideCuenta ? "anon" : "user" });
    if (pideCuenta) {
      marcarFaldonRegistroDescartado();
      setDescartes((d) => ({ ...d, registro: true }));
    } else {
      marcarFaldonDescartado();
      setDescartes((d) => ({ ...d, play: true }));
    }
  }

  return (
    <div className="mb-4 border border-tinta p-4 text-left">
      <p className="pm-kicker">
        {pideCuenta ? t("app.promoAccountTitle") : t("app.promoTitle")}
      </p>
      <p className="pm-body mt-2 text-sm">
        {pideCuenta
          ? // Con racha, se la nombramos: «tu racha de 9 días» pesa lo que no
            // pesa «tu progreso», porque habla de algo concreto que YA tiene.
            // Con 0 o 1 no hay nada que presumir y va el genérico — el mismo
            // criterio que el CTA de registro del EndScreen.
            streak > 1
            ? tn("app.promoAccountBody", streak, { count: streak })
            : t("app.promoAccountBodyPlain")
          : t("app.promoBody")}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={pideCuenta ? crearCuenta : irAPlay}
          className="pm-btn flex-1 !py-2.5 !text-xs"
        >
          {pideCuenta ? t("app.promoAccountCta") : t("app.promoCta")}
        </button>
        <button
          type="button"
          onClick={descartar}
          className="pm-btn pm-btn--ghost !w-auto !py-2.5 !text-xs"
        >
          {pideCuenta ? t("app.promoAccountDecline") : t("app.promoDecline")}
        </button>
      </div>
    </div>
  );
}
