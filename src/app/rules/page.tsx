import Link from 'next/link'

export default function Rules() {
  return (
    <div
      className="page page-transition"
      style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div className="rules-modal">
        <span className="modal-eyebrow">Reference</span>
        <h1 className="title-logo" style={{ fontSize: 'clamp(38px, 11vw, 60px)', marginBottom: 14 }}>
          Motus
        </h1>

        <ul>
          <li>Move with the arrow keys or WASD. You have mass — you drift.</li>
          <li>Touch an orb to score. Touch a hazard and the run ends.</li>
          <li>Stay off the limit rails. The edge reads out your distance as you close on it.</li>
          <li>Every ten orbs triggers a Cataclysm. Clear it to advance a stage.</li>
          <li>Practice has no hazards and no death. The borders wrap.</li>
        </ul>

        <Link href="/game">
          <button className="rules-modal-play">Play</button>
        </Link>
      </div>
    </div>
  )
}
