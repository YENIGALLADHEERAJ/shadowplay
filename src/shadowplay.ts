import {
  AdditiveBlending,
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
  Quaternion,
  SphereGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
  createSystem,
} from '@iwsdk/core';
import { ShadowAudio } from './shadow/audio.js';
import { HandShadow, type StageFrame } from './shadow/hand-shadow.js';
import { LEVELS, animateCreature, type CreatureTransform } from './shadow/levels.js';
import { scorePoses, type HandPose } from './shadow/pose-match.js';
import { Progress } from './shadow/progress.js';
import { PaperScreen, shapeBounds, type DrawOptions, type ShelfItem } from './shadow/screen.js';

// Paper screen, used when no wall is in front of the player.
const PAPER_W = 0.9;
const PAPER_H = 0.6;
const PAPER_AHEAD = 0.85; // metres in front of the eyes
// Wall mode: a real wall straight ahead becomes the screen.
const WALL_MIN = 0.7;
const WALL_MAX = 4.5;
const WALL_FACING = 0.72; // |cos| between view direction and wall normal
const WALL_W_MAX = 3.0;
const WALL_MAGNIFY = 7; // max shadow size / hand size on a wall
const REPLACE_WINDOW = 6; // seconds after placing during which a newly found wall wins
// Lamp: just ahead of and below the chin.
const LAMP_AHEAD = 0.1;
const LAMP_BELOW = 0.3;
// Where a seated player comfortably raises a hand, relative to the eyes.
const HAND_AHEAD = 0.35;
const HAND_BELOW = 0.25;

const HOLD_TO_MATCH = 0.5; // seconds above threshold
const CELEBRATE = 2.6; // seconds of the creature coming alive
const HINT_AFTER = 7; // seconds of trying before the hint appears
const ARM_BELOW = 0.6; // fraction of threshold the score must drop under first

const CAPTURE_CYCLE = 6; // seconds per capture countdown
const CAPTURE_SHOW = 1.5; // seconds a saved capture stays on screen
const CAPTURE_MODE = new URLSearchParams(location.search).has('capture');

type Phase = 'waiting' | 'playing' | 'alive' | 'capture';
type Mode = 'paper' | 'wall';

/**
 * Shadowplay core loop. A lamp sits below the seated player's chin and its
 * light falls on a real wall ahead (or a paper screen when there is none).
 * Tracked hands cast shadows; matching a level's hand pose brings its
 * shadow creature to life and adds it to the shelf. Each day starts with a
 * "shadow of the day" that keeps a streak going.
 */
