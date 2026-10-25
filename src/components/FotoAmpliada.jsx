// src/components/FotoAmpliada.jsx
// LA FOTO EN GRANDE: tocar la fotografía de la partida la abre a pantalla
// completa, con pellizco y doble toque para acercar. Solo en la app y en la web
// del móvil (`usePuedeAmpliar`): en el escritorio la foto ya ocupa media
// pantalla, y en un teléfono el marco se queda en ~340px de ancho, que es poco
// para leer un faro o la forma de una rejilla.
//
// LO QUE ENSEÑA ES EXACTAMENTE LO QUE YA SE VE, MÁS GRANDE (regla 5). La misma
// imagen —mismo `srcset`, mismo `sizes`, así que el navegador elige el mismo
// candidato y sale de la caché, sin un byte más—, con la misma `escala` CSS y
// dentro de un marco de la MISMA proporción que el del juego (se mide al
// abrir), con `object-fit: cover`. Acercar descubre detalle, nunca superficie:
// el arrastre se acota para que el borde de la foto no entre en el marco, así
// que por mucho que se mueva no aparece ni un píxel fuera del recorte que el
// servidor sirvió para ese intento.
//
// EL GESTO VA POR EL COMPOSITOR (regla 25). Un pellizco o un arrastre no pasan
// por React: se escribe el `transform` de UNA capa, una vez por frame, y el
// marco se mide al EMPEZAR el gesto y no dentro del bucle. `will-change` se
// enciende mientras hay dedos y se suelta al soltar.
//
// No es una hoja ni un diálogo (regla 24): no vas a ningún sitio ni contestas
// nada, miras. Va sobre ModalShell porque de él necesita lo mismo que todos —
// foco dentro, Tab atrapado, scroll bloqueado— y se cierra con el ✕, tocando
// fuera de la foto, con Escape y con la «atrás» de Android.

import { useEffect, useRef, useState } from "react";
import ModalShell from "./ModalShell";
import { useEscape } from "../hooks/useEscape";
import { useHistoryClose } from "../hooks/useHistoryClose";
import { useT } from "../i18n";
import { esApp } from "../lib/plataforma";

// El mismo corte que la barra de pestañas: por debajo es el móvil.
const MOVIL = "(max-width: 1099px)";
const ZOOM_MAX = 4;
// A cuánto acerca el doble toque: lo bastante para que se note el salto y no
// tanto como para perder dónde estabas.
const ZOOM_DOBLE = 2.5;
const DOBLE_TOQUE_MS = 300;
// Lo que un dedo puede moverse y seguir siendo un toque, no un arrastre.
const TOQUE_PX = 10;

/** ¿Se puede abrir la foto en grande aquí? App siempre; web, solo en el móvil. */
export function usePuedeAmpliar() {
  const [puede, setPuede] = useState(() => {
    if (esApp()) return true;
    return typeof window !== "undefined" && !!window.matchMedia?.(MOVIL).matches;
  });
  useEffect(() => {
    if (esApp() || !window.matchMedia) return;
    const mq = window.matchMedia(MOVIL);
    const cambio = () => setPuede(mq.matches);
    mq.addEventListener?.("change", cambio);
    return () => mq.removeEventListener?.("change", cambio);
  }, []);
  return puede;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{ avif?: string, webp?: string, jpeg?: string, src: string, sizes?: string }} props.fuentes
 *   Las mismas cadenas que pinta CarImage (ver arriba por qué).
 * @param {number} props.aspecto  ancho/alto del marco del juego al abrir.
 * @param {number} props.escala   el `scale()` que lleva la foto en el juego.
 * @param {string} props.alt
 */
