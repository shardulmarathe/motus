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

// ── Arena themes: eight instruments ─────────────────────────────────────
//
// Each theme is a different *machine* reading the same experiment — a phosphor
// scope, a blueprint, an amber tube, a pen plotter — rather than a hue rotation
// of one look. Five are lit tubes; three (Thermal, Plotter, Blackline) print
// dark marks on light stock. That is why `ink`, `sheet` and `luminous` exist:
// nothing in the renderer may assume the field is dark, or that a mark glows.
//
// The `id` values are persisted in localStorage (see `loadSettings`), so they
// must never change — renaming one silently resets every player to the default.
// Unlock conditions are likewise untouched.

export interface ArenaTheme {
  id: string
  name: string
  unlock: Unlock
  /**
   * True only for genuinely lit instruments (Blueprint, Amber CRT, P1
   * Phosphor). The house look is print, so this is false by default and the
   * renderer must never assume marks emit light.
   */
  luminous: boolean
  colors: {
    player: string
    playerLight: string
    orb: string
    orbDeep: string
    hostile: string
    hostileLight: string
    /** Foreground marks — graduations, rules, labels. Dark on paper stock. */
    ink: string
    /** Secondary mark: subordinate labels and spent graduations. */
    muted: string
    /** Surface for in-canvas panels and cards. */
    sheet: string
    bgInner: string // radial gradient center
    bgOuter: string // radial gradient edge
    grid: string // faint grid line color (rgba)
  }
}

export const themes: ArenaTheme[] = [
  // The house look. `amethyst` is the id that ships unlocked, so it carries the
  // primary instrument: a long-persistence phosphor scope.
  { id: 'amethyst', name: 'Phosphor Scope', unlock: { kind: 'default' }, luminous: true,
    colors: { player: '#46ff8c', playerLight: '#a6ffc6', orb: '#c8ffdf', orbDeep: '#4f9e6d',
      hostile: '#ff3b21', hostileLight: '#ff8566', ink: '#c8ffdf', muted: '#6bc98f', sheet: '#0a1f13',
      bgInner: 'rgba(9,42,24,0.62)', bgOuter: '#04120a', grid: 'rgba(70,255,140,0.10)' } },

  { id: 'azure', name: 'Blueprint', unlock: { kind: 'orbs', value: 100 }, luminous: true,
    colors: { player: '#ffffff', playerLight: '#ffffff', orb: '#cfe0ee', orbDeep: '#7d97ad',
      hostile: '#e8703c', hostileLight: '#f4a682', ink: '#dce9f2', muted: '#8fa8bd', sheet: '#123253',
      bgInner: 'rgba(19,54,89,0.72)', bgOuter: '#0a1c30', grid: 'rgba(220,233,242,0.13)' } },

  { id: 'classic', name: 'Amber CRT', unlock: { kind: 'score', value: 25 }, luminous: true,
    colors: { player: '#ffb245', playerLight: '#ffd79a', orb: '#ede4d3', orbDeep: '#9a8f80',
      hostile: '#ff3b21', hostileLight: '#ff8566', ink: '#ede4d3', muted: '#9a8f80', sheet: '#1a1714',
      bgInner: 'rgba(42,26,10,0.50)', bgOuter: '#0f0d0b', grid: 'rgba(255,178,69,0.08)' } },

  // P7: the tube that keeps a yellow-green afterglow long after the beam has
  // moved on. The longest persistence of the set.
  { id: 'emerald', name: 'Long Persistence', unlock: { kind: 'challenges', value: 5 }, luminous: true,
    colors: { player: '#b6ff4d', playerLight: '#e0ffa8', orb: '#e4f5c2', orbDeep: '#7f9455',
      hostile: '#ff4d3a', hostileLight: '#ff9585', ink: '#e4f5c2', muted: '#8fa565', sheet: '#141a08',
      bgInner: 'rgba(28,38,8,0.58)', bgOuter: '#0d1405', grid: 'rgba(182,255,77,0.09)' } },

  { id: 'synthwave', name: 'Sonar', unlock: { kind: 'score', value: 50 }, luminous: true,
    colors: { player: '#6fe0c8', playerLight: '#c6fff2', orb: '#d6e8ec', orbDeep: '#7b8f96',
      hostile: '#ff5a3c', hostileLight: '#ff9a7f', ink: '#d6e8ec', muted: '#8aa3ab', sheet: '#07222f',
      bgInner: 'rgba(6,44,60,0.62)', bgOuter: '#03121a', grid: 'rgba(111,224,200,0.09)' } },

  { id: 'cyber', name: 'Thermal', unlock: { kind: 'challenges', value: 20 }, luminous: false,
    colors: { player: '#2a2118', playerLight: '#5c4c38', orb: '#3a332a', orbDeep: '#8b8172',
      hostile: '#c62817', hostileLight: '#e0705d', ink: '#231d16', muted: '#7a7063', sheet: '#e6e2d9',
      bgInner: 'rgba(240,237,229,0.55)', bgOuter: '#d4d0c6', grid: 'rgba(35,29,22,0.12)' } },

  // The pen plotter — the whole app wore this for a while; it lives on as
  // something you earn.
  { id: 'matrix', name: 'Plotter', unlock: { kind: 'orbs', value: 500 }, luminous: false,
    colors: { player: '#1f3fd1', playerLight: '#4560e0', orb: '#16202b', orbDeep: '#5d6672',
      hostile: '#c8221a', hostileLight: '#e0655a', ink: '#16202b', muted: '#5d6672', sheet: '#f4f1e8',
      bgInner: 'rgba(250,247,238,0.55)', bgOuter: '#e9e3d5', grid: 'rgba(22,32,43,0.11)' } },

  { id: 'minimal', name: 'Blackline', unlock: { kind: 'games', value: 50 }, luminous: false,
    colors: { player: '#101418', playerLight: '#39424c', orb: '#101418', orbDeep: '#6b747d',
      hostile: '#7a1512', hostileLight: '#a8544f', ink: '#101418', muted: '#6b747d', sheet: '#ffffff',
      bgInner: 'rgba(255,255,255,0.75)', bgOuter: '#f3f1eb', grid: 'rgba(16,20,24,0.10)' } },
]

