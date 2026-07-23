// src/lib/theme.js
// Controlador del tema visual «Edición de día / de noche». Fuente de verdad
// del color son las CSS variables en :root / :root[data-tema="noche"] (index.css);
// este módulo solo decide QUÉ tema aplicar y lo refleja en el <html>.
//
// Arranque (resuelto también inline en index.html para evitar el flash):
//   1) override manual en localStorage ('dia'|'noche') si existe;
//   2) si no, la preferencia del SO (prefers-color-scheme).
// Al pulsar el toggle se persiste el override, que a partir de ahí manda sobre
// el sistema. Mientras NO haya override, seguimos los cambios del sistema.

import { useEffect, useState } from "react";

const STORAGE_KEY = "cdd-tema";
// Debe coincidir con --bg de cada tema (index.css) y con el <meta theme-color>.
const THEME_COLOR = { dia: "#f3eee1", noche: "#17130d" };
const listeners = new Set();

// ── Lógica pura (testeable en node, sin DOM) ──
export function resolveTheme(stored, prefersDark) {
  if (stored === "dia" || stored === "noche") return stored;
  return prefersDark ? "noche" : "dia";
}
export function nextTheme(tema) {
  return tema === "noche" ? "dia" : "noche";
}

// ── Lecturas del entorno (protegidas: el módulo se importa también en node) ──
function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function systemPrefersDark() {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// Estado inicial: si el inline de index.html ya fijó data-tema, lo respetamos;
// si no (SSR/tests), lo resolvemos.
let current =
  typeof document !== "undefined" && document.documentElement.dataset.tema
    ? document.documentElement.dataset.tema
    : resolveTheme(readStored(), systemPrefersDark());

export function getTheme() {
  return current;
}

// Arranque: el inline de index.html ya dejó el <html> pintado, pero la barra de
// estado nativa no la toca nadie (arrancaría con el color estático del
// capacitor.config.json). La sincronizamos una vez con el tema ya resuelto.
syncNativeStatusBar(current);

// App nativa (Capacitor): el ESTILO de la barra de estado (claro/oscuro de sus
// iconos) no lo pinta el CSS, así que hay que sincronizarlo a mano con el tema
// elegido. El import es dinámico y el fallo se traga: en web el plugin no existe
// y esto debe ser un no-op, nunca romper el cambio de tema (regla 9: no degradar
// la home).
//   Style.LIGHT = texto OSCURO para fondos claros; Style.DARK = texto CLARO.
//   El nombre va por el CONTENIDO de la barra, no por el fondo — se lee al revés
//   de lo que parece, y es el error clásico al tocar esto.
//
// Aquí NO se toca el color de FONDO de la barra, aunque lo pida el instinto:
// con targetSdk 36 y Capacitor 8, Android impone edge-to-edge y ya no se puede
// desactivar (en API 35 quedaba el escape de `windowOptOutEdgeToEdgeEnforcement`,
// en 36 desapareció). Con edge-to-edge la barra es transparente por definición y
// `StatusBar.setBackgroundColor()` es un no-op documentado por el propio plugin.
// El fondo que se ve bajo la barra es el del contenido web, que ya lleva el tema
// puesto — de ahí que .prensa-hoja incruste el inset superior (ver index.css).
// Lo que había aquí era una llamada muerta que hacía creer que la franja se
// estaba pintando.
function syncNativeStatusBar(tema) {
  // Sin window no hay app nativa (tests en node): salimos antes de importar,
  // para no dejar promesas colgando en la suite.
  if (typeof window === "undefined") return;
  Promise.all([import("@capacitor/core"), import("@capacitor/status-bar")])
    .then(([{ Capacitor }, { StatusBar, Style }]) => {
      if (!Capacitor.isNativePlatform()) return;
      return StatusBar.setStyle({
        style: tema === "noche" ? Style.Dark : Style.Light,
      });
    })
    .catch(() => {
      /* plugin ausente (web) o API no disponible: la barra se queda como esté */
    });
}

export function applyTheme(tema) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.tema = tema;
  el.style.colorScheme = tema === "noche" ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[tema]);
  syncNativeStatusBar(tema);
}

export function setTheme(tema) {
  if (tema !== "dia" && tema !== "noche") return;
  current = tema;
  try {
    localStorage.setItem(STORAGE_KEY, tema);
  } catch {
    // ignore (modo privado / iframe)
  }
  applyTheme(tema);
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(nextTheme(current));
}

// Seguir el sistema SOLO mientras no haya override manual guardado.
if (typeof window !== "undefined" && window.matchMedia) {
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (readStored() == null) setTheme(e.matches ? "noche" : "dia");
      });
  } catch {
    // ignore
  }
}

// Hook reactivo: cualquier componente que use useTheme() se re-renderiza al
// cambiar el tema (mismo patrón que useT() en i18n).
export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { tema: current, toggle: toggleTheme, setTheme };
}
