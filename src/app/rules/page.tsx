import Link from 'next/link'

export default function Rules() {
  return (
    <div
      className="page page-transition"
      style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="rules-modal">
        <h1 className="title-logo glow-text" style={{ fontSize: 'clamp(40px, 12vw, 64px)', marginBottom: 12 }}>
          Motus
        </h1>
        <h2 className="glow-text">Rules</h2>
        <ul>
          <li>Practice Mode: No enemies, no death, wrap-around borders.</li>
          <li>Practice Mode: Focus on collecting green orbs and movement.</li>
          <li>Survival Mode: Move using arrow keys or WASD.</li>
          <li>Survival Mode: Avoid red enemies and collect green goals to score.</li>
          <li>Survival Mode: Every 10 goals may trigger a challenge.</li>
        </ul>
        <Link href="/game">
          <button className="rules-modal-play">PLAY</button>
        </Link>
      </div>
    </div>
  )
}
