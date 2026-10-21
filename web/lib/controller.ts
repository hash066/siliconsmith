// Run sources for the console. Replay (NDJSON timed by `t`) and live (SSE) share one snapshot shape
// and one reducer, so every screen renders the same way whichever source is behind it.

import { parseNdjson, type RunEvent } from "./events";
import { applyEvents, initialRunState, type RunState } from "./run-state";

export interface Snapshot {
  mode: "replay" | "live";
  state: RunState;
  /** Current run time in ms (replay clock, or the newest event's t when live). */
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  ended: boolean;
  connection: "connecting" | "open" | "closed" | "error" | null;
}

export interface RunController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setSpeed(speed: number): void;
  destroy(): void;
}

export const SPEEDS = [1, 2, 4, 8, 16] as const;

function upperBound(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

abstract class Base implements RunController {
  protected listeners = new Set<() => void>();
  protected snap!: Snapshot;
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  getSnapshot() {
    return this.snap;
  }
  protected publish(next: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...next };
    for (const l of this.listeners) l();
  }
  abstract play(): void;
  abstract pause(): void;
  abstract seek(t: number): void;
  abstract setSpeed(s: number): void;
  abstract destroy(): void;
  toggle() {
    if (this.snap.playing) this.pause();
    else this.play();
  }
}

export interface ReplayOptions {
  speed?: number;
  autoplay?: boolean;
  /** Restart from the beginning after a pause at the end (landing-page hero). */
  loop?: boolean;
  /** Start position in ms, or "end" to open on the finished run. */
  start?: number | "end";
}

export class ReplayController extends Base {
  private events: RunEvent[];
  private times: number[];
  private idx = 0;
  private state: RunState = initialRunState();
  private raf = 0;
  private last = 0;
  private lastPublish = 0;
  private holdUntil = 0;
  private loop: boolean;
  private duration: number;

  constructor(events: RunEvent[], opts: ReplayOptions = {}) {
    super();
    this.events = events;
    this.times = events.map((e) => e.t);
    this.duration = this.times.at(-1) ?? 0;
    this.loop = !!opts.loop;
    this.snap = {
      mode: "replay",
      state: this.state,
      t: 0,
      duration: this.duration,
      playing: false,
      speed: opts.speed ?? 8,
      ended: false,
      connection: null,
    };
    const start = opts.start === "end" ? this.duration : (opts.start ?? 0);
    this.seek(start);
    if (opts.autoplay && start < this.duration) this.play();
  }

  static fromText(text: string, opts?: ReplayOptions) {
    return new ReplayController(parseNdjson(text).events, opts);
  }

  private apply(t: number) {
    const target = upperBound(this.times, t);
    if (target > this.idx) {
      this.state = applyEvents(this.state, this.events.slice(this.idx, target));
    } else if (target < this.idx) {
      this.state = applyEvents(initialRunState(), this.events.slice(0, target));
    }
    const changed = target !== this.idx;
    this.idx = target;
    return changed;
  }

  private frame = (now: number) => {
    if (!this.snap.playing) return;
    if (this.holdUntil) {
      if (now < this.holdUntil) {
        this.raf = requestAnimationFrame(this.frame);
        return;
      }
      this.holdUntil = 0;
      this.state = initialRunState();
      this.idx = 0;
      this.last = now;
      this.publish({ t: 0, state: this.state, ended: false });
    }
    const dt = Math.min(250, now - this.last);
    this.last = now;
    let t = this.snap.t + dt * this.snap.speed;
    let ended = false;
    if (t >= this.duration) {
      t = this.duration;
      ended = true;
    }
    const changed = this.apply(t);
    if (changed || ended || now - this.lastPublish > 90) {
      this.lastPublish = now;
      this.publish({ t, state: this.state, ended });
    } else {
      this.snap = { ...this.snap, t };
    }
    if (ended) {
      if (this.loop) {
        this.holdUntil = now + 4000;
        this.raf = requestAnimationFrame(this.frame);
      } else this.publish({ playing: false });
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  play() {
    if (typeof window === "undefined") return;
    if (this.snap.t >= this.duration) this.seek(0);
    this.last = performance.now();
    this.publish({ playing: true });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }
  pause() {
    cancelAnimationFrame(this.raf);
    this.holdUntil = 0;
    this.publish({ playing: false });
  }
  seek(t: number) {
    const clamped = Math.max(0, Math.min(this.duration, t));
    this.apply(clamped);
    this.publish({ t: clamped, state: this.state, ended: clamped >= this.duration });
  }
  setSpeed(speed: number) {
    this.publish({ speed });
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }
}

/** Live run over SSE: `${NEXT_PUBLIC_ENGINE_URL}/api/runs/{id}/events`, one event per `data:`. */
export class LiveController extends Base {
  private es: EventSource | null = null;
  private buffer: RunEvent[] = [];
  private raf = 0;
  private state: RunState = initialRunState();

  constructor(url: string) {
    super();
    this.snap = { mode: "live", state: this.state, t: 0, duration: 0, playing: true, speed: 1, ended: false, connection: "connecting" };
    if (typeof window === "undefined") return;
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => this.publish({ connection: "open" });
    es.onerror = () => {
      // EventSource reconnects on its own; the reducer drops duplicates by seq.
      this.publish({ connection: es.readyState === EventSource.CLOSED ? "closed" : "error" });
    };
    es.onmessage = (msg) => {
      try {
        this.buffer.push(JSON.parse(msg.data) as RunEvent);
      } catch {
        return;
      }
      if (!this.raf) this.raf = requestAnimationFrame(this.flush);
    };
  }

  private flush = () => {
    this.raf = 0;
    const batch = this.buffer.sort((a, b) => a.seq - b.seq);
    this.buffer = [];
    this.state = applyEvents(this.state, batch);
    const done = this.state.status === "completed" || this.state.status === "failed";
    if (done) this.es?.close();
    this.publish({ state: this.state, t: this.state.t, duration: this.state.t, ended: done, playing: !done, connection: done ? "closed" : this.snap.connection === "connecting" ? "open" : this.snap.connection });
  };

  play() {}
  pause() {}
  seek() {}
  setSpeed() {}
  destroy() {
    this.es?.close();
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }
}

export const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL ?? "").replace(/\/$/, "");
export const isSafeRunId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);
export const isDemoRun = (id: string | null | undefined) => !!id && id.startsWith("r_mock");
