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
  type ArenaTheme,
  type Settings,
} from '../lib/customization'

interface SettingsModalProps {
  onClose: () => void
}

/**
 * An instrument is a medium *and* a mark, so its sample shows both: the stock it
 * draws on, split against the pen it draws with. A pen-only swatch cannot tell
 * the eight apart on paper. Blueprint's white pen would vanish into the sheet.
 */
function instrumentSwatch(theme: ArenaTheme): string {
  return `linear-gradient(135deg, ${theme.colors.bgOuter} 0 50%, ${theme.colors.player} 50% 100%)`
}

/** A row of selectable, unlock-gated cosmetic chips. */
function OptionRow<T extends { id: string; name: string; unlock: any }>({
  items,
  selected,
  swatchOf,
  onPick,
  onHint,
}: {
  items: T[]
  selected: string
  swatchOf?: (item: T) => string | undefined
  onPick: (id: string) => void
  onHint: (hint: string | null) => void
}) {
  return (
    <div className="chip-row">
      {items.map((item) => {
        const unlocked = isConditionMet(item.unlock)
        const active = selected === item.id
        const lockHint = unlocked ? null : `${item.name} · ${unlockLabel(item.unlock)}`
        return (
          <button
            key={item.id}
            type="button"
            className={`cos-chip${active ? ' active' : ''}${unlocked ? '' : ' locked'}`}
            onClick={() => unlocked && onPick(item.id)}
            aria-disabled={!unlocked}
            aria-pressed={active}
            title={unlocked ? item.name : `Locked. ${unlockLabel(item.unlock)}.`}
            onMouseEnter={() => onHint(lockHint)}
            onMouseLeave={() => onHint(null)}
            onFocus={() => onHint(lockHint)}
            onBlur={() => onHint(null)}
          >
            {swatchOf && <span className="cos-swatch" style={{ background: swatchOf(item) }} />}
            {/* A locked control is marked, not padlocked — the chip is already
                mono caps, so the state reads as a plate on the faceplate. */}
            <span className="cos-name">{unlocked ? item.name : `${item.name} · Locked`}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Customization screen: the instrument, the pen loaded in it, and the pen's
    weight — all earned through play. */
export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [hint, setHint] = useState<string | null>(null)

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
        <span className="modal-eyebrow">SETTINGS // COSMETICS</span>
        <h2>Settings</h2>

        <div className="settings-section">
          <div className="settings-label">Arena Instrument</div>
          <OptionRow
            items={themes}
            selected={settings.randomTheme ? '__random' : settings.themeId}
            swatchOf={instrumentSwatch}
            onPick={(id) => update({ themeId: id, randomTheme: false })}
            onHint={setHint}
          />
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.randomTheme}
              onChange={(e) => update({ randomTheme: e.target.checked })}
            />
            Random unlocked instrument each run
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-label">Player Mark</div>
          <OptionRow
            items={playerSkins}
            selected={settings.skinId}
            swatchOf={(s) => s.color ?? 'var(--pen)'}
            onPick={(id) => update({ skinId: id })}
            onHint={setHint}
          />
        </div>

        <div className="settings-section">
          <div className="settings-label">Trail Persistence</div>
          <OptionRow
            items={trailStyles}
            selected={settings.trailId}
            onPick={(id) => update({ trailId: id })}
            onHint={setHint}
          />
        </div>

        <p className={`settings-hint${hint ? ' settings-hint-active' : ''}`} aria-live="polite">
          {hint ?? 'Everything unlocks through play. Hover a locked item to read its condition.'}
        </p>
      </div>
    </div>
  )
}
