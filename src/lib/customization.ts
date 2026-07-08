// Customization: arena themes, player skins, and trail styles — the earned,
// no-purchase cosmetics — plus the settings that record the player's current
// selection and a resolver that produces the effective palette for rendering.
//
// Everything here is unlocked through play (score, orbs, challenges,
// achievements), evaluated against persistent progress.

import { palette as basePalette } from './palette'
import { readJSON, writeJSON, STORAGE_KEYS } from './storage'
import { loadStats } from './stats'
import { challengeStats } from './challenges'
import { isUnlocked } from './achievements'

export type Unlock =
  | { kind: 'default' }
  | { kind: 'score'; value: number }
  | { kind: 'orbs'; value: number }
  | { kind: 'challenges'; value: number }
  | { kind: 'games'; value: number }
  | { kind: 'achievement'; id: string }

export function unlockLabel(u: Unlock): string {
  switch (u.kind) {
    case 'default': return 'Unlocked'
    case 'score': return `Reach score ${u.value}`
    case 'orbs': return `Collect ${u.value.toLocaleString()} orbs`
    case 'challenges': return `Beat ${u.value} challenges`
    case 'games': return `Play ${u.value} games`
    case 'achievement': return 'Earn a hidden achievement'
  }
}

export function isConditionMet(u: Unlock): boolean {
  if (u.kind === 'default') return true
  const stats = loadStats()
  switch (u.kind) {
    case 'score': return stats.highestScore >= u.value
    case 'orbs': return stats.totalOrbs >= u.value
    case 'games': return stats.gamesPlayed >= u.value
    case 'challenges': return challengeStats().completedCount >= u.value
    case 'achievement': return isUnlocked(u.id)
  }
}

// ── Arena themes ────────────────────────────────────────────────────────

export interface ArenaTheme {
  id: string
  name: string
  unlock: Unlock
  colors: {
    player: string
    playerLight: string
    orb: string
    orbDeep: string
    hostile: string
    hostileLight: string
    bgInner: string // radial gradient center
    bgOuter: string // radial gradient edge
    grid: string // faint grid line color (rgba)
  }
}

export const themes: ArenaTheme[] = [
  { id: 'amethyst', name: 'Amethyst', unlock: { kind: 'default' },
    colors: { player: '#b06bff', playerLight: '#dfc2ff', orb: '#7bffb2', orbDeep: '#23c876',
      hostile: '#ff4d6d', hostileLight: '#ff9aac', bgInner: 'rgba(64,26,110,0.30)', bgOuter: 'rgba(10,4,26,1)', grid: 'rgba(176,107,255,0.06)' } },
  { id: 'azure', name: 'Azure', unlock: { kind: 'orbs', value: 100 },
    colors: { player: '#38bdf8', playerLight: '#bae6fd', orb: '#7bffb2', orbDeep: '#23c876',
      hostile: '#ff4d6d', hostileLight: '#ff9aac', bgInner: 'rgba(14,60,120,0.32)', bgOuter: 'rgba(2,8,24,1)', grid: 'rgba(56,189,248,0.06)' } },
  { id: 'classic', name: 'Classic Neon', unlock: { kind: 'score', value: 25 },
    colors: { player: '#2de2e6', playerLight: '#a7f7ff', orb: '#7bffb2', orbDeep: '#23c876',
      hostile: '#ff4d6d', hostileLight: '#ff9aac', bgInner: 'rgba(24,52,96,0.28)', bgOuter: 'rgba(4,10,28,1)', grid: 'rgba(45,226,230,0.05)' } },
  { id: 'emerald', name: 'Emerald', unlock: { kind: 'challenges', value: 5 },
    colors: { player: '#34f5c5', playerLight: '#b8fff0', orb: '#eaff7b', orbDeep: '#c8d000',
      hostile: '#ff6b6b', hostileLight: '#ffb0b0', bgInner: 'rgba(10,74,58,0.30)', bgOuter: 'rgba(2,16,12,1)', grid: 'rgba(52,245,197,0.06)' } },
  { id: 'synthwave', name: 'Synthwave', unlock: { kind: 'score', value: 50 },
    colors: { player: '#ff5cf0', playerLight: '#ffc2f7', orb: '#5cffd6', orbDeep: '#12c8a0',
      hostile: '#ff3860', hostileLight: '#ff8fa3', bgInner: 'rgba(96,20,90,0.34)', bgOuter: 'rgba(14,4,26,1)', grid: 'rgba(255,92,240,0.07)' } },
  { id: 'cyber', name: 'Cyberpunk', unlock: { kind: 'challenges', value: 20 },
    colors: { player: '#fee440', playerLight: '#fff5a8', orb: '#00f5d4', orbDeep: '#00b89c',
      hostile: '#ff2965', hostileLight: '#ff87a6', bgInner: 'rgba(90,74,10,0.24)', bgOuter: 'rgba(10,10,18,1)', grid: 'rgba(254,228,64,0.06)' } },
  { id: 'matrix', name: 'Matrix', unlock: { kind: 'orbs', value: 500 },
    colors: { player: '#39ff14', playerLight: '#b6ffab', orb: '#c8ff5c', orbDeep: '#8fd000',
      hostile: '#ff4d4d', hostileLight: '#ffa3a3', bgInner: 'rgba(8,40,12,0.30)', bgOuter: 'rgba(0,8,2,1)', grid: 'rgba(57,255,20,0.07)' } },
  { id: 'minimal', name: 'Minimal White', unlock: { kind: 'games', value: 50 },
    colors: { player: '#e6eef8', playerLight: '#ffffff', orb: '#7bffb2', orbDeep: '#23c876',
      hostile: '#ff4d6d', hostileLight: '#ff9aac', bgInner: 'rgba(120,140,170,0.16)', bgOuter: 'rgba(8,12,20,1)', grid: 'rgba(230,238,248,0.05)' } },
]

