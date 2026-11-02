import { useState } from "react"
import "./index.css"

const levels = [
  { name: "WARM UP", detail: "Silueta + frontal", icon: "◉" },
  { name: "CRUISER", detail: "Vista 3/4", icon: "◒" },
  { name: "STREET", detail: "Detalle parcial", icon: "◑" },
  { name: "PRO", detail: "Solo pistas", icon: "◐" },
  { name: "LEGEND", detail: "Una oportunidad", icon: "◌" },
]

const options = ["Nissan Skyline", "Toyota Supra", "Mazda RX-7", "Honda NSX"]

export default function App() {
  const [level, setLevel] = useState(1)
  const [attempt, setAttempt] = useState(2)
  const [selected, setSelected] = useState(null)
  const [result, setResult] = useState(null)
  const [streak, setStreak] = useState(4)

  function guess(option) {
    if (result) return
    setSelected(option)
    setResult(option === "Toyota Supra" ? "win" : "miss")
    if (option === "Toyota Supra") setStreak((value) => value + 1)
  }

  function nextRound() {
    setSelected(null)
    setResult(null)
    setAttempt(2)
  }

  return (
    <main className={`game-shell ${result ? `is-${result}` : ""}`}>
      <div className="grain" />
      <header className="hud-header">
        <button className="brand" aria-label="Coche del día inicio"><span className="brand-mark">CD</span><span>COCHE<br /><b>DEL DÍA</b></span></button>
        <div className="header-center"><span className="eyebrow">DESAFÍO DIARIO</span><strong>07 NOV 2026</strong></div>
        <button className="icon-button" aria-label="Abrir estadísticas">↗</button>
      </header>

      <section className="mission-bar" aria-label="Progreso de partida">
        <div><span className="eyebrow">NIVEL {level}</span><strong>{levels[level - 1].name}</strong></div>
        <div className="attempts"><span>INTENTOS</span><b>{attempt}/5</b><div className="pips">{[0,1,2,3,4].map((pip) => <i className={pip < attempt ? "used" : ""} key={pip} />)}</div></div>
        <div className="streak"><span>RACHA</span><b>⚡ {streak}</b></div>
      </section>

      <section className="hero-stage">
        <div className="scanline" />
        <div className="stage-label"><span className="live-dot" /> IDENTIDAD OCULTA <span>///</span> PISTA 02</div>
        <div className="car-frame">
          <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
          <img src="/splash-car.jpg" alt="Detalle de un coche deportivo camuflado" />
          <div className="image-mask" />
          <div className="focus-ring">?</div>
          <div className="zoom-readout">ZOOM 2.4X</div>
        </div>
        <div className="caption-row"><span>FRAME 02 / 05</span><span className="caption-rule" /><span>ANALIZA EL DETALLE</span></div>
      </section>

      <section className="guess-zone">
        <div className="guess-heading"><span className="eyebrow">¿LO TIENES?</span><strong>ELIGE TU APUESTA</strong></div>
        <div className="answer-grid">{options.map((option, index) => <button key={option} className={`answer ${selected === option ? "selected" : ""} ${result === "win" && option === "Toyota Supra" ? "correct" : ""} ${result === "miss" && selected === option ? "wrong" : ""}`} onClick={() => guess(option)}><span className="answer-key">0{index + 1}</span><span>{option}</span><b>{selected === option && result === "win" ? "✓" : selected === option && result === "miss" ? "×" : "↗"}</b></button>)}</div>
        {result && <div className={`verdict ${result}`}><span className="verdict-icon">{result === "win" ? "✓" : "×"}</span><div><b>{result === "win" ? "LECTURA PERFECTA" : "CASI, PERO NO"}</b><span>{result === "win" ? "Toyota Supra · 1998" : "La pista se abre. Aún puedes remontar."}</span></div><button onClick={nextRound}>{result === "win" ? "SIGUIENTE →" : "VER PISTA →"}</button></div>}
      </section>

      <nav className="difficulty-dock" aria-label="Seleccionar dificultad"><div className="dock-label">DIFICULTAD</div>{levels.map((item, index) => <button key={item.name} className={level === index + 1 ? "active" : ""} onClick={() => { setLevel(index + 1); nextRound() }}><span className="level-icon">{item.icon}</span><span>{item.name}</span><small>{item.detail}</small></button>)}</nav>

      <footer className="game-footer"><span>COCHED**ELDIA.COM</span><span>JUEGA · COMPARTE · REPITE</span><button onClick={() => setStreak(0)}>⚙</button></footer>
    </main>
  )
}
