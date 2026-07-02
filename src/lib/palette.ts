export const palette = {
  void: '#05070f',
  panel: '#0c1220',
  white: '#ffffff',
  text: '#e6eef8',
  muted: '#9fb0c8',
  player: '#2de2e6',
  playerLight: '#a7f7ff',
  orb: '#7bffb2',
  orbDeep: '#23c876',
  hostile: '#ff4d6d',
  hostileLight: '#ff9aac',
  hunter: '#b06bff',
  hunterLight: '#dfc2ff',
  warn: '#ffcf5c',
}

export function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