// ── Player skins (player body color overrides theme's player color) ────────

export interface PlayerSkin {
  id: string
  name: string
  unlock: Unlock
  color?: string // undefined = use theme's player color
  light?: string
}

// Skins recolour the measured body itself, so they have to survive every
// medium — mid-tone values that hold up on a dark tube AND on paper stock.
export const playerSkins: PlayerSkin[] = [
  { id: 'theme', name: 'Instrument Default', unlock: { kind: 'default' } },
  { id: 'ember', name: 'Amber', unlock: { kind: 'games', value: 10 }, color: '#e8912a', light: '#f6bf78' },
  { id: 'rose', name: 'Magenta', unlock: { kind: 'score', value: 30 }, color: '#d6337a', light: '#ee7fae' },
  { id: 'gold', name: 'Sodium', unlock: { kind: 'challenges', value: 10 }, color: '#d9b32e', light: '#f0d878' },
  { id: 'violet', name: 'Violet', unlock: { kind: 'orbs', value: 250 }, color: '#8f5cf0', light: '#bfa1f7' },
  { id: 'mono', name: 'Monochrome', unlock: { kind: 'achievement', id: 'score-100' }, color: '#9aa3ac', light: '#ccd3d9' },
]

// ── Trail styles: how long the phosphor holds ─────────────────────────────
//
// The trail is the player's own speed trace — on a tube it is literal
// persistence, on a printed instrument it is how heavily the pen bears down.
// `width`/`opacity` keep their old meaning, and the ids keep their old unlock
// conditions.

export interface TrailStyle {
  id: string
  name: string
  unlock: Unlock
  width: number // multiplier on trail radius
  opacity: number // base alpha
  /** Stamp interval ticks along the trace — spacing reads as speed. */
  ticks?: boolean
}

export const trailStyles: TrailStyle[] = [
  { id: 'classic', name: 'Standard Decay', unlock: { kind: 'default' }, width: 1.0, opacity: 0.2 },
  { id: 'comet', name: 'Marked', unlock: { kind: 'orbs', value: 150 }, width: 1.2, opacity: 0.26, ticks: true },
  { id: 'wisp', name: 'Fast Decay', unlock: { kind: 'games', value: 25 }, width: 0.6, opacity: 0.14 },
  { id: 'blaze', name: 'Slow Decay', unlock: { kind: 'challenges', value: 15 }, width: 1.9, opacity: 0.32 },
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
  // Selecting an instrument re-skins the whole product, not just the arena.
  applyThemeToDocument()
}

