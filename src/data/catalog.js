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

async function fetchCatalog() {
  const res = await fetch("/api/list-cars");
  if (!res.ok) {
    throw new Error(`/api/list-cars devolvió ${res.status}`);
  }
  return res.json();
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

// Hook React: devuelve { data, error, loading }.
// `data` tiene la forma { cars, marcas, paises, marcaPais }.
export function useCatalog() {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let mounted = true;
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
  }, []);

  return state;
}

// ---- Variante "siempre fresco" para herramientas de admin ----

// Fetch que bypassea CDN (query param distinto = cache miss en Vercel)
// y caché del navegador (cache: 'no-store').
export async function loadFreshCatalog() {
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
export function useFreshCatalog() {
  const [state, setState] = useState({ data: null, error: null, loading: true });

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
  }, []);

  return { ...state, reload };
}
