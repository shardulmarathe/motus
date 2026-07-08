"use client"

import React, { useState } from 'react'
import {
  themes,
  playerSkins,
  trailStyles,
  loadSettings,
  saveSettings,
  isConditionMet,
  unlockLabel,
  type Settings,
} from '../lib/customization'

interface SettingsModalProps {
  onClose: () => void
}

/** A row of selectable, unlock-gated cosmetic chips. */
function OptionRow<T extends { id: string; name: string; unlock: any }>({
  items,
  selected,
  swatchOf,
  onPick,
}: {
  items: T[]
  selected: string
  swatchOf?: (item: T) => string | undefined
  onPick: (id: string) => void
}) {
  return (
    <div className="chip-row">
      {items.map((item) => {
        const unlocked = isConditionMet(item.unlock)
        const active = selected === item.id
        return (
          <button
            key={item.id}
            className={`cos-chip${active ? ' active' : ''}${unlocked ? '' : ' locked'}`}
            onClick={() => unlocked && onPick(item.id)}
            disabled={!unlocked}
            title={unlocked ? item.name : unlockLabel(item.unlock)}
          >
            {swatchOf && <span className="cos-swatch" style={{ background: swatchOf(item) }} />}
            <span className="cos-name">{unlocked ? item.name : `🔒 ${item.name}`}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Customization screen: arena theme, player skin, and trail — all earned. */
export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div className="overlay-center" style={{ position: 'absolute', inset: 0, zIndex: 85 }}>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="rules-modal settings-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="glow-text">Settings</h2>

        <div className="settings-section">
          <div className="settings-label">Arena Theme</div>
          <OptionRow
            items={themes}
            selected={settings.randomTheme ? '__random' : settings.themeId}
            swatchOf={(t) => t.colors.player}
            onPick={(id) => update({ themeId: id, randomTheme: false })}
          />
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.randomTheme}
              onChange={(e) => update({ randomTheme: e.target.checked })}
            />
            Random unlocked theme each run
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-label">Player Skin</div>
          <OptionRow
            items={playerSkins}
            selected={settings.skinId}
            swatchOf={(s) => s.color ?? '#2de2e6'}
            onPick={(id) => update({ skinId: id })}
          />
        </div>

        <div className="settings-section">
          <div className="settings-label">Trail</div>
          <OptionRow
            items={trailStyles}
            selected={settings.trailId}
            onPick={(id) => update({ trailId: id })}
          />
        </div>

        <p className="settings-hint">Locked items show how to earn them. Everything is earned through play.</p>
      </div>
    </div>
  )
}
