// src/lib/zoom.sync.test.js
// Red de seguridad de CLAUDE.md #7: api/_lib/zoom.js y src/lib/zoom.js son
// RÉPLICAS deliberadas (las Edge Functions de Vercel no pueden importar desde
// src/, así que no se puede compartir un único módulo). Este test rompe el CI
// — vercel.json ejecuta `vitest run` en el build — si alguien cambia las
// constantes o la fórmula en un lado y olvida el otro.

import { describe, it, expect } from "vitest";
import * as client from "./zoom.js";
import * as server from "../../api/_lib/zoom.js";

describe("sincronía src/lib/zoom.js ↔ api/_lib/zoom.js", () => {
  it("las constantes clave son idénticas", () => {
    expect(client.DEFAULT_ZOOM_BASE).toBe(server.DEFAULT_ZOOM_BASE);
    expect(client.ZOOM_SPAN).toBe(server.ZOOM_SPAN);
    expect(client.ZOOM_EASE).toBe(server.ZOOM_EASE);
    expect(client.ZOOM_ATTEMPTS).toBe(server.ZOOM_ATTEMPTS);
    expect(client.ZOOM_BASE_MIN).toBe(server.ZOOM_BASE_MIN);
    expect(client.ZOOM_BASE_MAX).toBe(server.ZOOM_BASE_MAX);
  });

  it("clampZoomBase se comporta igual en ambos lados", () => {
    const samples = [null, undefined, NaN, "3.9", 0, 2.8, 3.7, 4.5, 7.5, 99];
    for (const v of samples) {
      expect(client.clampZoomBase(v)).toBe(server.clampZoomBase(v));
    }
  });

  // "Sin dato" (null de la columna, "" de un input vacío) tiene que caer al
  // DEFAULT, no al MIN. Number(null) es 0 y 0 es finito, así que sin el guard
  // explícito ambos lados coincidían… en el valor equivocado (el MIN).
  it("un zoom_base ausente cae al default, no al mínimo", () => {
    for (const mod of [client, server]) {
      expect(mod.clampZoomBase(null)).toBe(mod.DEFAULT_ZOOM_BASE);
      expect(mod.clampZoomBase("")).toBe(mod.DEFAULT_ZOOM_BASE);
      expect(mod.clampZoomBase(undefined)).toBe(mod.DEFAULT_ZOOM_BASE);
      // Un 0 explícito SÍ es un número fuera de rango: se acota al mínimo.
      expect(mod.clampZoomBase(0)).toBe(mod.ZOOM_BASE_MIN);
    }
  });

  it("zoomForAttempt y cropPctForAttempt coinciden para todo intento y base", () => {
    const bases = [undefined, 2.8, 3.7, 4.4, 6.0, 7.5];
    for (const base of bases) {
      for (let z = 1; z <= client.ZOOM_ATTEMPTS; z++) {
        expect(client.zoomForAttempt(z, base)).toBe(server.zoomForAttempt(z, base));
        expect(client.cropPctForAttempt(z, base)).toBe(server.cropPctForAttempt(z, base));
      }
    }
  });

  // ── EL PREVIO DEL ADMIN TIENE QUE SER LO QUE VE EL JUGADOR ────────────────
  // Son dos caminos distintos hacia la misma imagen y por eso pueden divergir
  // sin que nadie se entere:
  //
  //   · admin (FocusPicker / PreviewPanel) recorta DIRECTO al intento N:
  //       cropPctForAttempt(N, base)
  //   · el juego recibe SIEMPRE el crop del intento 5 y cierra el resto con un
  //     scale CSS:
  //       cropPctForAttempt(5, base) / cssZoomLevels(base)[N-1]
  //
  // Álgebra: (1/z5) / (zN/z5) = 1/zN. Se cancelan… y con la resta fija SOLO se
  // cancelaban si los dos usaban el MISMO base. Cuando useGame perdía el
  // zoomBase del coche, el servidor recortaba con el base real y el cliente
  // escalaba con el default: un coche a 6.0 enseñaba un 11,5% en el intento 1
  // donde el admin previsualizaba 16,7% (más difícil de lo balanceado). Solo
  // cuadraba en el intento 5, donde el scale es 1, y en el propio 3.7 — por eso
  // pasó desapercibido.
  //
  // Desde que el span es un ratio los scales ya no dependen del base y esa
  // divergencia es imposible por construcción. El test se queda igualmente:
  // es la propiedad la que importa, no el mecanismo que la garantiza hoy.
  it("el previo del admin muestra lo mismo que el juego, intento a intento", () => {
    for (const base of [2.8, 3.7, 4.5, 7.5]) {
      const cropServido = client.cropPctForAttempt(client.ZOOM_ATTEMPTS, base);
      const escalas = client.cssZoomLevels(base);
      for (let n = 1; n <= client.ZOOM_ATTEMPTS; n++) {
        const loQuePintaElAdmin = client.cropPctForAttempt(n, base);
        const loQueVeElJugador = cropServido / escalas[n - 1];
        expect(loQueVeElJugador).toBeCloseTo(loQuePintaElAdmin, 12);
      }
    }
  });
});

