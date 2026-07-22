// Tuning constants for the three multiplayer variants. All times are in
// seconds of sim time (the same clock as runStats.elapsed).

// --- Orb Duel ---
export const DUEL_TARGET_SCORE = 15
export const DUEL_ENEMY_COUNT = 4
export const DUEL_STUN_SECONDS = 0.6
export const DUEL_POST_STUN_IMMUNITY = 1.2
/** impulse away from the hit source; below MP_BASE_MAXVEL so the cap can't eat it */
export const DUEL_KNOCKBACK_SPEED = 420
/** energy kept when a duel puck ricochets off a wall */
export const WALL_BOUNCE_DAMPING = 0.75

// --- Co-op Survival ---
export const COOP_ENEMY_SCALE = 1.35
export const COOP_BLEEDOUT_SECONDS = 6
export const COOP_REVIVE_IMMUNITY = 2.0

// --- Tag ---
export const TAG_ROUND_SECONDS = 90
export const TAG_SWAP_COOLDOWN = 2.0
export const TAG_IT_MAXVEL = 575
export const TAG_IT_ACCEL = 1.15
/** it-time margin under which the round is a draw */
export const TAG_DRAW_MARGIN = 0.5

// --- Shared ---
/** base max velocity, mirrors the single-player cap in GameCanvas */
export const MP_BASE_MAXVEL = 500
/** P1/P2 spawn at (w/3, h/2) and (2w/3, h/2) */
export const MP_SPAWN_X_FRACTIONS: [number, number] = [1 / 3, 2 / 3]
