import {
  AdditiveBlending,
  AudioSource,
  AudioUtils,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  VisibilityState,
  createSystem,
  type Entity,
} from '@iwsdk/core';
import { HandShadow, type StageFrame } from './shadow/hand-shadow.js';
import { LEVELS } from './shadow/levels.js';
import { PaperScreen, type DrawOptions } from './shadow/screen.js';

const SCREEN_W = 0.9;
const SCREEN_H = 0.6;
const SCREEN_AHEAD = 0.85; // metres in front of the eyes
const LAMP_AHEAD = 0.1;
const LAMP_BELOW = 0.32;
const HOLD_TO_MATCH = 0.5; // seconds above threshold
const CELEBRATE = 2.6; // seconds of the creature coming alive
const SCORE_EVERY = 3; // frames between mask scores

const ARM_BELOW = 0.6; // fraction of threshold the score must drop under first
const CAPTURE_CYCLE = 6; // seconds per capture countdown
const CAPTURE_SHOW = 1.5; // seconds a saved capture stays on screen
const CAPTURE_MODE = new URLSearchParams(location.search).has('capture');

type Phase = 'waiting' | 'playing' | 'alive' | 'capture';

/**
 * Shadowplay core loop: a lamp and a paper screen in front of the seated
 * player; tracked hands cast shadows; matching the target silhouette brings
 * it to life, then the next level begins.
 */
export class ShadowplaySystem extends createSystem({}) {
  private root!: Group;
  private rootEntity!: Entity;
  private chime!: Entity;
  private screen!: PaperScreen;
  private hands!: HandShadow;
  private stage!: StageFrame;
  private draw!: DrawOptions;

  private placed = false;
  private phase: Phase = 'waiting';
  private level = 0;
  private score = 0;
  private smooth = 0;
  private held = 0;
  private phaseTime = 0;
  private frame = 0;
  private armed = false;
  private captures = 0;
  private captureDue = false;

  private head = new Vector3();
  private fwd = new Vector3();
  private tmp = new Vector3();
  private basis = new Matrix4();
  private upAxis = new Vector3(0, 1, 0);

