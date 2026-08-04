// "Phosphor Scope" palette. Motus presents itself as an instrument measuring a
// body in motion, and the instrument is a long-persistence phosphor tube.
//
// The governing rule is **the beam writes, the phosphor remembers**. The whole
// display is one monochrome green tube: marks, graduations and labels are all
// phosphor at different brightnesses, so brightness is the only hierarchy. Red
// is the one colour the tube cannot produce, which is exactly why it means
// danger and nothing else.
//
// Arena themes (src/lib/customization.ts) swap the medium: other tubes, and
// three genuinely printed instruments (Thermal, Plotter, Blackline) which set
// `luminous: false`. Nothing here may assume either case.

export const palette = {
  // ── Field ──────────────────────────────────────────────────────────────
  /** The screen. */
  void: '#04120a',
  /** Raised surfaces: in-canvas panels and cards. */
  panel: '#0a1f13',
  /**
   * Foreground marks. Printed themes flip this to a dark value, so nothing in
   * the renderer may assume `ink` is bright.
   */
  ink: '#c8ffdf',
  /** Beam centre, the hottest the tube gets. */
  white: '#ffffff',
  text: '#c8ffdf',
  muted: '#6bc98f',

  // ── Signal: the measured body ──────────────────────────────────────────
  player: '#46ff8c',
  playerLight: '#a6ffc6',

  // ── Targets: graduated marks written by the same beam ───────────────────
  orb: '#c8ffdf',
  orbDeep: '#4f9e6d',

  // ── Hazard: the colour the tube cannot make ────────────────────────────
  hostile: '#ff3b21',
  hostileLight: '#ff8566',

  /**
   * Hunters share the hazard colour on purpose, they are differentiated by
   * silhouette (a dashed pursuit ring and a lead line), not by a third hue.
   */
  hunter: '#ff3b21',
  hunterLight: '#ff8566',

  /** Advisory. A hotter phosphor, not a new colour. */
  warn: '#a6ffc6',
}

export function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
