// src/components/ResultPanel.jsx

function buildCarDescription(car) {
  if (car.descripcion) return car.descripcion;

  const fullName = `${car.marca} ${car.modelo}`.replace(/\s+/g, " ").trim();
  const era =
    car.anio < 1970
      ? "un clásico de otra época, marcado por unas proporciones muy reconocibles y una presencia que todavía lo hace especial."
      : car.anio < 1990
      ? "un modelo con sabor analógico, de esos que se recuerdan por su silueta y por el carácter de su generación."
      : car.anio < 2010
      ? "uno de esos coches que dejó huella entre los aficionados por su mezcla de diseño, prestaciones y personalidad."
      : "una máquina moderna con identidad propia, pensada para destacar tanto por su imagen como por su rendimiento.";

  return `El ${fullName} de ${car.anio} es ${era}`;
}

export default function ResultPanel({ status, car, attempts, maxAttempts, shareText }) {
  const won = status === "won";
  const carDescription = buildCarDescription(car);

  function handleShare() {
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText).then(() => alert("¡Copiado al portapapeles!"));
    }
  }

  return (
    <div className="rounded-xl border border-border bg-bg-tertiary p-6 text-center animate-fade-in">
      {won ? (
        <>
          <div className="font-display text-3xl tracking-widest text-green-400 mb-1">
            ¡ACERTASTE!
          </div>
          <div className="text-2xl mb-3">🎉</div>
        </>
      ) : (
        <>
          <div className="font-display text-3xl tracking-widest text-red-400 mb-1">
            SIN SUERTE
          </div>
          <div className="text-2xl mb-3">😔</div>
        </>
      )}

      <p className="text-muted text-sm mb-1">Era el</p>
      <p className="text-white font-medium text-base mb-1">
        {car.marca} {car.modelo}
      </p>
      <p className="text-accent font-display text-xl tracking-wider mb-4">{car.anio}</p>

      {won && (
        <>
          <p className="text-muted text-sm leading-relaxed mb-4 text-left">
            {carDescription}
          </p>
          <p className="text-muted text-xs tracking-wider uppercase mb-4">
            Conseguido en {attempts} intento{attempts !== 1 ? "s" : ""}
          </p>
        </>
      )}

      {/* Share grid */}
      <div className="bg-bg-secondary rounded-lg p-3 mb-4 font-mono text-sm whitespace-pre-wrap text-left text-muted leading-relaxed">
        {shareText}
      </div>

      <button
        onClick={handleShare}
        className="
          border border-accent text-accent rounded-lg px-7 py-2.5
          text-xs tracking-widest uppercase font-body
          transition-colors hover:bg-accent/10 active:scale-[0.97]
        "
      >
        Compartir resultado
      </button>
    </div>
  );
}