export class ShadowplaySystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private screenRoot!: Group;
  private lampRoot!: Group;
  private paperMesh!: Mesh;
  private paperMat!: MeshBasicMaterial;
  private frame!: Group;
  private beam!: Mesh;
  private screen!: PaperScreen;
  private hands!: HandShadow;
  private stage!: StageFrame;
  private draw!: DrawOptions;
  private audio!: ShadowAudio;
  private progress!: Progress;
  private shelf!: ShelfItem[];
  private creature: CreatureTransform = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };

  private placed = false;
  private mode: Mode = 'paper';
  private wallDist = 0;
  private placedAt = 0;
  private planesSeen = 0;
  private sessionTime = 0;
  private refSpace: XRReferenceSpace | null = null;

  private phase: Phase = 'waiting';
  private level = 0;
  private isDaily = false;
  private score = 0;
  private smooth = 0;
  private held = 0;
  private phaseTime = 0;
  private tryTime = 0;
  private armed = false;
  private captures = 0;
  private captureDue = false;

  private head = new Vector3();
  private fwd = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private normal = new Vector3();
  private wallPoint = new Vector3();
  private quat = new Quaternion();
  private basis = new Matrix4();
  private upAxis = new Vector3(0, 1, 0);

  init(): void {
    this.hands = new HandShadow();
    this.screen = new PaperScreen(PAPER_W / PAPER_H, 512);
    this.audio = new ShadowAudio();
    this.progress = new Progress(LEVELS.map((l) => l.id));
    this.stage = {
      lamp: new Vector3(),
      center: new Vector3(),
      normal: new Vector3(),
      right: new Vector3(),
      up: new Vector3(0, 1, 0),
      width: PAPER_W,
      height: PAPER_H,
    };
    this.shelf = LEVELS.map((l) => ({
      shapes: l.target,
      ...shapeBounds(l.target),
      found: false,
      today: false,
    }));
    this.draw = {
      wall: false,
      target: null,
      shadow: this.hands.pool.shapes,
      count: this.hands.pool.count,
      progress: 0,
      glow: 0,
      alive: false,
      aliveX: 0,
      aliveY: 0,
      aliveRot: 0,
      aliveSX: 1,
      aliveSY: 1,
      pivotX: 0.5,
      pivotY: 0.5,
      caption: '',
      subcaption: '',
      shelf: CAPTURE_MODE ? [] : this.shelf,
    };

    this.buildStage();
    this.refreshShelf();
    this.startLevel(this.chooseOpeningLevel());

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        const immersive = state !== VisibilityState.NonImmersive;
        this.screenRoot.visible = this.lampRoot.visible = immersive && this.placed;
        if (!immersive) {
          // New session next time: re-place and start with the day's shadow.
          this.placed = false;
          this.sessionTime = 0;
          this.audio.silenceHum();
          if (this.phase !== 'alive') this.startLevel(this.chooseOpeningLevel());
        }
        if (state === VisibilityState.VisibleBlurred) this.audio.silenceHum();
      }),
    );

    // Audio needs a user gesture: any pointer press, or a pinch in XR.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    const onSessionStart = () => {
      this.audio.unlock();
      const session = this.renderer.xr.getSession();
      session?.addEventListener('select', unlock);
      session?.addEventListener('squeeze', unlock);
    };
    this.renderer.xr.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', unlock),
      () => this.renderer.xr.removeEventListener('sessionstart', onSessionStart),
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
        daily: this.isDaily,
        score: Number(this.score.toFixed(3)),
        placed: this.placed,
        mode: this.mode,
        wallDist: Number(this.wallDist.toFixed(2)),
        armed: this.armed,
        found: this.progress.foundCount(),
        streak: this.progress.streak(),
        captures: this.captures,
        hands: { ...this.hands.tracked },
        caption: this.draw.caption,
        subcaption: this.draw.subcaption,
      }),
      next: () => this.startLevel(this.level + 1),
      recenter: () => (this.placed = false),
      planes: () =>
        [...this.queries.planes.entities].map((e) => {
          const raw = e.getValue(XRPlane, '_plane') as
            | { orientation?: string; semanticLabel?: string }
            | undefined;
          const o = e.object3D!;
          const p = o.getWorldPosition(new Vector3());
          const n = new Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new Quaternion()));
          const r = (v: Vector3) => [v.x, v.y, v.z].map((x) => Math.round(x * 100) / 100);
          return { o: raw?.orientation, label: raw?.semanticLabel, pos: r(p), n: r(n) };
        }),
      resetProgress: () => {
        this.progress.reset();
        this.refreshShelf();
        this.startLevel(this.chooseOpeningLevel());
      },
      capture: () => JSON.stringify(this.hands.pool.snapshot()),
      pose: () => JSON.stringify(this.currentPoses()),
    };
  }

  update(delta: number): void {
    const vis = this.world.visibilityState.peek();
    if (vis === VisibilityState.NonImmersive || vis === VisibilityState.Hidden) return;
    if (vis === VisibilityState.VisibleBlurred) return; // paused (system menu etc.)

    this.sessionTime += delta;
    this.watchRecenter();
    if (!this.placed) {
      this.place();
    } else if (
      this.mode === 'paper' &&
      this.sessionTime - this.placedAt < REPLACE_WINDOW &&
      this.queries.planes.entities.size > this.planesSeen
    ) {
      // Room planes arrive a moment after the session starts: prefer a wall.
      this.planesSeen = this.queries.planes.entities.size;
      this.place();
    }

    this.player.updateMatrixWorld();
    this.hands.read(this.xrFrame, this.refSpace, this.player.matrixWorld);
    this.hands.project(this.stage);

    const level = LEVELS[this.level];
    this.phaseTime += delta;
    const anyHand =
      (this.hands.tracked.left && this.hands.onScreen.left) ||
      (this.hands.tracked.right && this.hands.onScreen.right);

    if (this.phase === 'playing' || this.phase === 'waiting') {
      this.score = this.poseScore();
      this.phase = anyHand ? 'playing' : 'waiting';
      if (anyHand) this.tryTime += delta;
      // A level only accepts a match once the hand has left the pose, so one
      // held pose cannot clear several levels in a row.
      if (!this.armed && this.score < level.threshold * ARM_BELOW) this.armed = true;
      const p = this.armed ? Math.min(1, this.score / level.threshold) : 0;
      this.smooth += (p - this.smooth) * Math.min(1, delta * 6);
      if (this.armed && this.score >= level.threshold) this.held += delta;
      else this.held = Math.max(0, this.held - delta * 2);
      if (this.held >= HOLD_TO_MATCH) this.becomeAlive();
      this.audio.setHum(anyHand ? 0.3 + 0.7 * this.smooth : 0);
    } else if (this.phase === 'alive') {
      animateCreature(level.motion, this.phaseTime, CELEBRATE, this.creature);
      this.draw.aliveX = this.creature.x;
      this.draw.aliveY = this.creature.y;
      this.draw.aliveRot = this.creature.rot;
      this.draw.aliveSX = this.creature.sx;
      this.draw.aliveSY = this.creature.sy;
      this.draw.glow = Math.max(0, 1 - this.phaseTime * 2.5);
      this.audio.setHum(0.2);
      if (this.phaseTime >= CELEBRATE) this.startLevel(this.nextLevel());
    } else if (this.phase === 'capture') {
      this.updateCapture();
    }

    if (this.phase !== 'capture') {
      this.draw.progress = this.phase === 'alive' ? 1 : this.smooth;
      this.updateCaptions();
    }
    this.screen.draw(this.draw);
  }

  // ---------------------------------------------------------------- flow

  /** Today's shadow first; then the first creature not yet found. */
  private chooseOpeningLevel(): number {
    if (CAPTURE_MODE) return 0;
    if (!this.progress.dailyDone() && this.progress.foundCount() > 0) {
      this.isDaily = true;
      return this.progress.dailyLevel();
    }
    this.isDaily = false;
    const next = this.progress.firstUnfound();
    return next >= 0 ? next : 0;
  }

  private nextLevel(): number {
    const wasDaily = this.isDaily;
    this.isDaily = false;
    const next = this.progress.firstUnfound();
    if (next >= 0) return next;
    // Collection complete: the daily (if not done) or free play in order.
    if (!this.progress.dailyDone()) {
      this.isDaily = true;
      return this.progress.dailyLevel();
    }
    return wasDaily ? 0 : this.level + 1;
  }

  private startLevel(i: number): void {
    this.level = ((i % LEVELS.length) + LEVELS.length) % LEVELS.length;
    const level = LEVELS[this.level];
    const b = this.shelf[this.level];
    this.draw.target = level.target;
    this.draw.pivotX = b.cx;
    this.draw.pivotY = b.cy;
    this.draw.alive = false;
    this.draw.glow = 0;
    this.phase = CAPTURE_MODE ? 'capture' : 'waiting';
    this.phaseTime = 0;
    this.tryTime = 0;
    this.held = 0;
    this.smooth = 0;
    this.armed = false;
    // Measure now: a stale 0 would arm the level while the old pose is held.
    this.score = this.poseScore();
    this.refreshShelf();
  }

  private becomeAlive(): void {
    const level = LEVELS[this.level];
    this.phase = 'alive';
    this.phaseTime = 0;
    this.draw.alive = true;
    this.draw.glow = 1;
    const wasDaily = this.isDaily;
    this.progress.markFound(level.id, wasDaily);
    this.refreshShelf();
    this.audio.playReveal(this.level);
    if (wasDaily) this.audio.playDaily();
  }

  private updateCaptions(): void {
    const level = LEVELS[this.level];
    const name = level.creature.toLowerCase();
    const found = this.progress.foundCount();
    const total = LEVELS.length;
    const d = this.draw;
    if (this.phase === 'alive') {
      d.caption = `${level.creature}!`;
      if (this.isDaily) {
        const s = this.progress.streak();
        d.subcaption = `Shadow of the day: ${s}-day streak. See you tomorrow.`;
      } else {
        d.subcaption = found === total ? 'Every shadow found!' : `${found} of ${total} shadows found`;
      }
      return;
    }
    if (this.phase === 'waiting') {
      d.caption = 'Raise a hand into the lamplight';
      const s = this.progress.streak();
      d.subcaption = s > 0 ? `${s}-day streak · ${found} of ${total} found` : '';
      return;
    }
    d.caption = this.isDaily ? `Shadow of the day: the ${name}` : `Make the ${name}`;
    d.subcaption = this.tryTime > HINT_AFTER || this.level === 0 ? level.hint : '';
  }

  private refreshShelf(): void {
    for (let i = 0; i < LEVELS.length; i++) {
      this.shelf[i].found = this.progress.isFound(LEVELS[i].id);
      this.shelf[i].today = !this.progress.dailyDone() && i === this.progress.dailyLevel();
    }
  }

  // ------------------------------------------------------------ matching

  /** How well the hands casting shadows on the screen match this level's pose. */
  private poseScore(): number {
    const h = this.hands;
    const left = h.tracked.left && h.onScreen.left ? h.features.left : null;
    const right = h.tracked.right && h.onScreen.right ? h.features.right : null;
    return scorePoses(left, right, LEVELS[this.level].pose);
  }

  /** Pose features of the hands whose shadows are on the screen (for captures). */
  private currentPoses(): HandPose[] {
    const out: HandPose[] = [];
    for (const side of ['left', 'right'] as const) {
      if (!this.hands.tracked[side] || !this.hands.onScreen[side]) continue;
      const f = this.hands.features[side];
      const r = (v: number) => Math.round(v * 100) / 100;
      out.push({ ext: [r(f[0]), r(f[1]), r(f[2]), r(f[3]), r(f[4])], angle: r(f[5]) });
    }
    return out;
  }

  // ------------------------------------------------------------- capture

  /**
   * ?capture mode: a repeating countdown saves the current shadow and pose
   * as a level target, to the dev server (captures/*.json) and the console.
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
    this.draw.alive = false;
    this.draw.caption = `Saved #${this.captures}`;
    this.draw.subcaption = 'Next one in a moment';
    this.draw.glow = 0.6;
    const body = JSON.stringify({
      n: this.captures,
      at: new Date().toISOString(),
      pose: this.currentPoses(),
      shapes,
    });
    console.log('[shadowplay capture]', body);
    fetch(`${import.meta.env.BASE_URL}__capture`, { method: 'POST', body }).catch(() => {});
    this.audio.playReveal(this.captures);
  }

  // ----------------------------------------------------------- placement

  /** Re-place the stage when the user recenters their view (Meta button hold). */
  private watchRecenter(): void {
    const ref = this.renderer.xr.getReferenceSpace();
    if (ref === this.refSpace) return;
    this.refSpace = ref;
    ref?.addEventListener('reset', () => {
      this.placed = false;
    });
  }

  /** Put lamp and screen in front of the seated player, on a real wall if one is ahead. */
  private place(): void {
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.fwd);
    // Object3D.getWorldDirection returns +Z; the camera looks down -Z.
    this.fwd.negate();
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();

    const s = this.stage;
    const wallT = this.findWall();
    if (wallT > 0) {
      this.mode = 'wall';
      this.wallDist = wallT;
      s.normal.copy(this.normal);
      this.tmp2.copy(this.wallPoint);
      s.right.crossVectors(this.upAxis, s.normal).normalize();
      s.up.crossVectors(s.normal, s.right).normalize();
    } else {
      this.mode = 'paper';
      this.wallDist = 0;
      s.right.crossVectors(this.fwd, this.upAxis).normalize();
      s.up.copy(this.upAxis);
      s.normal.copy(this.fwd).negate();
      this.tmp2.copy(this.head).addScaledVector(this.fwd, PAPER_AHEAD);
    }
    // A low lamp throws the shadow up above the hands, so the player's own
    // hands never hide it. For a far wall it moves back (behind the chin, as
    // in real shadow puppetry) to keep the shadow at most WALL_MAGNIFY times
    // the hand's size, so the whole pose fits in the light.
    const back =
      this.mode === 'wall'
        ? Math.max(-LAMP_AHEAD, (wallT - HAND_AHEAD * WALL_MAGNIFY) / (WALL_MAGNIFY - 1))
        : -LAMP_AHEAD;
    s.lamp
      .copy(this.head)
      .addScaledVector(this.fwd, -back)
      .addScaledVector(this.upAxis, -LAMP_BELOW);

    // Centre the screen where a comfortably raised hand casts its shadow.
    this.tmp
      .copy(this.head)
      .addScaledVector(this.fwd, HAND_AHEAD)
      .addScaledVector(this.upAxis, -HAND_BELOW)
      .sub(s.lamp);
    const reachT = this.tmp2.sub(s.lamp).dot(s.normal) / this.tmp.dot(s.normal);
    s.center.copy(s.lamp).addScaledVector(this.tmp, reachT).addScaledVector(s.normal, 0.01);
    if (this.mode === 'wall') {
      // reachT is the magnification of a hand at the comfortable position.
      s.width = Math.min(WALL_W_MAX, Math.max(PAPER_W, reachT * 0.5));
      s.height = s.width / (PAPER_W / PAPER_H);
    } else {
      s.width = PAPER_W;
      s.height = PAPER_H;
    }

    // Screen: root at the centre, local +Z toward the player.
    this.basis.makeBasis(s.right, s.up, s.normal);
    this.screenRoot.position.copy(s.center);
    this.screenRoot.quaternion.setFromRotationMatrix(this.basis);
    this.paperMesh.scale.set(s.width, s.height, 1);
    const wall = this.mode === 'wall';
    this.frame.visible = !wall;
    if (this.paperMat.transparent !== wall) {
      this.paperMat.transparent = wall;
      this.paperMat.depthWrite = !wall;
      this.paperMat.needsUpdate = true;
    }
    this.draw.wall = wall;

    // Lamp points at the screen; the beam stretches to reach it.
    this.lampRoot.position.copy(s.lamp);
    this.lampRoot.lookAt(s.center);
    const reach = s.lamp.distanceTo(s.center);
    this.beam.scale.set(s.width * 0.9, s.width * 0.9, reach);

    this.screenRoot.visible = this.lampRoot.visible = true;
    this.placed = true;
    this.placedAt = this.sessionTime;
    this.planesSeen = this.queries.planes.entities.size;
  }

  /**
   * Nearest vertical plane straight ahead and roughly facing the player.
   * On success returns the distance along the view ray, leaves the wall
   * normal (toward the player) in this.normal and a point on it in wallPoint.
   */
  private findWall(): number {
    let best = -1;
    for (const e of this.queries.planes.entities) {
      const obj = e.object3D;
      if (!obj) continue;
      const raw = e.getValue(XRPlane, '_plane') as
        | { orientation?: string; semanticLabel?: string }
        | undefined;
      const label = raw?.semanticLabel ?? '';
      if (raw?.orientation !== 'vertical' && label !== 'wall') continue;
      if (label && label !== 'wall' && label !== 'other') continue; // skip doors, windows
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(this.tmp);
      obj.getWorldQuaternion(this.quat);
      const n = this.tmp2.set(0, 1, 0).applyQuaternion(this.quat);
      // Face the normal toward the player.
      if (n.dot(this.head.clone().sub(this.tmp)) < 0) n.negate();
      const facing = this.fwd.dot(n);
      if (facing > -WALL_FACING) continue;
      const t = this.tmp.clone().sub(this.head).dot(n) / facing;
      if (t < WALL_MIN || t > WALL_MAX || (best > 0 && t >= best)) continue;
      // The view ray must land inside the plane's extents.
      const hit = this.head.clone().addScaledVector(this.fwd, t);
      const local = obj.worldToLocal(hit.clone());
      const mesh = obj as Mesh;
      const geo = mesh.geometry;
      if (geo) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        if (Math.abs(local.x) > bb.max.x + 0.15 || Math.abs(local.z) > bb.max.z + 0.15) continue;
      }
      best = t;
      this.normal.copy(n);
      this.wallPoint.copy(this.tmp);
    }
    return best;
  }

  private buildStage(): void {
    // Screen: a unit plane scaled to the current screen size.
    const screenRoot = new Group();
    screenRoot.name = 'shadowplay-screen';
    screenRoot.visible = false;
    this.paperMat = new MeshBasicMaterial({ map: this.screen.texture, toneMapped: false });
    this.paperMesh = new Mesh(new PlaneGeometry(1, 1), this.paperMat);
    this.paperMesh.name = 'paper-screen';
    screenRoot.add(this.paperMesh);

    const frame = new Group();
    frame.name = 'paper-frame';
    const wood = new MeshStandardMaterial({ color: 0x3a2414, roughness: 0.7 });
    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.02), wood);
      m.position.set(x, y, -0.006);
      frame.add(m);
    };
    const t = 0.025;
    bar(PAPER_W + t * 2, t, 0, PAPER_H / 2 + t / 2);
    bar(PAPER_W + t * 2, t, 0, -PAPER_H / 2 - t / 2);
    bar(t, PAPER_H, -PAPER_W / 2 - t / 2, 0);
    bar(t, PAPER_H, PAPER_W / 2 + t / 2, 0);
    screenRoot.add(frame);
    this.frame = frame;

    // Lamp: local +Z points at the screen (Object3D.lookAt convention).
    const lamp = new Group();
    lamp.name = 'lamp';
    lamp.visible = false;
    const brass = new MeshStandardMaterial({
      color: 0xb08a4a,
      metalness: 0.6,
      roughness: 0.35,
      side: DoubleSide,
    });
    const shadeGeo = new ConeGeometry(0.045, 0.06, 24, 1, true);
    shadeGeo.rotateX(-Math.PI / 2); // opening toward +Z
    lamp.add(new Mesh(shadeGeo, brass));
    const bulb = new Mesh(
      new SphereGeometry(0.018, 16, 12),
      new MeshBasicMaterial({ color: 0xfff1c9, toneMapped: false }),
    );
    bulb.position.z = 0.012;
    lamp.add(bulb);
    const stem = new Mesh(new CylinderGeometry(0.006, 0.006, 0.12, 8), brass);
    stem.position.set(0, -0.07, -0.01);
    lamp.add(stem);
    // Soft beam: unit cone, tip at the lamp, base 1 m ahead; scaled per placement.
    const beamGeo = new ConeGeometry(0.5, 1, 32, 1, true);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);
    this.beam = new Mesh(
      beamGeo,
      new MeshBasicMaterial({
        color: 0xffe2a8,
        transparent: true,
        opacity: 0.045,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    lamp.add(this.beam);

    this.screenRoot = screenRoot;
    this.lampRoot = lamp;
    this.world.createTransformEntity(screenRoot);
    this.world.createTransformEntity(lamp);
  }
}
