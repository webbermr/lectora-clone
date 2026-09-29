/**
 * Progress of a long-running job (importing, opening or publishing a course),
 * shown by <ProgressWindow>. Only one runs at a time.
 */
import { useSyncExternalStore } from 'react';

export interface TaskState {
  title: string;
  /** Shown under the title, e.g. the zip's file name. */
  subtitle: string;
  steps: string[];
  step: number;
  status: 'running' | 'done' | 'error';
  /** Items finished in the current step, out of `total`. total 0 means "no count yet". */
  done: number;
  total: number;
  /** Overrides done/total for the bar when the step reports its own percentage. */
  percent?: number;
  /** What's happening right now, e.g. the file being handled. */
  current: string | null;
  /** Small print under the progress, e.g. why media isn't compressed. */
  note?: string;
  startedAt: number;
  /** When the current step began, for its time-left estimate. */
  stepStartedAt: number;
  finishedAt?: number;
  /** One-line result shown when done. */
  summary?: string;
  /** Extra lines under the summary (warnings, counts). */
  details?: string[];
  error?: string;
  /** Headings once finished, e.g. "Imported" / "Import failed". */
  doneTitle?: string;
  failTitle?: string;
  /** Label for the button that closes a finished window. */
  closeLabel?: string;
  /** Optional extra button on a finished window. */
  action?: { label: string; run: () => void };
}

let state: TaskState | null = null;
let version = 0;
const listeners = new Set<() => void>();
let lastPaint = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export const task = {
  get: () => state,
  running: () => state?.status === 'running',

  start(title: string, subtitle: string, steps: string[], extra: Partial<TaskState> = {}) {
    state = { title, subtitle, steps, step: 0, status: 'running', done: 0, total: 0, current: null, startedAt: Date.now(), stepStartedAt: Date.now(), ...extra };
    lastPaint = 0;
    emit();
  },

  /** Move to a step, resetting its counters. */
  step(step: number, patch: Partial<TaskState> = {}) {
    if (!state) return;
    state = { ...state, step, done: 0, total: 0, percent: undefined, current: null, stepStartedAt: Date.now(), ...patch };
    emit();
  },

  /** Frequent progress reports are throttled to ~10 repaints a second. */
  progress(patch: Partial<TaskState>) {
    if (!state) return;
    state = { ...state, ...patch };
    const now = performance.now();
    const finished = patch.total !== undefined && patch.done !== undefined && patch.done >= patch.total;
    if (now - lastPaint < 100 && !finished && patch.percent !== 100) return;
    lastPaint = now;
    emit();
  },

  finish(summary: string, extra: Partial<TaskState> = {}) {
    if (!state) return;
    state = { ...state, status: 'done', step: state.steps.length, finishedAt: Date.now(), current: null, summary, ...extra };
    emit();
  },

  fail(error: unknown) {
    if (!state) return;
    const message = error instanceof Error ? error.message : String(error);
    state = { ...state, status: 'error', finishedAt: Date.now(), error: message || 'Something went wrong.' };
    emit();
  },

  close() {
    state = null;
    emit();
  },
};

export function useTask(): TaskState | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return state;
}

/** Give the browser a chance to paint before CPU-heavy work. */
export function yieldToPaint(): Promise<void> {
  return new Promise((r) => setTimeout(r, 30));
}
