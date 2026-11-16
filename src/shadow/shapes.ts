/**
 * 2D silhouette primitives in normalized screen space.
 * x: 0 (left) .. 1 (right), y: 0 (top) .. 1 (bottom) of the paper screen.
 * Radii are fractions of screen width.
 *
 * The live hand shadow and every level target use the same primitives and the
 * same drawing code, so a captured shadow can be replayed as a target exactly.
 */
export type Capsule = { k: 'c'; a: [number, number]; b: [number, number]; r: number };
export type Polygon = { k: 'p'; pts: number[] };
export type Shape = Capsule | Polygon;

/** Draw shapes as one filled silhouette into a canvas of any size. */
export function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: readonly Shape[],
  count: number,
  w: number,
  h: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const s = shapes[i];
    if (s.k === 'c') {
      if (s.r <= 0) continue;
      ctx.lineWidth = Math.max(1, s.r * 2 * w);
      ctx.beginPath();
      ctx.moveTo(s.a[0] * w, s.a[1] * h);
      ctx.lineTo(s.b[0] * w, s.b[1] * h);
      ctx.stroke();
    } else {
      const p = s.pts;
      if (p.length < 6 || p[0] < -1) continue; // pts[0] < -1 marks "hidden"
      ctx.beginPath();
      ctx.moveTo(p[0] * w, p[1] * h);
      for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j] * w, p[j + 1] * h);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Pre-sized pool of mutable shapes for the live shadow (no per-frame allocation). */
export class ShapePool {
  readonly shapes: Shape[] = [];
  count = 0;

  /** layout: one entry per shape, either 'c' or the point count of a polygon. */
  constructor(layout: readonly ('c' | number)[]) {
    for (const l of layout) {
      this.shapes.push(
        l === 'c'
          ? { k: 'c', a: [0, 0], b: [0, 0], r: 0 }
          : { k: 'p', pts: new Array<number>(l * 2).fill(0) },
      );
    }
    this.count = this.shapes.length;
  }

  /** Deep copy of the currently used shapes, rounded for compact JSON. */
  snapshot(): Shape[] {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const out: Shape[] = [];
    for (let i = 0; i < this.count; i++) {
      const s = this.shapes[i];
      if (s.k === 'c') {
        if (s.r <= 0) continue;
        out.push({ k: 'c', a: [r(s.a[0]), r(s.a[1])], b: [r(s.b[0]), r(s.b[1])], r: r(s.r) });
      } else {
        if (s.pts[0] < -1) continue;
        out.push({ k: 'p', pts: s.pts.map(r) });
      }
    }
    return out;
  }
}
