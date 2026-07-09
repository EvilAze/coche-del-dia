// src/lib/rankMovement.js
// Lógica pura del «parte de la clasificación» (final de partida): a partir del
// objeto de puesto mensual decide QUÉ variante de mensaje mostrar. Sin React ni
// DOM → testeable en node.
//
// Entrada `rank`: objeto { rank, total, delta, isNew } | null.
//   - null / rank == null → el jugador no está rankeado este mes.
//   - delta > 0  → ha SUBIDO `delta` puestos hoy (un nº de puesto menor es mejor).
//   - delta < 0  → ha bajado |delta|.
//   - delta === 0 → mantiene.
//   - delta == null o isNew → aún no hay baseline de hoy (copy neutro «estrenas»).
//
// Salida: { kind, pos?, total?, n? } con kind ∈
//   'unranked' | 'new' | 'up' | 'down' | 'hold'.
// `n` (solo up/down) es SIEMPRE positivo: cuántos puestos se ha movido.

export function rankMovement(rank) {
  if (!rank || rank.rank == null) return { kind: "unranked" };

  const { rank: pos, total, delta, isNew } = rank;

  if (isNew || delta == null) return { kind: "new", pos, total };
  if (delta > 0) return { kind: "up", pos, total, n: delta };
  if (delta < 0) return { kind: "down", pos, total, n: -delta };
  return { kind: "hold", pos, total };
}
