import Link from 'next/link'

export default function Rules() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center page-transition">
      <div className="text-center max-w-md">
        <h1 className="text-4xl font-bold text-cyan-400 mb-8 glow-text">
          Motus
        </h1>
        <div className="bg-slate-800/50 border border-cyan-400/20 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-cyan-400 mb-4">Rules</h2>
          <ul className="text-left text-gray-300 space-y-2">
            <li>• Practice Mode: No enemies, no death, wrap-around borders.</li>
            <li>• Practice Mode: Focus on collecting green orbs and movement.</li>
            <li>• Survival Mode: Move using arrow keys or WASD.</li>
            <li>• Survival Mode: Avoid red enemies and collect green goals to score.</li>
            <li>• Survival Mode: Every 10 goals may trigger a challenge.</li>
          </ul>
        </div>
        <Link href="/game">
          <button className="bg-cyan-900/20 border border-cyan-400/40 rounded-lg px-8 py-4 text-cyan-400 font-bold text-xl cursor-pointer transition-all duration-200 hover:bg-cyan-900/40 hover:shadow-lg hover:shadow-cyan-400/20 glow-text">
            PLAY
          </button>
        </Link>
      </div>
    </div>
  )
}