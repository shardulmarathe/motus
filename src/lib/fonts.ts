/**
 * Two-family type system for Motus ("Signal Lab").
 *
 * 1. Archivo (variable, wdth 62–125 / wght 400–800) — one family covering two
 *    roles. Set at wdth 125 it is an expanded grotesque, the typography of
 *    control-panel labels; at wdth 100 it is the body face.
 * 2. IBM Plex Mono — every number, label, timecode and telemetry readout, and
 *    ALL canvas text.
 *
 * Canvas text is mono by design: `ctx.font` cannot reliably carry
 * `font-stretch`, so the expanded display width lives in CSS only and the
 * arena speaks entirely in instrument readouts.
 */

/** Body copy — Archivo at normal width. */
export const FONT_BODY = 'Archivo, system-ui, sans-serif'

/** Display — Archivo; the expanded width axis is applied via CSS `font-stretch`. */
export const FONT_DISPLAY = 'Archivo, system-ui, sans-serif'

/** Data, labels, telemetry, and all canvas text. */
export const FONT_DATA = '"IBM Plex Mono", ui-monospace, "Courier New", monospace'

// Legacy aliases. Canvas text should use FONT_DATA; these remain so existing
// call sites keep compiling during the migration.
export const FONT_UI_BODY = FONT_BODY
export const FONT_UI_DISPLAY = FONT_DISPLAY
export const FONT_GAME = FONT_DATA

/** @deprecated use FONT_DATA for canvas text */
export const CANVAS_FONT = FONT_DATA
