/**
 * Bounce Ball — board size, the fixed step and the feel numbers (docs/kaito-web/bounce-ball.md#규칙).
 *
 * Units are tiles (one tile = 1) and seconds. The page draws a tile with an 18 px pixel-art sprite; the rules never see pixels.
 * y grows downward: row 0 is the top of the room.
 */

/** Room width and height in tiles. Portrait, so a phone shows the whole room. */
export const COLS = 18;
export const ROWS = 28;

/** The rules advance in fixed steps of 1/120 s. A trace counts steps. */
export const STEPS_PER_SECOND = 120;
export const STEP_SECONDS = 1 / STEPS_PER_SECOND;

/** Milliseconds for a number of steps, rounded down. */
export const stepsToMs = (steps: number): number => Math.floor((steps * 1000) / STEPS_PER_SECOND);

export const TUNE = Object.freeze({
  /** Ball radius. The ball collides with solid tiles as a square of this half-size. */
  radius: 0.3,
  gravity: 42,
  maxFall: 24,
  /** Upward speed after a plain bounce: about 2.5 tiles high. */
  bounce: 14.6,
  /** Jump block `2`: about 5.5 tiles high. */
  jump: 21.5,
  /** Spring `s`: about 8.4 tiles high. */
  spring: 26.5,
  /** Steering: top speed, push toward it, push when reversing, slow-down with no input. */
  runSpeed: 6.4,
  accel: 38,
  brake: 80,
  drag: 14,
  /** Arrow blocks `<` `>` throw the ball sideways in a straight line at this speed. */
  dashSpeed: 11,
  /** Wall kick: press away from a wall you just touched. */
  kickSpeedX: 6.4,
  kickSpeedY: 15.5,
  /** Steps after a wall touch in which pressing away still kicks. */
  kickWindowSteps: 12,
  /** A wall touch without a kick keeps this share of the sideways speed, reversed. */
  wallKeep: 0.35,
  /** Downward speed after hitting a ceiling. */
  ceilingBounce: 2,
  /** Hazard hit circle, as a share of the ball radius (a near miss is a miss). */
  hazardRadiusShare: 0.8,
});