export default function FotoAmpliada({ open, onClose, fuentes, aspecto, escala = 1, alt }) {
  const { t } = useT();
  const marcoRef = useRef(null);
  const capaRef = useRef(null);
  const panelRef = useRef(null);
  // El estado del gesto vive en refs: cambia en cada frame y no debe renderizar.
  const vista = useRef({ s: 1, x: 0, y: 0 });
  const dedos = useRef(new Map());
  const gesto = useRef(null);
  const caja = useRef({ w: 1, h: 1, cx: 0, cy: 0 });
  const raf = useRef(0);
  const ultimoToque = useRef(null);

  useEscape(open, onClose);
  useHistoryClose(open, onClose);

  // Cada apertura empieza sin acercar.
  useEffect(() => {
    if (!open) return;
    vista.current = { s: 1, x: 0, y: 0 };
    dedos.current.clear();
    gesto.current = null;
    pintar(false);
    return () => cancelAnimationFrame(raf.current);
  }, [open]);

  function pintar(animado) {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const capa = capaRef.current;
      if (!capa) return;
      const { s, x, y } = vista.current;
      // Animado solo el doble toque: un salto de 1× a 2,5× sin transición se lee
      // como un corte. Durante el pellizco la capa sigue al dedo, sin retraso.
      capa.style.transition = animado ? "transform var(--ms-hoja) var(--curva-entra)" : "none";
      capa.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
      if (panelRef.current) panelRef.current.dataset.acercada = s > 1.01 ? "si" : "no";
    });
  }

  // El límite que impide asomar fuera del recorte: con el origen en el centro,
  // la capa escalada `s` puede desplazarse como mucho (s − 1)·lado/2.
  function acotar(s, x, y) {
    const { w, h } = caja.current;
    const sa = Math.min(ZOOM_MAX, Math.max(1, s));
    const mx = ((sa - 1) * w) / 2;
    const my = ((sa - 1) * h) / 2;
    return { s: sa, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  }

  // Coordenadas de un punto de la pantalla respecto al centro del marco.
  const rel = (e) => ({ x: e.clientX - caja.current.cx, y: e.clientY - caja.current.cy });

  function medir() {
    const r = marcoRef.current.getBoundingClientRect();
    caja.current = { w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  function empezarArrastre(p) {
    gesto.current = { tipo: "arrastre", p0: p, x0: vista.current.x, y0: vista.current.y, inicio: performance.now(), movido: false };
  }

  function empezarPinza() {
    const [a, b] = [...dedos.current.values()];
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { s, x, y } = vista.current;
    gesto.current = {
      tipo: "pinza",
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      s0: s,
      // El punto de la FOTO que queda bajo el centro de los dos dedos: es el
      // que tiene que seguirlos mientras se pellizca.
      foto: { x: (c.x - x) / s, y: (c.y - y) / s },
    };
  }

  function onPointerDown(e) {
    if (dedos.current.size === 0) medir();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dedos.current.set(e.pointerId, rel(e));
    capaRef.current.style.willChange = "transform";
    if (dedos.current.size === 1) empezarArrastre(rel(e));
    else if (dedos.current.size === 2) empezarPinza();
  }

  function onPointerMove(e) {
    if (!dedos.current.has(e.pointerId)) return;
    const p = rel(e);
    dedos.current.set(e.pointerId, p);
    const g = gesto.current;
    if (!g) return;
    if (g.tipo === "pinza" && dedos.current.size >= 2) {
      const [a, b] = [...dedos.current.values()];
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = g.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0);
      vista.current = acotar(s, c.x - g.foto.x * s, c.y - g.foto.y * s);
      pintar(false);
    } else if (g.tipo === "arrastre") {
      const dx = p.x - g.p0.x;
      const dy = p.y - g.p0.y;
      if (!g.movido && Math.hypot(dx, dy) > TOQUE_PX) g.movido = true;
      // Sin acercar no hay nada que arrastrar: la foto entera ya está dentro.
      if (vista.current.s > 1) {
        vista.current = acotar(vista.current.s, g.x0 + dx, g.y0 + dy);
        pintar(false);
      }
    }
  }

  function onPointerUp(e) {
    if (!dedos.current.has(e.pointerId)) return;
    const g = gesto.current;
    const p = rel(e);
    dedos.current.delete(e.pointerId);
    if (dedos.current.size === 1) {
      // De pellizco a un dedo: se sigue arrastrando desde donde quedó, sin
      // salto, con el dedo que sigue apoyado.
      empezarArrastre([...dedos.current.values()][0]);
      gesto.current.movido = true;
      return;
    }
    if (dedos.current.size > 0) return;
    capaRef.current.style.willChange = "";
    gesto.current = null;
    // Un pellizco que se queda por debajo de 1× vuelve a su sitio.
    if (vista.current.s <= 1.01) {
      vista.current = { s: 1, x: 0, y: 0 };
      pintar(true);
    }
    const fueToque = g?.tipo === "arrastre" && !g.movido && performance.now() - g.inicio < DOBLE_TOQUE_MS;
    if (!fueToque) return;
    const ahora = performance.now();
    const prev = ultimoToque.current;
    if (prev && ahora - prev.t < DOBLE_TOQUE_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < TOQUE_PX * 3) {
      ultimoToque.current = null;
      if (vista.current.s > 1.01) {
        vista.current = { s: 1, x: 0, y: 0 };
      } else {
        // Acercar HACIA donde se ha tocado: el punto tocado se queda bajo el dedo.
        vista.current = acotar(ZOOM_DOBLE, p.x - p.x * ZOOM_DOBLE, p.y - p.y * ZOOM_DOBLE);
      }
      pintar(true);
    } else {
      ultimoToque.current = { t: ahora, p };
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("cdd.fotoAmpliada")}
      backdropClassName="foto-ampliada-velo fixed inset-0 z-dialogo"
      panelClassName="foto-ampliada pointer-events-none fixed inset-0 flex flex-col items-center justify-center"
    >
      <div ref={panelRef} className="contents" data-acercada="no">
        <button
          type="button"
          className="foto-ampliada-cerrar pointer-events-auto"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div
          ref={marcoRef}
          className="foto-ampliada-marco pointer-events-auto"
          style={{ "--foto-aspecto": aspecto }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div ref={capaRef} className="foto-ampliada-capa">
            <picture>
              {fuentes.avif && <source type="image/avif" srcSet={fuentes.avif} sizes={fuentes.sizes} />}
              {fuentes.webp && <source type="image/webp" srcSet={fuentes.webp} sizes={fuentes.sizes} />}
              <img
                src={fuentes.src}
                srcSet={fuentes.jpeg}
                sizes={fuentes.jpeg ? fuentes.sizes : undefined}
                alt={alt}
                draggable={false}
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ transform: escala !== 1 ? `scale(${escala})` : undefined }}
              />
            </picture>
          </div>
        </div>
        <p className="foto-ampliada-pista" aria-hidden="true">{t("cdd.fotoGestos")}</p>
      </div>
    </ModalShell>
  );
}
