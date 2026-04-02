"use client";
import React from 'react'
import GameCanvas from '../components/GameCanvas'

export default function Page() {
  return (
    <main className="page">
      <header className="header">
        <h1>Stay On Deck</h1>
        <p>Survive as long as you can. Click to set velocity, avoid enemies.</p>
        <p>Controls: mouse click or arrow keys. Press SPACE to restart.</p>
      </header>

      <div className="canvas-wrap">
        <GameCanvas />
      </div>
    </main>
  )
}
