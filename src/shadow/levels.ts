import type { Shape } from './shapes.js';

export interface Level {
  id: string;
  /** What the shadow becomes when matched. */
  creature: string;
  /** One short line shown after the match. */
  reveal: string;
  target: Shape[];
  /** Dice score needed to count as a match (0..1). */
  threshold: number;
}

const cap = (ax: number, ay: number, bx: number, by: number, r: number): Shape => ({
  k: 'c',
  a: [ax, ay],
  b: [bx, by],
  r,
});

/**
 * Starter targets drawn by hand so the loop works in the emulator.
 * They get replaced by shadows captured from real hand poses on a Quest
 * (?capture mode), which guarantees every target is achievable.
 */
export const LEVELS: Level[] = [
  {
    id: 'pebble',
    creature: 'Pebble',
    reveal: 'Any hand works. Move closer to the lamp to grow.',
    // A fist-sized blob: teaches "put your hand in the light" and scale.
    target: [cap(0.5, 0.5, 0.5, 0.52, 0.11)],
    threshold: 0.62,
  },
  {
    id: 'starfish',
    creature: 'Starfish',
    reveal: 'Spread every finger.',
    target: [
      { k: 'p', pts: [0.44, 0.62, 0.56, 0.62, 0.58, 0.5, 0.5, 0.44, 0.42, 0.5] },
      cap(0.5, 0.5, 0.5, 0.2, 0.025),
      cap(0.52, 0.5, 0.66, 0.26, 0.025),
      cap(0.48, 0.5, 0.34, 0.26, 0.025),
      cap(0.55, 0.55, 0.74, 0.46, 0.025),
      cap(0.45, 0.55, 0.28, 0.5, 0.025),
    ],
    threshold: 0.55,
  },
  {
    id: 'rabbit',
    creature: 'Rabbit',
    reveal: 'Two fingers up, the rest tucked in.',
    target: [
      cap(0.5, 0.6, 0.5, 0.62, 0.09),
      cap(0.47, 0.52, 0.43, 0.24, 0.028),
      cap(0.53, 0.52, 0.57, 0.24, 0.028),
    ],
    threshold: 0.55,
  },
];
