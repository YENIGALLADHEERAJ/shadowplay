import { LEVEL_DATA } from './level-data.js';
import type { HandPose } from './pose-match.js';
import type { Shape } from './shapes.js';

/** How a matched shadow comes alive on the wall. */
export type Motion = 'roll' | 'stride' | 'hop' | 'gallop' | 'fly' | 'swim' | 'spin' | 'flutter';

export interface Level {
  id: string;
  /** What the shadow becomes when matched. */
  creature: string;
  /** Short hint shown when the player is stuck. */
  hint: string;
  motion: Motion;
  /** Hand pose(s) to match: one entry per hand. */
  pose: HandPose[];
  /** Silhouette drawn as the ghost hint and the creature that comes alive. */
  target: Shape[];
  /** Pose score needed to count as a match (0..1). */
  threshold: number;
}

const THRESHOLD = 0.8;

const MOTION: Record<string, Motion> = {
  pebble: 'roll',
  heron: 'stride',
  rabbit: 'hop',
  stag: 'gallop',
  seagull: 'fly',
  fish: 'swim',
  starfish: 'spin',
  butterfly: 'flutter',
};

export const LEVELS: Level[] = LEVEL_DATA.map((d) => ({
  id: d.id,
  creature: d.creature,
  hint: d.reveal,
  motion: MOTION[d.id] ?? 'hop',
  pose: d.pose,
  target: d.target,
  threshold: THRESHOLD,
}));

export interface CreatureTransform {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

/**
 * Creature pose at time t (seconds) of its CELEBRATE-long performance.
 * Offsets are in normalized screen units; it leaves the light by the end.
 */
export function animateCreature(motion: Motion, t: number, dur: number, out: CreatureTransform): void {
  const k = Math.min(1, t / dur);
  const ease = k * k;
  out.x = 0;
  out.y = 0;
  out.rot = 0;
  out.sx = 1;
  out.sy = 1;
  switch (motion) {
    case 'roll':
      out.x = ease * 0.8;
      out.rot = ease * 9;
      break;
    case 'stride':
      out.x = ease * 0.9;
      out.y = -Math.abs(Math.sin(t * 5)) * 0.015;
      out.rot = Math.sin(t * 5) * 0.08;
      break;
    case 'hop':
      out.x = ease * 0.9;
      out.y = -Math.abs(Math.sin(t * 7)) * 0.07;
      out.sy = 1 + Math.sin(t * 14) * 0.06;
      break;
    case 'gallop':
      out.x = ease * 1.0;
      out.y = -Math.abs(Math.sin(t * 9)) * 0.04;
      out.rot = Math.sin(t * 9) * 0.1;
      break;
    case 'fly':
      out.x = ease * 0.7;
      out.y = -ease * 0.6;
      out.sy = 0.75 + Math.abs(Math.sin(t * 10)) * 0.35;
      break;
    case 'swim':
      out.x = -ease * 0.9;
      out.y = Math.sin(t * 4) * 0.05;
      out.rot = Math.sin(t * 4) * 0.15;
      break;
    case 'spin':
      out.rot = ease * 7;
      out.sx = out.sy = 1 - ease * 0.8;
      break;
    case 'flutter':
      out.y = -ease * 0.7 + Math.sin(t * 3) * 0.03;
      out.x = Math.sin(t * 2) * 0.1;
      out.sx = 0.35 + Math.abs(Math.cos(t * 12)) * 0.65;
      break;
  }
}
