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

export function applyTheme(tema) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.tema = tema;
  el.style.colorScheme = tema === "noche" ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[tema]);
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
