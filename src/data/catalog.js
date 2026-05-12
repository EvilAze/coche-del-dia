// src/data/catalog.js
// Carga el catálogo de coches desde /api/list-cars una sola vez por sesión.
// Cualquier componente que llame loadCatalog() o use el hook useCatalog()
// comparte la misma promesa, evitando refetches en cascada al montar varios
// consumidores a la vez.

import { useEffect, useState } from "react";

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
