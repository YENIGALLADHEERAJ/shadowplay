/**
 * Per-player progress kept on the device: which creatures have been found,
 * and which days the "shadow of the day" was matched (for the streak).
 * Storage can be unavailable (private mode, blocked storage), so every access
 * is guarded and the game works without it.
 */
const KEY = 'shadowplay.progress.v1';

interface Saved {
  found: string[];
  dailyDays: string[];
}

export class Progress {
  private data: Saved = { found: [], dailyDays: [] };

  constructor(private levelIds: readonly string[]) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Saved>;
        this.data.found = Array.isArray(d.found) ? d.found.filter((s) => typeof s === 'string') : [];
        this.data.dailyDays = Array.isArray(d.dailyDays)
          ? d.dailyDays.filter((s) => typeof s === 'string')
          : [];
      }
    } catch {
      // Storage unavailable: play without saving.
    }
  }

  /** Local calendar day as YYYY-MM-DD. */
  static today(now = new Date()): string {
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  /** The same level for everyone on a given day, rotating through all levels. */
  dailyLevel(now = new Date()): number {
    const day = Math.floor(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
    );
    // Skip the tutorial pebble so the daily is always a "real" shadow.
    const pool = this.levelIds.length - 1;
    return 1 + (((day * 5) % pool) + pool) % pool;
  }

  isFound(id: string): boolean {
    return this.data.found.includes(id);
  }

  foundCount(): number {
    return this.levelIds.filter((id) => this.isFound(id)).length;
  }

  dailyDone(now = new Date()): boolean {
    return this.data.dailyDays.includes(Progress.today(now));
  }

  /** Consecutive days, ending today or yesterday, with the daily matched. */
  streak(now = new Date()): number {
    const days = new Set(this.data.dailyDays);
    const d = new Date(now);
    if (!days.has(Progress.today(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(Progress.today(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** First level not found yet, or -1 when the collection is complete. */
  firstUnfound(): number {
    return this.levelIds.findIndex((id) => !this.isFound(id));
  }

  markFound(id: string, daily: boolean): void {
    if (!this.data.found.includes(id)) this.data.found.push(id);
    const today = Progress.today();
    if (daily && !this.data.dailyDays.includes(today)) this.data.dailyDays.push(today);
    this.save();
  }

  reset(): void {
    this.data = { found: [], dailyDays: [] };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage unavailable: progress lasts for this session only.
    }
  }
}
