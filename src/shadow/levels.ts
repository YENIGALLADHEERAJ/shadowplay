import { LEVEL_DATA } from './level-data.js';
import type { HandPose } from './pose-match.js';
import type { Shape } from './shapes.js';

export interface Level {
  id: string;
  /** What the shadow becomes when matched. */
  creature: string;
  /** One short line shown after the match. */
  reveal: string;
  /** Hand pose(s) to match: one entry per hand. */
  pose: HandPose[];
  /** Silhouette drawn as the ghost hint and the creature that comes alive. */
  target: Shape[];
  /** Pose score needed to count as a match (0..1). */
  threshold: number;
}

const THRESHOLD = 0.8;

export const LEVELS: Level[] = LEVEL_DATA.map((d) => ({ ...d, threshold: THRESHOLD }));