// ── Player skins (player body color overrides theme's player color) ────────

export interface PlayerSkin {
  id: string
  name: string
  unlock: Unlock
  color?: string // undefined = use theme's player color
  light?: string
}

export const playerSkins: PlayerSkin[] = [
  { id: 'theme', name: 'Theme Default', unlock: { kind: 'default' } },
  { id: 'ember', name: 'Ember', unlock: { kind: 'games', value: 10 }, color: '#ff8a3d', light: '#ffd0a8' },
  { id: 'rose', name: 'Rose', unlock: { kind: 'score', value: 30 }, color: '#ff5c8a', light: '#ffc2d4' },
  { id: 'gold', name: 'Gold', unlock: { kind: 'challenges', value: 10 }, color: '#ffd24a', light: '#fff0b0' },
  { id: 'violet', name: 'Violet', unlock: { kind: 'orbs', value: 250 }, color: '#a06bff', light: '#dcc2ff' },
  { id: 'mono', name: 'Monochrome', unlock: { kind: 'achievement', id: 'score-100' }, color: '#f0f4fa', light: '#ffffff' },
]

// ── Trail styles ──────────────────────────────────────────────────────────

export interface TrailStyle {
  id: string
  name: string
  unlock: Unlock
  width: number // multiplier on trail radius
  opacity: number // base alpha
}

export const trailStyles: TrailStyle[] = [
  { id: 'classic', name: 'Classic', unlock: { kind: 'default' }, width: 1.0, opacity: 0.14 },
  { id: 'comet', name: 'Comet', unlock: { kind: 'orbs', value: 150 }, width: 1.4, opacity: 0.22 },
  { id: 'wisp', name: 'Wisp', unlock: { kind: 'games', value: 25 }, width: 0.75, opacity: 0.1 },
  { id: 'blaze', name: 'Blaze', unlock: { kind: 'challenges', value: 15 }, width: 1.8, opacity: 0.3 },
]

// ── Settings (current selections) ──────────────────────────────────────────

export interface Settings {
  themeId: string
  skinId: string
  trailId: string
  randomTheme: boolean // pick a random unlocked theme each run
}

const DEFAULT_SETTINGS: Settings = { themeId: 'amethyst', skinId: 'theme', trailId: 'classic', randomTheme: false }

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJSON<Partial<Settings>>(STORAGE_KEYS.settings, {}) }
}

export function saveSettings(s: Settings): void {
  writeJSON(STORAGE_KEYS.settings, s)
}

// ── Resolution: current selections → effective render palette ──────────────

export interface ResolvedTheme {
  palette: typeof basePalette
  bgInner: string
  bgOuter: string
  grid: string
  themeId: string
}

/**
 * Build the effective palette + background for a run, honoring the selected
 * theme, player skin, and the random-theme option (which only picks from
 * themes the player has actually unlocked).
 */
export function resolveActiveTheme(): ResolvedTheme {
  const settings = loadSettings()

  let theme = themes.find((t) => t.id === settings.themeId) ?? themes[0]
  if (!isConditionMet(theme.unlock)) theme = themes[0] // fall back if locked

  if (settings.randomTheme) {
    const unlocked = themes.filter((t) => isConditionMet(t.unlock))
    if (unlocked.length > 0) {
      // Deterministic-ish spread without Math.random dependency at module scope.
      theme = unlocked[Math.floor((Date.now() / 1000) % unlocked.length)]
    }
  }

  const skin = playerSkins.find((s) => s.id === settings.skinId)
  const skinUnlocked = skin && isConditionMet(skin.unlock)

  const palette = {
    ...basePalette,
    player: theme.colors.player,
    playerLight: theme.colors.playerLight,
    orb: theme.colors.orb,
    orbDeep: theme.colors.orbDeep,
    hostile: theme.colors.hostile,
    hostileLight: theme.colors.hostileLight,
  }

  if (skinUnlocked && skin?.color) {
    palette.player = skin.color
    palette.playerLight = skin.light ?? skin.color
  }

  return { palette, bgInner: theme.colors.bgInner, bgOuter: theme.colors.bgOuter, grid: theme.colors.grid, themeId: theme.id }
}

export function activeTrailStyle(): TrailStyle {
  const settings = loadSettings()
  const trail = trailStyles.find((t) => t.id === settings.trailId)
  return trail && isConditionMet(trail.unlock) ? trail : trailStyles[0]
}
