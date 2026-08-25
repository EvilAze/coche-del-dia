// src/data/catalog.js
// Carga el catálogo de coches desde /api/list-cars una sola vez por sesión.
// Cualquier componente que llame loadCatalog() o use el hook useCatalog()
// comparte la misma promesa, evitando refetches en cascada al montar varios
// consumidores a la vez.
//
// Para herramientas de admin que necesitan ver los cambios al instante
// (AddCar / EditCar), usar `useFreshCatalog()` o `loadFreshCatalog()`, que
// bypassean la caché CDN de Vercel (s-maxage=300) y la caché de memoria.

import { useCallback, useEffect, useState } from "react";

let catalogPromise = null;

// Tiempo máximo por intento. NO es paranoia: un `fetch` en una red móvil que se
// queda a medias no rechaza nunca por su cuenta —la petición se queda colgada
// indefinidamente— y aquí eso no es "tarda": es el cupón inerte para siempre,
// porque GuessForm deshabilita los tres renglones mientras no haya catálogo.
// Mejor cortar y reintentar que esperar a nada.
const TIMEOUT_MS = 8000;
// Reintentos automáticos y su espera. Dos bastan: el fallo típico es un
// arranque en frío de la función o un bache de cobertura de un par de segundos,
// no una caída larga. Si a la tercera sigue sin venir, el problema merece un
// cartel y un botón, no seguir insistiendo en silencio.
const REINTENTOS = 2;
const ESPERA_MS = [400, 1200];

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pedirUnaVez() {
  // AbortController y no `Promise.race`: sin abortar, la petición colgada sigue
  // viva consumiendo la conexión mientras ya estamos reintentando por otra.
  const ac = new AbortController();
  const corte = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/list-cars", { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`/api/list-cars devolvió ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(corte);
  }
}

async function fetchCatalog() {
  let ultimo;
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    try {
      return await pedirUnaVez();
    } catch (err) {
      ultimo = err;
      if (intento < REINTENTOS) await esperar(ESPERA_MS[intento]);
    }
  }
  throw ultimo;
}

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetchCatalog().catch((err) => {
      // Si falla, permitimos reintentar en la siguiente llamada.
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

// Hook React: devuelve { data, error, loading, reload }.
// `data` tiene la forma { cars, marcas, paises, marcaPais }.
//
// El `reload` y el reintento automático al volver la conexión son los mismos
// que ya tiene useGame para la carga del coche del día, y por el mismo motivo:
// sin catálogo el cupón no se puede rellenar, así que un fallo de red aquí deja
// la partida tan muerta como un fallo al traer el coche. La diferencia es que
// aquel SÍ tenía cartel y botón y este se quedaba mudo, con los tres renglones
// deshabilitados y su «Elegir…» intacto: parecía que la app estaba rota, no que
// faltara un dato. (Reportado el 2026-08-10 en una repesca: la foto había
// cargado, el cupón no se dejaba tocar, y "al rato" —otra visita, otra
// petición— funcionó solo.)
export function useCatalog() {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    // Tirar la promesa compartida es imprescindible: si el fallo la dejó en
    // caché, reintentar devolvería el mismo error sin tocar la red. (Hoy
    // loadCatalog ya la limpia al fallar; esto lo hace explícito y protege el
    // caso de un reload pedido con datos viejos.)
    catalogPromise = null;
    setState({ data: null, error: null, loading: true });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    setState((s) => ({ ...s, loading: true }));
    loadCatalog()
      .then((data) => {
        if (mounted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (mounted) setState({ data: null, error, loading: false });
      });
    return () => {
      mounted = false;
    };
  }, [nonce]);

  // Reintento AUTOMÁTICO al recuperar la conexión, solo suscrito si hay un fallo
  // pendiente (en el camino feliz no queda ningún listener colgado). Caso
  // típico del móvil: abres en el metro, sales a la calle y quieres el cupón
  // vivo sin tener que tocar nada.
  useEffect(() => {
    if (!state.error) return;
    if (typeof window === "undefined") return;
    const alVolver = () => reload();
    window.addEventListener("online", alVolver);
    return () => window.removeEventListener("online", alVolver);
  }, [state.error, reload]);

  return { ...state, reload };
}

// ---- Variante "siempre fresco" para herramientas de admin ----

// Fetch que bypassea CDN (query param distinto = cache miss en Vercel)
// y caché del navegador (cache: 'no-store').
async function loadFreshCatalog() {
  const url = `/api/list-cars?fresh=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/list-cars devolvió ${res.status}`);
  const data = await res.json();
  // Refrescamos también la caché de memoria, así si DESPUÉS alguien usa
  // el hook normal `useCatalog`, ya recibe la versión nueva.
  catalogPromise = Promise.resolve(data);
  return data;
}

// Hook gemelo de `useCatalog` pero con fresh-fetch en mount y `reload()`
// expuesto para refrescar manualmente (p.ej. tras guardar un coche).
//
// `auto: false` desactiva ESE fetch de mount y deja la carga entera en manos de
// `reload()`. Para quién es: un modal que está montado siempre —ModalShell
// exige que el caller lo renderice también con open=false, o la animación de
// salida se corta al desmontarlo— y que ya recarga al abrirse. Ahí el fetch de
// mount no es "uno de más": es el catálogo entero, sin caché de CDN ni de
// memoria, descargado al entrar en el panel aunque nadie abra el modal, y otra
// vez cuando se abre. Con `auto: false` se descarga una vez, y solo al abrir.
export function useFreshCatalog({ auto = true } = {}) {
  // `loading` arranca en false cuando no hay fetch de mount: no se está
  // cargando nada todavía, y decir lo contrario dejaría a un consumidor
  // pintando un esqueleto para siempre.
  const [state, setState] = useState({ data: null, error: null, loading: auto });

  const reload = useCallback(() => {
    setState({ data: null, error: null, loading: true });
    return loadFreshCatalog()
      .then((data) => {
        setState({ data, error: null, loading: false });
        return data;
      })
      .catch((error) => {
        setState({ data: null, error, loading: false });
        throw error;
      });
  }, []);

  useEffect(() => {
    if (!auto) return;
    let mounted = true;
    loadFreshCatalog()
      .then((data) => {
        if (mounted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (mounted) setState({ data: null, error, loading: false });
      });
    return () => {
      mounted = false;
    };
  }, [auto]);

  return { ...state, reload };
}