// ── FORMA DE LA CURVA DE DIFICULTAD ────────────────────────────────────────
// Estas invariantes son decisiones de DISEÑO DE JUEGO, no detalles de
// implementación: se pueden romper cambiando un solo número (ZOOM_EASE) sin
// que falle nada más, y el síntoma no se ve en el build sino semanas después
// en la telemetría. Por eso se fijan aquí.
const BASES = [2.8, 3.7, 4.4, 6.0, 7.5];

// Pasos de la curva en espacio LOG (que es donde vive la percepción): cuánto
// se abre la foto de un intento al siguiente.
function pasosLog(base) {
  const { zoomForAttempt: zf, ZOOM_ATTEMPTS: N } = client;
  return Array.from({ length: N - 1 }, (_, i) =>
    Math.log(zf(i + 1, base)) - Math.log(zf(i + 2, base))
  );
}

describe("forma de la curva de zoom", () => {
  // LA invariante que hace seguro retocar ZOOM_EASE: los extremos no se mueven.
  // El intento 1 fija el teaser y el 5 fija el suelo de derrota (y con él el
  // crop que sirve daily-image.js, el hash de caché y la calibración por
  // zoom_base del bucle DDA). Un EASE nuevo redistribuye los intermedios y NADA
  // más; si esto falla, el cambio dejó de ser gratis.
  it("los extremos son exactos para cualquier base y cualquier EASE", () => {
    for (const base of BASES) {
      const fin = base / client.ZOOM_SPAN;
      expect(client.zoomForAttempt(1, base)).toBeCloseTo(base, 12);
      expect(client.zoomForAttempt(client.ZOOM_ATTEMPTS, base)).toBeCloseTo(fin, 12);
    }
  });

  // El span es un RATIO, no una resta: todo coche revela exactamente el mismo
  // factor total. Es lo que impide que un base alto vuelva a producir una curva
  // muda (a 6.0 con la resta fija el revelado total era ×1.50 y los pasos de
  // ×1.08, imperceptibles) y lo que hace que el slider del admin signifique
  // siempre lo mismo.
  it("el revelado total es el mismo factor para toda base", () => {
    for (const base of BASES) {
      const total =
        client.zoomForAttempt(1, base) /
        client.zoomForAttempt(client.ZOOM_ATTEMPTS, base);
      expect(total).toBeCloseTo(client.ZOOM_SPAN, 12);
    }
  });

  // El base por defecto es el 83% del catálogo: su comportamiento histórico
  // (intento 1 = 3.7×, intento 5 = 1.7×) es el ancla de ZOOM_SPAN y no se toca.
  // Si esto falla, la migración de scripts/2026-08-zoom-span-ratio.sql dejó de
  // cuadrar con el código.
  it("el base por defecto conserva sus extremos históricos", () => {
    expect(client.zoomForAttempt(1, client.DEFAULT_ZOOM_BASE)).toBeCloseTo(3.7, 10);
    expect(
      client.zoomForAttempt(client.ZOOM_ATTEMPTS, client.DEFAULT_ZOOM_BASE)
    ).toBeCloseTo(1.7, 10);
  });

  // Back-loading (convención del género: Heardle 1→2→4→7→11→16). La tensión
  // sube hasta el final y la pista más generosa es la última, la que rescata.
  // Con pasos decrecientes el desenlace era un anticlímax: el intento 5 casi no
  // añadía nada sobre el 4.
  it("cada paso es mayor que el anterior y el más grande es el último", () => {
    for (const base of BASES) {
      const pasos = pasosLog(base);
      for (let i = 1; i < pasos.length; i++) {
        expect(pasos[i]).toBeGreaterThan(pasos[i - 1]);
      }
      expect(Math.max(...pasos)).toBeCloseTo(pasos[pasos.length - 1], 12);
    }
  });

  // El otro extremo del péndulo: un EASE demasiado alto adelgaza el paso 1→2
  // hasta hacerlo imperceptible y el jugador siente que ha gastado un intento
  // para nada. El suelo es el 60% del paso geométrico (= el que tendría una
  // curva de pasos iguales, EASE 1.0).
  it("ningún paso queda por debajo del 60% del paso geométrico", () => {
    for (const base of BASES) {
      const pasos = pasosLog(base);
      const geometrico = pasos.reduce((a, b) => a + b, 0) / pasos.length;
      expect(Math.min(...pasos)).toBeGreaterThan(geometrico * 0.6);
    }
  });

  // La forma es invariante de escala: el zoom_base cambia la MAGNITUD total del
  // revelado, nunca el reparto. Así el slider del admin significa siempre lo
  // mismo ("más difícil"), sin deformar además la curva por el camino — que es
  // lo que hacía el escalonado lineal (una resta fija sobre bases distintas).
  it("el reparto del span es idéntico para toda base", () => {
    const referencia = pasosLog(BASES[0]).map(
      (p, _, arr) => p / arr.reduce((a, b) => a + b, 0)
    );
    for (const base of BASES.slice(1)) {
      const pasos = pasosLog(base);
      const total = pasos.reduce((a, b) => a + b, 0);
      pasos.forEach((p, i) => expect(p / total).toBeCloseTo(referencia[i], 12));
    }
  });
});
