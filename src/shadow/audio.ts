/**
 * Small Web Audio synth for Shadowplay, so there are no audio files to load
 * or license: a soft lamp hum while hands are in the light, a rising tick as
 * a match gets close, and a short arpeggio when a shadow comes alive (each
 * creature gets its own notes).
 */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class ShadowAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humTarget = 0;

  /** Create or resume the audio context; call from any user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        this.startHum();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** 0..1: how strongly the lamp hums (hands in the light, match closeness). */
  setHum(level: number): void {
    if (!this.ctx || !this.humGain) return;
    const target = 0.02 + 0.05 * Math.max(0, Math.min(1, level));
    if (Math.abs(target - this.humTarget) < 0.004) return;
    this.humTarget = target;
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  silenceHum(): void {
    if (!this.ctx || !this.humGain) return;
    this.humTarget = 0;
    this.humGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  /** A short, rising arpeggio unique to the creature at this index. */
  playReveal(index: number): void {
    if (!this.ctx || !this.master) return;
    const base = 220 * Math.pow(2, (index % 5) / 12);
    const t0 = this.ctx.currentTime + 0.02;
    for (let i = 0; i < 4; i++) {
      const step = PENTATONIC[(index + i * 2) % PENTATONIC.length] + i * 2;
      this.pluck(base * Math.pow(2, step / 12), t0 + i * 0.11, 0.9 - i * 0.12);
    }
  }

  /** Brighter flourish for the shadow of the day. */
  playDaily(): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.pluck(f, t0 + 0.5 + i * 0.09, 0.6));
  }

  private pluck(freq: number, at: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.35 * vol, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + 1.2);
  }

  /** Warm two-oscillator drone, filtered low, like an old lamp's transformer. */
  private startHum(): void {
    const ctx = this.ctx!;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    for (const f of [110, 110.7, 165]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    }
    filter.connect(this.humGain).connect(this.master!);
  }
}
