import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import { drawShapes, type Shape } from './shapes.js';

/** Shadow layer resolution as a fraction of the screen canvas: upscaling it softens edges for free. */
const SHADOW_SCALE = 0.25;
const SHELF_H = 46; // canvas pixels reserved for the collection shelf

/**
 * The lit surface: draws lamp light, the target ghost, the live hand shadow,
 * the creature coming alive, captions and the collection shelf into a canvas
 * texture. Two looks:
 * - paper: an opaque warm paper screen in a wooden frame;
 * - wall: a pool of lamplight with transparent edges, so the real wall shows
 *   through passthrough and the shadows appear to land on it.
 */
export class PaperScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private w: number;
  private h: number;
  private paper: CanvasGradient;
  private pool: CanvasGradient;
  private shadowCanvas: HTMLCanvasElement;
  private shadowCtx: CanvasRenderingContext2D;
  private sw: number;
  private sh: number;

  constructor(aspect: number, width = 512) {
    this.w = width;
    this.h = Math.round(width / aspect);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;

    const cx = this.w * 0.5;
    const cy = this.h * 0.5;
    this.paper = this.ctx.createRadialGradient(cx, cy, this.h * 0.05, cx, cy, this.w * 0.62);
    this.paper.addColorStop(0, '#fff3d6');
    this.paper.addColorStop(0.55, '#f2d7a4');
    this.paper.addColorStop(1, '#a8794a');

    this.pool = this.ctx.createRadialGradient(cx, cy, this.h * 0.05, cx, cy, this.w * 0.5);
    this.pool.addColorStop(0, 'rgba(255, 236, 196, 0.78)');
    this.pool.addColorStop(0.6, 'rgba(255, 220, 160, 0.5)');
    this.pool.addColorStop(1, 'rgba(255, 210, 150, 0)');

    this.sw = Math.round(this.w * SHADOW_SCALE);
    this.sh = Math.round(this.h * SHADOW_SCALE);
    this.shadowCanvas = document.createElement('canvas');
    this.shadowCanvas.width = this.sw;
    this.shadowCanvas.height = this.sh;
    this.shadowCtx = this.shadowCanvas.getContext('2d')!;
  }

  /** Paint one frame from the reusable options object. */
  draw(o: DrawOptions): void {
    const { ctx, w, h } = this;
    const { target, progress, glow } = o;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (o.wall) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.pool;
    } else {
      ctx.fillStyle = this.paper;
    }
    ctx.fillRect(0, 0, w, h);

    const ink = o.wall ? '#120c07' : '#1d140c';

    if (target && o.alive) {
      // Matched: the silhouette comes alive and moves in its own way.
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.translate((o.pivotX + o.aliveX) * w, (o.pivotY + o.aliveY) * h);
      ctx.rotate(o.aliveRot);
      ctx.scale(o.aliveSX, o.aliveSY);
      ctx.translate(-o.pivotX * w, -o.pivotY * h);
      ctx.fillStyle = ctx.strokeStyle = ink;
      drawShapes(ctx, target, target.length, w, h);
      ctx.restore();
    } else if (target) {
      // Target ghost: visible but faint, warmer as the match improves.
      ctx.globalAlpha = (o.wall ? 0.22 : 0.3) + 0.25 * progress;
      ctx.fillStyle = ctx.strokeStyle = progress > 0.85 ? '#7a3d12' : '#8a6a48';
      drawShapes(ctx, target, target.length, w, h);
    }

    // Live hand shadow: drawn small, then upscaled with smoothing for a soft
    // penumbra (far cheaper on Quest than a canvas blur filter).
    const s = this.shadowCtx;
    s.clearRect(0, 0, this.sw, this.sh);
    s.fillStyle = s.strokeStyle = ink;
    drawShapes(s, o.shadow, o.count, this.sw, this.sh);
    ctx.globalAlpha = o.wall ? 0.88 : 0.82;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.shadowCanvas, 0, 0, w, h);

    if (glow > 0) {
      ctx.globalAlpha = glow * 0.7;
      ctx.fillStyle = '#fff8e8';
      ctx.fillRect(0, 0, w, h);
    }

    this.drawShelf(o);

    // Thin progress line above the shelf.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#5a3415';
    ctx.fillRect(0, h - SHELF_H - 5, w * Math.min(1, progress), 5);

    // Dark ink with a warm halo stays readable on paper and on any wall colour.
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 241, 214, 0.9)';
    ctx.fillStyle = '#2e1a0b';
    if (o.caption) {
      ctx.globalAlpha = 1;
      ctx.font = '600 28px Georgia, serif';
      ctx.lineWidth = 6;
      ctx.strokeText(o.caption, w * 0.5, 36);
      ctx.fillText(o.caption, w * 0.5, 36);
    }
    if (o.subcaption) {
      ctx.globalAlpha = 0.95;
      ctx.font = '20px Georgia, serif';
      ctx.lineWidth = 5;
      ctx.strokeText(o.subcaption, w * 0.5, h - SHELF_H - 16);
      ctx.fillText(o.subcaption, w * 0.5, h - SHELF_H - 16);
    }
    ctx.globalAlpha = 1;

    this.texture.needsUpdate = true;
  }

  /** Small silhouettes of every creature: found ones dark, unfound ones faint. */
  private drawShelf(o: DrawOptions): void {
    const { ctx, w, h } = this;
    const n = o.shelf.length;
    if (n === 0) return;
    const slot = Math.min(56, (w - 40) / n);
    const x0 = (w - slot * n) / 2;
    const y0 = h - SHELF_H;
    ctx.globalAlpha = o.wall ? 0.25 : 0.18;
    ctx.fillStyle = '#3b230f';
    ctx.fillRect(x0 - 8, y0 + 2, slot * n + 16, SHELF_H - 6);
    for (let i = 0; i < n; i++) {
      const item = o.shelf[i];
      ctx.save();
      // Fit the creature's normalized shape into its slot.
      const sx = Math.min(slot - 6, SHELF_H - 10) / w / item.span;
      ctx.translate(x0 + slot * (i + 0.5), y0 + SHELF_H * 0.5);
      ctx.scale(sx, sx);
      ctx.translate(-item.cx * w, -item.cy * h);
      ctx.globalAlpha = item.found ? 0.95 : 0.16;
      ctx.fillStyle = ctx.strokeStyle = item.today ? '#b5651d' : '#1d140c';
      drawShapes(ctx, item.shapes, item.shapes.length, w, h);
      ctx.restore();
    }
  }
}

