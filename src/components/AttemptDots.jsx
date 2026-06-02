// src/components/AttemptDots.jsx
// Indicador de intentos para la cabecera del panel de guesses: 5 puntos.
// Consumidos = dorado (con leve glow); restantes = gris translúcido.
// Decorativo (aria-hidden); el conteo accesible lo da el aria-label del panel.

export default function AttemptDots({ attempts = 0, max = 5 }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: max }).map((_, i) => {
        const used = i < attempts;
        return (
          <span
            key={i}
            className={`
              h-1.5 w-1.5 rounded-full transition-colors duration-300
              ${used ? "bg-accent" : "bg-white/15"}
            `}
            style={used ? { boxShadow: "0 0 5px rgba(232,200,122,0.45)" } : undefined}
          />
        );
      })}
    </div>
  );
}
