import { Matrix4, Vector3 } from '@iwsdk/core';
import { ShapePool, type Capsule, type Polygon } from './shapes.js';

/** Where the lamp and the paper screen are, in world space. */
export interface StageFrame {
  lamp: Vector3;
  /** Screen centre. */
  center: Vector3;
  /** Screen normal, pointing back toward the lamp and the player. */
  normal: Vector3;
  /** Screen right and up axes (unit vectors). */
  right: Vector3;
  up: Vector3;
  width: number;
  height: number;
}

const JOINTS = 25;
// WebXR hand joint order: wrist, thumb(4), then index/middle/ring/pinky (5 each).
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
];
for (let f = 0; f < 4; f++) {
  const b = 5 + f * 5;
  BONES.push([0, b], [b, b + 1], [b + 1, b + 2], [b + 2, b + 3], [b + 3, b + 4]);
}
const PALM = [0, 1, 2, 6, 11, 16, 21, 20];
const FLESH = 1.15; // joint radii are a little thinner than the real finger

type HandSide = 'left' | 'right';
const SIDES: HandSide[] = ['left', 'right'];

interface HandCache {
  spaces: XRSpace[];
  poses: Float32Array;
  radii: Float32Array;
}

/**
 * Projects tracked hand joints from a point lamp onto the paper screen and
 * writes the silhouette into a fixed shape pool:
 * per hand, 24 bone capsules followed by one palm polygon.
 */
export class HandShadow {
  readonly pool: ShapePool;
  /** Projected joint positions (u, v) and validity per hand, for effects. */
  readonly uv = { left: new Float32Array(JOINTS * 2), right: new Float32Array(JOINTS * 2) };
  readonly tracked = { left: false, right: false };
  /** Mean distance of tracked hands from the lamp (metres), 0 if none. */
  handToLamp = 0;

  private caches = new WeakMap<XRHand, HandCache>();
  private world = { left: new Float32Array(JOINTS * 3), right: new Float32Array(JOINTS * 3) };
  private radii = { left: new Float32Array(JOINTS), right: new Float32Array(JOINTS) };
  private p = new Vector3();
  private d = new Vector3();
  private s = new Vector3();
  private cl = new Vector3();

  constructor() {
    const layout: ('c' | number)[] = [];
    for (let h = 0; h < 2; h++) {
      for (let i = 0; i < BONES.length; i++) layout.push('c');
      layout.push(PALM.length);
    }
    this.pool = new ShapePool(layout);
    this.hideAll();
  }

  /** Read joints for this frame. Returns true if at least one hand is tracked. */
  read(frame: XRFrame | undefined, ref: XRReferenceSpace | null, player: Matrix4): boolean {
    this.tracked.left = false;
    this.tracked.right = false;
    if (!frame || !ref) return false;
    for (const source of frame.session.inputSources) {
      const hand = source.hand;
      if (!hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
      const side = source.handedness;
      let cache = this.caches.get(hand);
      if (!cache) {
        cache = {
          spaces: Array.from(hand.values()),
          poses: new Float32Array(JOINTS * 16),
          radii: new Float32Array(JOINTS),
        };
        this.caches.set(hand, cache);
      }
      if (cache.spaces.length < JOINTS) continue;
      let ok = false;
      const f = frame as XRFrame & {
        fillPoses(s: XRSpace[], r: XRSpace, out: Float32Array): boolean;
        fillJointRadii(s: XRSpace[], out: Float32Array): boolean;
      };
      try {
        ok =
          f.fillPoses(cache.spaces, ref, cache.poses) &&
          f.fillJointRadii(cache.spaces, cache.radii);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      const out = this.world[side];
      for (let j = 0; j < JOINTS; j++) {
        const o = j * 16;
        this.p.set(cache.poses[o + 12], cache.poses[o + 13], cache.poses[o + 14]).applyMatrix4(player);
        out[j * 3] = this.p.x;
        out[j * 3 + 1] = this.p.y;
        out[j * 3 + 2] = this.p.z;
        this.radii[side][j] = cache.radii[j];
      }
      this.tracked[side] = true;
    }
    return this.tracked.left || this.tracked.right;
  }

  /** Project the last read joints onto the screen and fill the shape pool. */
  project(stage: StageFrame): void {
    let lampDist = 0;
    let lampCount = 0;
    for (let h = 0; h < 2; h++) {
      const side = SIDES[h];
      const base = h * (BONES.length + 1);
      const uv = this.uv[side];
      if (!this.tracked[side]) {
        this.hideHand(base);
        uv.fill(-10);
        continue;
      }
      const wp = this.world[side];
      const rad = this.radii[side];
      // Project every joint once; store (u, v) and the per-joint scale in t.
      for (let j = 0; j < JOINTS; j++) {
        this.p.set(wp[j * 3], wp[j * 3 + 1], wp[j * 3 + 2]);
        const t = this.projectPoint(stage, this.p, uv, j);
        rad[j] = t > 0 ? (rad[j] * FLESH * t) / stage.width : 0;
      }
      this.p.set(wp[0], wp[1], wp[2]);
      lampDist += this.p.distanceTo(stage.lamp);
      lampCount++;

      for (let b = 0; b < BONES.length; b++) {
        const [i, k] = BONES[b];
        const c = this.pool.shapes[base + b] as Capsule;
        if (uv[i * 2] < -1 || uv[k * 2] < -1) {
          c.r = 0;
          continue;
        }
        c.a[0] = uv[i * 2];
        c.a[1] = uv[i * 2 + 1];
        c.b[0] = uv[k * 2];
        c.b[1] = uv[k * 2 + 1];
        c.r = Math.max(rad[i], rad[k]);
      }
      const palm = this.pool.shapes[base + BONES.length] as Polygon;
      let palmOk = true;
      for (let q = 0; q < PALM.length; q++) {
        const j = PALM[q];
        if (uv[j * 2] < -1) palmOk = false;
        palm.pts[q * 2] = uv[j * 2];
        palm.pts[q * 2 + 1] = uv[j * 2 + 1];
      }
      if (!palmOk) palm.pts[0] = -10;
    }
    this.handToLamp = lampCount ? lampDist / lampCount : 0;
  }

  hideAll(): void {
    this.hideHand(0);
    this.hideHand(BONES.length + 1);
  }

  private hideHand(base: number): void {
    for (let b = 0; b < BONES.length; b++) (this.pool.shapes[base + b] as Capsule).r = 0;
    (this.pool.shapes[base + BONES.length] as Polygon).pts[0] = -10;
  }

  /**
   * Central projection from the lamp through p onto the screen plane.
   * Writes (u, v) into out at joint j, or -10 when the point is not between
   * lamp and screen. Returns the magnification t (> 1) or 0.
   */
  private projectPoint(stage: StageFrame, p: Vector3, out: Float32Array, j: number): number {
    this.d.subVectors(p, stage.lamp);
    const dn = this.d.dot(stage.normal);
    this.cl.subVectors(stage.center, stage.lamp);
    const cn = this.cl.dot(stage.normal);
    if (dn > -1e-5 || cn >= 0) {
      out[j * 2] = -10;
      out[j * 2 + 1] = -10;
      return 0;
    }
    const t = cn / dn;
    if (t <= 1.02) {
      out[j * 2] = -10;
      out[j * 2 + 1] = -10;
      return 0;
    }
    this.s.copy(stage.lamp).addScaledVector(this.d, t).sub(stage.center);
    out[j * 2] = this.s.dot(stage.right) / stage.width + 0.5;
    out[j * 2 + 1] = 0.5 - this.s.dot(stage.up) / stage.height;
    return t;
  }
}
