// OWNER: map agent. One requestAnimationFrame loop per map. Renderers subscribe and mutate
// WebGL paint / SVG attributes directly, so animation never re-renders React.

export type Frame = {
  /** ms since the animator started */
  t: number;
  dt: number;
  /** Simulated clock as currently displayed (tweens towards the store's `now`). */
  displayNowMs: number;
  /** True while the displayed clock is still catching up. */
  clockMoving: boolean;
  reduced: boolean;
};

type Sub = (f: Frame) => void;

export class MapAnimator {
  private subs = new Set<Sub>();
  private raf = 0;
  private start = 0;
  private last = 0;
  private target = 0;
  private display = 0;
  reduced = false;

  constructor(nowMs: number, reduced = false) {
    this.target = nowMs;
    this.display = nowMs;
    this.reduced = reduced;
  }

  get displayNowMs(): number {
    return this.display;
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
  }

  setTarget(nowMs: number) {
    const jump = nowMs - this.display;
    this.target = nowMs;
    // Snap on reset (time moved backwards) or giant leaps; otherwise glide.
    if (this.reduced || jump < 0 || jump > 3 * 864e5) this.display = nowMs;
  }

  subscribe(fn: Sub): () => void {
    this.subs.add(fn);
    if (!this.raf && typeof window !== "undefined") this.loop();
    return () => {
      this.subs.delete(fn);
    };
  }

  private loop() {
    const step = (ts: number) => {
      if (!this.start) this.start = ts;
      const dt = this.last ? Math.min(64, ts - this.last) : 16;
      this.last = ts;
      const gap = this.target - this.display;
      let moving = false;
      if (Math.abs(gap) > 1000) {
        // exponential approach, ~250 ms time constant
        this.display += gap * (1 - Math.exp(-dt / 250));
        moving = true;
      } else {
        this.display = this.target;
      }
      const frame: Frame = { t: ts - this.start, dt, displayNowMs: this.display, clockMoving: moving, reduced: this.reduced };
      for (const s of this.subs) {
        try {
          s(frame);
        } catch {
          // a renderer failing must never kill the loop
        }
      }
      this.raf = this.subs.size ? requestAnimationFrame(step) : 0;
      if (!this.raf) this.last = 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.subs.clear();
  }
}

export const DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export function formatClock(ms: number): { day: string; time: string } {
  const d = new Date(ms);
  // Display in IST regardless of viewer locale — the district operates on IST.
  const ist = new Date(d.getTime() + 5.5 * 3.6e6);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return { day: `${days[ist.getUTCDay()]} ${ist.getUTCDate()} ${months[ist.getUTCMonth()]}`, time: `${hh}:${mm}` };
}
