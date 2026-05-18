// src/i18n/index.js
// i18n homegrown. Sin dependencias, ~50 SLOC.
//
//   t(key, vars?)           → string traducido, interpola {var} si pasas vars
//   tn(key, count, vars?)   → variante con plural; busca key.one / key.other
//   useT()                  → hook que devuelve { t, tn, locale, setLocale,
//                             dateLocale } y se re-renderiza al cambiar idioma
//   setLocale(locale)       → cambia idioma globalmente y persiste en LS
//   SUPPORTED               → lista de locales soportados ["es","en",...]
//
// Las keys usan notación punteada (e.g. "header.menu"). Si una key falta
// en el locale actual, hace fallback a español; si tampoco existe, devuelve
// la propia key — así se hace evidente en pantalla qué falta sin reventar
// la app.

import { useEffect, useState } from "react";
import es from "./locales/es.json";
import en from "./locales/en.json";
import { COUNTRY_CODES } from "../data/countries";

const DICTIONARIES = { es, en };
export const SUPPORTED = Object.keys(DICTIONARIES);
const DEFAULT = "es";
const STORAGE_KEY = "carguessr_locale";

function detectInitialLocale() {
  // 1. Override explícito en localStorage (lo que el usuario eligió).
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {
    // ignore: localStorage puede fallar en modo privado / iframe sandboxed
  }
  // 2. Browser language. Cogemos solo el código primario ("en-GB" → "en").
  const browser = (navigator?.language || "").slice(0, 2).toLowerCase();
  if (SUPPORTED.includes(browser)) return browser;
  // 3. Fallback.
  return DEFAULT;
}

let currentLocale = detectInitialLocale();
const listeners = new Set();

function lookup(dict, key) {
  return key.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), dict);
}

function interpolate(str, vars) {
  if (!vars || typeof str !== "string") return str;
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
  );
}

export function t(key, vars) {
  const dict = DICTIONARIES[currentLocale] || DICTIONARIES[DEFAULT];
  const value = lookup(dict, key) ?? lookup(DICTIONARIES[DEFAULT], key);
  if (typeof value !== "string") {
    // En dev avisamos para no soltar keys sin traducir en producción
    // silenciosamente. Devolvemos la key para que el dev la vea en pantalla.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] Missing key: ${key} (locale: ${currentLocale})`);
    }
    return key;
  }
  return interpolate(value, vars);
}

// Pluralización mínima: una para count===1, otra para el resto. Suficiente
// para es/en/pt/fr/de. Si en el futuro añadimos ruso o árabe necesitaremos
// reglas CLDR completas — entonces toca librería.
export function tn(baseKey, count, vars) {
  const form = count === 1 ? "one" : "other";
  return t(`${baseKey}.${form}`, { count, ...(vars || {}) });
}

export function getLocale() {
  return currentLocale;
}

// dateLocale es el código BCP-47 (es-ES, en-US) que Intl/Date.toLocaleX
// entienden. Lo guardamos en el JSON por locale para no hard-codear.
export function getDateLocale() {
  return DICTIONARIES[currentLocale]?.locale?.dateLocale || "es-ES";
}

export function setLocale(locale) {
  if (!SUPPORTED.includes(locale) || locale === currentLocale) return;
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

export function listLocales() {
  return SUPPORTED.map((code) => ({
    code,
    name: DICTIONARIES[code]?.locale?.name || code,
  }));
}

// Devuelve el nombre del país en el idioma activo. La BD guarda los nombres
// en español ("EE.UU.", "Reino Unido"...). Para inglés (y futuros idiomas)
// resolvemos el código ISO via COUNTRY_CODES y dejamos que Intl.DisplayNames
// haga la traducción nativa — así no mantenemos listas manuales.
//
// En español devolvemos el string tal cual: Intl.DisplayNames("es").of("US")
// daría "Estados Unidos", pero la UI existente usa "EE.UU." (preferencia del
// admin) y queremos respetarla. Para cualquier país sin código mapeado,
// fallback al original sin tocar.
export function getLocalizedCountry(pais) {
  if (!pais) return pais;
  if (currentLocale === "es") return pais;
  const code = COUNTRY_CODES[pais];
  if (!code) return pais;
  try {
    const dn = new Intl.DisplayNames([currentLocale], { type: "region" });
    return dn.of(code) || pais;
  } catch {
    return pais;
  }
}

// Helper para campos del modelo Car con descripción i18n. Las descripciones
// viven en dos columnas en la BD (`description` = ES canónico, `description_en`
// = traducción opcional). Si el locale activo es inglés y hay traducción,
// la usamos; en cualquier otro caso fallback al ES original. Pensado para
// llamarse en el render — no abre suscripción al cambio de locale por sí
// solo, así que el componente debe usar useT() para re-renderizar.
export function getCarDescription(car) {
  if (!car) return null;
  if (currentLocale === "en" && car.description_en) {
    return car.description_en;
  }
  return car.description ?? null;
}

// Hook reactivo. Cualquier componente que use useT() se re-renderiza
// cuando llamamos setLocale(). No exponemos t/tn como funciones puras del
// hook porque ya son módulo-global — basta con que la lista de
// suscriptores fuerce un render para que los useT() pidan strings nuevos.
export function useT() {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    t,
    tn,
    locale: currentLocale,
    setLocale,
    dateLocale: getDateLocale(),
  };
}