export interface ShelfItem {
  shapes: readonly Shape[];
  /** Shape centre and largest extent in normalized screen units. */
  cx: number;
  cy: number;
  span: number;
  found: boolean;
  /** The shadow of the day. */
  today: boolean;
}

export interface DrawOptions {
  wall: boolean;
  target: readonly Shape[] | null;
  shadow: readonly Shape[];
  count: number;
  /** 0..1 how close the match is. */
  progress: number;
  /** 0..1 success flash. */
  glow: number;
  /** Draw the target as a living, moving creature instead of a ghost. */
  alive: boolean;
  /** Creature transform: offset (normalized), rotation, scale about its pivot. */
  aliveX: number;
  aliveY: number;
  aliveRot: number;
  aliveSX: number;
  aliveSY: number;
  pivotX: number;
  pivotY: number;
  caption: string;
  subcaption: string;
  shelf: ShelfItem[];
}

/** Centre and largest extent of a shape list, in normalized screen units. */
export function shapeBounds(shapes: readonly Shape[]): { cx: number; cy: number; span: number } {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const add = (x: number, y: number, r: number) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const s of shapes) {
    if (s.k === 'c') {
      add(s.a[0], s.a[1], s.r);
      add(s.b[0], s.b[1], s.r);
    } else {
      for (let i = 0; i < s.pts.length; i += 2) add(s.pts[i], s.pts[i + 1], 0);
    }
  }
  // Span is measured in screen-width units (the screen is 1.5x wider than tall).
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, (y1 - y0) / 1.5, 0.05) };
}
