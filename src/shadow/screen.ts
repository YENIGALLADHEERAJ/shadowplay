import { CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import { drawShapes, type Shape } from './shapes.js';

/**
 * The glowing paper screen: draws lamp light, the target ghost and the live
 * hand shadow into a canvas texture.
 */
export class PaperScreen {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private w: number;
  private h: number;
  private paper: CanvasGradient;

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
    const cy = this.h * 0.55;
    this.paper = this.ctx.createRadialGradient(cx, cy, this.h * 0.05, cx, cy, this.w * 0.62);
    this.paper.addColorStop(0, '#fff3d6');
    this.paper.addColorStop(0.55, '#f2d7a4');
    this.paper.addColorStop(1, '#a8794a');
  }

  /** Paint one frame from the reusable options object. */
  draw(o: DrawOptions): void {
    const { ctx, w, h } = this;
    const { target, shadow, count, progress, glow, softness } = o;

    // Warm lamp pool on paper.
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = this.paper;
    ctx.fillRect(0, 0, w, h);

    // Matched: the silhouette comes alive and hops across the paper.
    if (target && o.alive) {
      ctx.save();
      ctx.translate(o.aliveX * w, o.aliveY * h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ctx.strokeStyle = '#1d140c';
      drawShapes(ctx, target, target.length, w, h);
      ctx.restore();
    } else if (target) {
      // Target ghost: faint when far, warmer as the match improves.
      ctx.globalAlpha = 0.3 + 0.25 * progress;
      ctx.fillStyle = ctx.strokeStyle = progress > 0.85 ? '#7a3d12' : '#8a6a48';
      drawShapes(ctx, target, target.length, w, h);
    }

    // Live hand shadow with a penumbra that grows as hands leave the lamp.
    ctx.globalAlpha = 0.82;
    ctx.filter = `blur(${softness.toFixed(1)}px)`;
    ctx.fillStyle = ctx.strokeStyle = '#1d140c';
    drawShapes(ctx, shadow, count, w, h);
    ctx.filter = 'none';

    if (glow > 0) {
      ctx.globalAlpha = glow * 0.7;
      ctx.fillStyle = '#fff8e8';
      ctx.fillRect(0, 0, w, h);
    }

    // Thin progress line along the bottom edge.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#5a3415';
    ctx.fillRect(0, h - 6, w * Math.min(1, progress), 6);

    if (o.caption) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#3b230f';
      ctx.font = '600 26px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.caption, w * 0.5, 38);
    }
    if (o.subcaption) {
      ctx.globalAlpha = 0.7;
      ctx.font = '20px Georgia, serif';
      ctx.fillText(o.subcaption, w * 0.5, h - 22);
    }
    ctx.globalAlpha = 1;

    this.texture.needsUpdate = true;
  }
}

export interface DrawOptions {
  target: readonly Shape[] | null;
  shadow: readonly Shape[];
  count: number;
  /** 0..1 how close the match is. */
  progress: number;
  /** 0..1 success flash. */
  glow: number;
  /** Shadow blur in canvas pixels. */
  softness: number;
  /** Draw the target as a living, moving creature instead of a ghost. */
  alive: boolean;
  aliveX: number;
  aliveY: number;
  caption: string;
  subcaption: string;
}
