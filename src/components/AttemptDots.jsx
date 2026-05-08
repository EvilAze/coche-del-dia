// src/components/AttemptDots.jsx

export default function AttemptDots({ attempts, max }) {
  return (
    <div className="flex gap-1.5 justify-center my-3">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`
            w-2 h-2 rounded-full transition-all duration-300
            ${i < attempts
              ? "bg-red-400"
              : i === attempts
              ? "bg-accent scale-125"
              : "bg-border-strong"
            }
          `}
        />
      ))}
    </div>
  );
}
