/**
 * Pose matching for Shadowplay.
 *
 * The shadow is what the player sees, but matching on raw silhouette pixels
 * is brittle: thin fingers are a few pixels, and moving the hand toward the
 * lamp rescales everything. Instead each hand is reduced to six numbers:
 * how extended each finger is (thumb..pinky, 0 = curled, 1 = straight) and
 * which way the hand points on the screen. That is independent of position
 * and scale, cleanly separates shadow-puppet poses, and works with either hand.
 */

/** [thumb, index, middle, ring, pinky] extension 0..1, then screen angle (rad). */
export type HandFeatures = Float32Array;
export const FEATURES = 6;
export const ANGLE = 5;

export interface HandPose {
  ext: [number, number, number, number, number];
  /** Screen-space angle of wrist -> middle knuckle, radians (0 = right, +pi/2 = up). */
  angle: number;
}

// Thumb is the least reliable joint chain under hand tracking, so it counts less.
const FINGER_WEIGHT = [0.25, 1, 1, 1, 1];
const WEIGHT_SUM = FINGER_WEIGHT.reduce((a, b) => a + b, 0);
const ANGLE_FREE = (25 * Math.PI) / 180; // no penalty inside this
const ANGLE_ZERO = (70 * Math.PI) / 180; // score reaches 0 here

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/** 0..1 similarity of one tracked hand to one target hand pose. */
export function scoreHand(f: HandFeatures, pose: HandPose): number {
  let err = 0;
  for (let i = 0; i < 5; i++) err += FINGER_WEIGHT[i] * Math.abs(f[i] - pose.ext[i]);
  const fingers = Math.max(0, 1 - (err / WEIGHT_SUM) * 2.2);
  const d = angleDiff(f[ANGLE], pose.angle);
  const dir = d <= ANGLE_FREE ? 1 : Math.max(0, 1 - (d - ANGLE_FREE) / (ANGLE_ZERO - ANGLE_FREE));
  return Math.min(fingers, dir);
}

/**
 * Score the visible hands against a level's target poses.
 * One-hand targets accept either hand; two-hand targets need both hands and
 * take the better of the two left/right assignments.
 */
export function scorePoses(
  left: HandFeatures | null,
  right: HandFeatures | null,
  target: readonly HandPose[],
): number {
  if (target.length === 0) return 0;
  if (target.length === 1) {
    return Math.max(left ? scoreHand(left, target[0]) : 0, right ? scoreHand(right, target[0]) : 0);
  }
  if (!left || !right) return 0;
  const a = Math.min(scoreHand(left, target[0]), scoreHand(right, target[1]));
  const b = Math.min(scoreHand(left, target[1]), scoreHand(right, target[0]));
  return Math.max(a, b);
}