// ── The chassis follows the instrument ────────────────────────────────────
//
// The arena reads its colours from `resolveActiveTheme()`, but the menus,
// panels and HUD are DOM and read CSS custom properties. These two functions
// are the bridge: they translate the selected instrument into the same
// medium-neutral tokens `globals.css` is written against, so picking Amber CRT
// or Plotter re-skins every screen rather than just the playfield.

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
  ]
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Blend `amount` of `b` into `a`. Used to derive the in-between brightnesses. */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const ch = (x: number, y: number) => Math.round(x + (y - x) * amount)
  return `rgb(${ch(ar, br)}, ${ch(ag, bg)}, ${ch(ab, bb)})`
}

/** The instrument expressed as the CSS tokens `globals.css` is written against. */
export function themeCssVars(theme: ArenaTheme): Record<string, string> {
  const c = theme.colors
  return {
    '--field': c.bgOuter,
    '--surface': c.sheet,
    '--surface-hi': mix(c.sheet, c.ink, 0.08),
    '--mark': c.ink,
    '--mark-body': c.muted,
    '--mark-dim': mix(c.muted, c.bgOuter, 0.3),
    '--signal': c.player,
    '--signal-hi': c.playerLight,
    '--signal-wash': rgba(c.player, 0.1),
    '--alarm': c.hostile,
    '--alarm-wash': rgba(c.hostile, 0.12),
    '--rule': rgba(c.ink, 0.18),
    '--rule-strong': rgba(c.ink, 0.36),
    '--scrim': rgba(c.bgOuter, 0.84),
    // Live readouts get a little phosphor bleed on a tube, which is what makes
    // them read as lit rather than printed. On paper instruments that would be
    // nonsense, so it resolves to `none` there.
    '--bloom': theme.luminous ? `0 0 14px ${rgba(c.player, 0.4)}` : 'none',
    // A tube has no shadows, so lit instruments get a phosphor halo and
    // printed ones get an honest drop shadow.
    '--lift': theme.luminous
      ? `0 0 0 1px ${rgba(c.player, 0.14)}, 0 18px 50px rgba(0, 0, 0, 0.55)`
      : `0 1px 1px ${rgba(c.ink, 0.05)}, 0 14px 34px ${rgba(c.ink, 0.16)}`,
  }
}

/**
 * The instrument the chassis wears. This deliberately ignores `randomTheme` —
 * that option re-rolls the arena each run, and having the menus change colour
 * underneath the player between runs would read as a bug, not a feature.
 */
export function chassisTheme(): ArenaTheme {
  const settings = loadSettings()
  const theme = themes.find((t) => t.id === settings.themeId) ?? themes[0]
  return isConditionMet(theme.unlock) ? theme : themes[0]
}

/** Fired after :root changes so canvas components can re-read their tokens. */
export const THEME_CHANGE_EVENT = 'motus:theme'

/** Push the selected instrument onto :root. Safe to call on the server (no-op). */
export function applyThemeToDocument(theme?: ArenaTheme): void {
  if (typeof document === 'undefined') return
  const vars = themeCssVars(theme ?? chassisTheme())
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  // Canvas components sample these tokens once and cache them; without a
  // signal the title backdrop and the HUD chart would keep the old instrument.
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT))
}

// ── Resolution: current selections → effective render palette ──────────────

export interface ResolvedTheme {
  palette: typeof basePalette
  bgInner: string
  bgOuter: string
  grid: string
  themeId: string
  /** Foreground mark color. Mirrored into `palette.ink` for convenience. */
  ink: string
  /** False on print media — the renderer must not bloom marks on light stock. */
  luminous: boolean
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
    // Hunters share the hazard hue and are told apart by silhouette.
    hunter: theme.colors.hostile,
    hunterLight: theme.colors.hostileLight,
    // Foreground marks follow the medium: dark on paper, pale on a tube.
    ink: theme.colors.ink,
    text: theme.colors.ink,
    muted: theme.colors.muted,
    // In-canvas panels sit on the theme's own sheet, so overlays never render
    // a dark chassis on light stock (or the reverse).
    panel: theme.colors.sheet,
    void: theme.colors.bgOuter,
    white: theme.colors.ink,
    warn: theme.colors.playerLight,
  }

  if (skinUnlocked && skin?.color) {
    palette.player = skin.color
    palette.playerLight = skin.light ?? skin.color
  }

  return {
    palette,
    bgInner: theme.colors.bgInner,
    bgOuter: theme.colors.bgOuter,
    grid: theme.colors.grid,
    themeId: theme.id,
    ink: theme.colors.ink,
    luminous: theme.luminous,
  }
}

export function activeTrailStyle(): TrailStyle {
  const settings = loadSettings()
  const trail = trailStyles.find((t) => t.id === settings.trailId)
  return trail && isConditionMet(trail.unlock) ? trail : trailStyles[0]
}
