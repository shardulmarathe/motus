/**
 * Three-font system for Motus:
 *
 * 1. UI Body (Nunito 500-600) — descriptions, rule lists, tutorial instruction body
 * 2. UI Display (Sora 700-800) — home titles, mode buttons, modal headers, in-game HUD
 * 3. Game Arcade (Space Mono) — game over & cataclysm event overlays on canvas
 */

export const FONT_UI_BODY = 'Nunito, sans-serif'
export const FONT_UI_DISPLAY = 'Sora, Nunito, sans-serif'
export const FONT_GAME = '"Space Mono", ui-monospace, "Courier New", monospace'

/** @deprecated use FONT_UI_BODY or FONT_GAME */
export const CANVAS_FONT = FONT_UI_BODY