  init(): void {
    this.hands = new HandShadow();
    this.screen = new PaperScreen(SCREEN_W / SCREEN_H, 512);
    this.stage = {
      lamp: new Vector3(),
      center: new Vector3(),
      normal: new Vector3(),
      right: new Vector3(),
      up: new Vector3(0, 1, 0),
      width: SCREEN_W,
      height: SCREEN_H,
    };
    this.draw = {
      target: null,
      shadow: this.hands.pool.shapes,
      count: this.hands.pool.count,
      progress: 0,
      glow: 0,
      softness: 2,
      alive: false,
      aliveX: 0,
      aliveY: 0,
      caption: '',
      subcaption: '',
    };

    this.buildStage();
    this.startLevel(0);

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const immersive = state !== VisibilityState.NonImmersive;
        this.root.visible = immersive && this.placed;
        if (!immersive) this.placed = false; // re-place on next session
      }),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n') this.startLevel(this.level + 1);
      if (e.key === 'r') this.placed = false;
      if (e.key === 'c' && CAPTURE_MODE) this.saveCapture();
    };
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));

    // Small debug surface for automated checks.
    (window as unknown as { __shadowplay: unknown }).__shadowplay = {
      get: () => ({
        phase: this.phase,
        level: LEVELS[this.level].id,
        score: Number(this.score.toFixed(3)),
        placed: this.placed,
        armed: this.armed,
        captures: this.captures,
        hands: { ...this.hands.tracked },
      }),
      next: () => this.startLevel(this.level + 1),
      recenter: () => (this.placed = false),
      capture: () => JSON.stringify(this.hands.pool.snapshot()),
    };
  }

  update(delta: number): void {
    const vis = this.world.visibilityState.peek();
    if (vis === VisibilityState.NonImmersive || vis === VisibilityState.Hidden) return;
    if (vis === VisibilityState.VisibleBlurred) return; // paused (system menu etc.)

    if (!this.placed) {
      this.placeInFrontOfHead();
      this.root.visible = true;
    }

    const ref = this.renderer.xr.getReferenceSpace();
    this.player.updateMatrixWorld();
    this.hands.read(this.xrFrame, ref, this.player.matrixWorld);
    this.hands.project(this.stage);

    const level = LEVELS[this.level];
    this.phaseTime += delta;
    this.frame++;

    if (this.phase === 'playing' || this.phase === 'waiting') {
      if (this.frame % SCORE_EVERY === 0) {
        this.score = this.screen.score(this.hands.pool.shapes, this.hands.pool.count);
      }
      const anyHand = this.hands.tracked.left || this.hands.tracked.right;
      this.phase = anyHand ? 'playing' : 'waiting';
      // A level only accepts a match once the shadow has left the target,
      // so one held pose cannot clear several levels in a row.
      if (!this.armed && this.score < level.threshold * ARM_BELOW) this.armed = true;
      // Progress shows closeness relative to the threshold, smoothed.
      const p = this.armed ? Math.min(1, this.score / level.threshold) : 0;
      this.smooth += (p - this.smooth) * Math.min(1, delta * 6);
      if (this.armed && this.score >= level.threshold) this.held += delta;
      else this.held = Math.max(0, this.held - delta * 2);
      if (this.held >= HOLD_TO_MATCH) this.becomeAlive();
    } else if (this.phase === 'capture') {
      this.updateCapture();
    } else if (this.phase === 'alive') {
      const t = this.phaseTime / CELEBRATE;
      this.draw.aliveX = t * t * 0.9; // runs off to the right
      this.draw.aliveY = -Math.abs(Math.sin(this.phaseTime * 7)) * 0.06;
      this.draw.glow = Math.max(0, 1 - this.phaseTime * 2.5);
      if (this.phaseTime >= CELEBRATE) this.startLevel(this.level + 1);
    }

    // Penumbra: hands near the lamp give soft, large shadows.
    const dist = this.hands.handToLamp || 0.3;
    this.draw.softness = Math.max(1, Math.min(6, 3.2 / Math.max(0.12, dist)));
    if (this.phase !== 'capture') {
      this.draw.progress = this.phase === 'alive' ? 1 : this.smooth;
      this.draw.caption = this.phase === 'alive' ? `${level.creature}!` : this.captionFor();
      this.draw.subcaption = this.phase === 'alive' ? level.reveal : '';
    }
    this.screen.draw(this.draw);
  }

  /**
   * ?capture mode: a repeating countdown saves the current shadow as a level
   * target. Saves go to the dev server (captures/*.json) and the console.
   */
  private updateCapture(): void {
    this.draw.glow = Math.max(0, this.draw.glow - 0.03);
    const t = this.phaseTime % CAPTURE_CYCLE;
    const showing = t < CAPTURE_SHOW;
    const anyHand = this.hands.tracked.left || this.hands.tracked.right;
    if (!showing) {
      this.draw.target = null;
      const left = Math.ceil(CAPTURE_CYCLE - t);
      this.draw.caption = anyHand ? `Hold your pose… ${left}` : 'Capture mode: raise your hands';
      this.draw.subcaption = `${this.captures} saved`;
      this.draw.progress = t / CAPTURE_CYCLE;
      this.captureDue = true;
    } else if (this.captureDue) {
      this.captureDue = false;
      if (anyHand) this.saveCapture();
    }
  }

  private saveCapture(): void {
    const shapes = this.hands.pool.snapshot();
    this.captures++;
    this.draw.target = shapes;
    this.draw.caption = `Saved #${this.captures}`;
    this.draw.subcaption = 'Next one in a moment';
    this.draw.glow = 0.6;
    const body = JSON.stringify({ n: this.captures, at: new Date().toISOString(), shapes });
    console.log('[shadowplay capture]', body);
    fetch(`${import.meta.env.BASE_URL}__capture`, { method: 'POST', body }).catch(() => {});
    AudioUtils.play(this.chime);
  }

  private captionFor(): string {
    if (this.phase === 'waiting') return 'Raise a hand into the lamplight';
    return `Make the ${LEVELS[this.level].creature.toLowerCase()}`;
  }

  private startLevel(i: number): void {
    this.level = ((i % LEVELS.length) + LEVELS.length) % LEVELS.length;
    const level = LEVELS[this.level];
    this.screen.setTarget(level.target);
    this.draw.target = level.target;
    this.draw.alive = false;
    this.draw.glow = 0;
    this.phase = CAPTURE_MODE ? 'capture' : 'waiting';
    this.phaseTime = 0;
    this.held = 0;
    this.smooth = 0;
    this.armed = false;
    // Measure now: a stale 0 would arm the level while the old pose is held.
    this.score = this.screen.score(this.hands.pool.shapes, this.hands.pool.count);
  }

  private becomeAlive(): void {
    this.phase = 'alive';
    this.phaseTime = 0;
    this.draw.alive = true;
    this.draw.glow = 1;
    AudioUtils.play(this.chime);
  }

  /** Put lamp and screen in a comfortable seated spot in front of the eyes. */
  private placeInFrontOfHead(): void {
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.fwd);
    // Object3D.getWorldDirection returns +Z; the camera looks down -Z.
    this.fwd.negate();
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();

    const s = this.stage;
    s.right.crossVectors(this.fwd, this.upAxis).normalize();
    s.up.copy(this.upAxis);
    s.normal.copy(this.fwd).negate();
    s.center.copy(this.head).addScaledVector(this.fwd, SCREEN_AHEAD).addScaledVector(this.upAxis, -0.06);
    s.lamp.copy(this.head).addScaledVector(this.fwd, LAMP_AHEAD).addScaledVector(this.upAxis, -LAMP_BELOW);

    // Root sits at the screen; its -Z faces away from the player.
    this.basis.makeBasis(s.right, s.up, s.normal);
    this.root.position.copy(s.center);
    this.root.quaternion.setFromRotationMatrix(this.basis);

    // Lamp lives under the root, so convert its world position to root space.
    this.root.updateMatrixWorld(true);
    const lamp = this.root.getObjectByName('lamp')!;
    this.tmp.copy(s.lamp);
    this.root.worldToLocal(this.tmp);
    lamp.position.copy(this.tmp);
    lamp.lookAt(s.center);

    this.placed = true;
  }

  private buildStage(): void {
    const root = new Group();
    root.name = 'shadowplay-stage';
    root.visible = false;

    const paper = new Mesh(
      new PlaneGeometry(SCREEN_W, SCREEN_H),
      new MeshBasicMaterial({ map: this.screen.texture, toneMapped: false }),
    );
    paper.name = 'paper-screen';
    root.add(paper);

    const wood = new MeshStandardMaterial({ color: 0x3a2414, roughness: 0.7 });
    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.02), wood);
      m.position.set(x, y, -0.006);
      root.add(m);
    };
    const t = 0.025;
    bar(SCREEN_W + t * 2, t, 0, SCREEN_H / 2 + t / 2);
    bar(SCREEN_W + t * 2, t, 0, -SCREEN_H / 2 - t / 2);
    bar(t, SCREEN_H, -SCREEN_W / 2 - t / 2, 0);
    bar(t, SCREEN_H, SCREEN_W / 2 + t / 2, 0);

    // Lamp: its local +Z points at the screen (Object3D.lookAt convention).
    const lamp = new Group();
    lamp.name = 'lamp';
    const brass = new MeshStandardMaterial({ color: 0xb08a4a, metalness: 0.6, roughness: 0.35 });
    const shade = new Mesh(new ConeGeometry(0.045, 0.06, 24, 1, true), brass);
    shade.material.side = DoubleSide;
    shade.rotation.x = -Math.PI / 2; // cone opening toward +Z
    lamp.add(shade);
    const bulb = new Mesh(
      new SphereGeometry(0.018, 16, 12),
      new MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false }),
    );
    bulb.position.z = 0.012;
    lamp.add(bulb);
    const stem = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 8), brass);
    stem.position.set(0, -0.07, -0.01);
    lamp.add(stem);
    // Soft beam toward the screen for atmosphere.
    const beam = new Mesh(
      new ConeGeometry(0.42, SCREEN_AHEAD - LAMP_AHEAD, 32, 1, true),
      new MeshBasicMaterial({
        color: 0xffe2a8,
        transparent: true,
        opacity: 0.05,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.z = (SCREEN_AHEAD - LAMP_AHEAD) / 2;
    lamp.add(beam);
    root.add(lamp);

    this.root = root;
    this.rootEntity = this.world.createTransformEntity(root);

    this.chime = this.world.createTransformEntity(new Group(), { parent: this.rootEntity });
    this.chime.addComponent(AudioSource, {
      src: `${import.meta.env.BASE_URL}audio/chime.mp3`,
      positional: false,
      volume: 0.8,
    });
  }
}
