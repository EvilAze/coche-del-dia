import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Emisor de confetti minimalista basado en DOM + una keyframe parametrizada.
// Sin dependencias externas. Se desmonta sólo a los ~2.4s.
const EMOJIS = ["🎉", "🎊", "⭐", "🚗", "✨", "🏆"];
const PARTICLE_COUNT = 28;

function makeParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    emoji: EMOJIS[i % EMOJIS.length],
    tx: (Math.random() - 0.5) * 640,
    ty: -(120 + Math.random() * 220),
    rot: (Math.random() - 0.5) * 720,
    size: 18 + Math.random() * 14,
    delay: Math.random() * 180,
  }));
}

export default function Confetti({ active }) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (!active) return;
    setParticles(makeParticles());
    const id = setTimeout(() => setParticles([]), 2400);
    return () => clearTimeout(id);
  }, [active]);

  if (!particles.length) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[150] overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute left-1/2 top-1/3"
          style={{
            fontSize: `${p.size}px`,
            animation: `confettiBurst 2s cubic-bezier(0.2, 0.7, 0.4, 1) ${p.delay}ms forwards`,
            "--tx": `${p.tx}px`,
            "--ty": `${p.ty}px`,
            "--rot": `${p.rot}deg`,
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>,
    document.body
  );
}
