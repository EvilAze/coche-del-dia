// src/lib/ventanaFalsa.js
// SOLO PARA PRUEBAS (no lo importa nada de la app; no viaja en el bundle).
//
// Una ventana de mentira con la parte del historial que de verdad importa, y en
// particular la que jsdom NO modela: el navegador ENCOLA los recorridos y
// resuelve el «-1» cuando le toca ejecutarlos, no cuando se piden. Esa asimetría
// entre `pushState` (síncrono) y `history.back()` (asíncrono) es justo la que
// hacía rebotar El Archivo al abrirlo desde el sumario, y con jsdom el test
// pasaba en verde: se traga el back() encolado si alguien empuja después.
//
// Uso: `const v = ventanaFalsa()` → se le pasa a `crearRelevo(v)`. `v.atras()`
// es lo que pulsa el usuario; `v.correrCola()` deja que el navegador digiera
// los recorridos que quedaran pendientes.

export function ventanaFalsa() {
  // La página base, la que ya estaba cargada antes de abrir ningún overlay.
  const entradas = [{ estado: null }];
  let indice = 0;
  const oyentes = new Set();
  const cola = [];

  const history = {
    pushState(estado) {
      // Empujar trunca lo que hubiera por delante, como en el navegador.
      entradas.length = indice + 1;
      entradas.push({ estado });
      indice = entradas.length - 1;
    },
    back() {
      cola.push(-1);
    },
    get length() {
      return entradas.length;
    },
    get state() {
      return entradas[indice].estado;
    },
  };

  const v = {
    history,
    addEventListener(tipo, fn) {
      if (tipo === "popstate") oyentes.add(fn);
    },
    removeEventListener(tipo, fn) {
      if (tipo === "popstate") oyentes.delete(fn);
    },

    // El navegador digiriendo los recorridos pendientes. El delta se aplica
    // sobre el índice ACTUAL, que es el detalle que rompía el relevo.
    correrCola() {
      while (cola.length) {
        const delta = cola.shift();
        const destino = Math.min(entradas.length - 1, Math.max(0, indice + delta));
        if (destino === indice) continue;
        indice = destino;
        for (const fn of [...oyentes]) fn({ state: entradas[indice].estado });
      }
    },

    // Lo que hace el usuario al pulsar «atrás»: pedir el recorrido y que corra.
    atras() {
      history.back();
      v.correrCola();
    },

    // Para las aserciones.
    get profundidad() {
      return indice;
    },
    get pendientes() {
      return cola.length;
    },
  };

  return v;
}
