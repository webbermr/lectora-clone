/** The pick a spot → review → apply → check flow behind the Title Explorer's Move and Copy buttons. */
import { useSyncExternalStore } from 'react';
import { checkCourse, type CheckResult } from './courseCheck';
import { openTests } from './lectoraTest';
import { destinations, planCopy, planMove, planWrites, type Destination, type PagePlan, type Position } from './pageOps';
import { store } from './store';
import { yieldToPaint } from './task';
import { encodeText } from './text';

export interface PageOpFlow {
  kind: 'move' | 'copy';
  page: string;
  pos: Position;
  /** Where it can go, in course order. */
  spots: Destination[];
  stage: 'review' | 'applying' | 'done' | 'error';
  plan: PagePlan;
  check?: CheckResult;
  error?: string;
}

let state: PageOpFlow | null = null;
let version = 0;
const listeners = new Set<() => void>();
const set = (next: PageOpFlow | null) => {
  state = next;
  version++;
  listeners.forEach((l) => l());
};

const plan = (kind: PageOpFlow['kind'], page: string, pos: Position) => {
  const p = store.project!;
  return kind === 'move' ? planMove(p.files, p.manifest, page, pos) : planCopy(p.files, p.manifest, page, pos);
};

export const pageOpFlow = {
  /** Open the review. Without a spot, a move starts one page later and a copy goes straight after the page. */
  start(kind: PageOpFlow['kind'], page: string, pos?: Position) {
    const p = store.project;
    if (!p) return;
    const spots = destinations(p.files, p.manifest);
    if (!pos) {
      const i = spots.findIndex((s) => s.path === page);
      pos = kind === 'move' && spots[i + 1] ? { after: spots[i + 1].path } : { after: page };
    }
    set({ kind, page, pos, spots, stage: 'review', plan: plan(kind, page, pos) });
  },

  /** Pick another spot (the plan is worked out again). */
  setPosition(pos: Position) {
    if (!state || state.stage !== 'review') return;
    set({ ...state, pos, plan: plan(state.kind, state.page, pos) });
  },

  async confirm() {
    if (!state || state.stage !== 'review' || state.plan.blocked) return;
    const current = state;
    set({ ...current, stage: 'applying' });
    await yieldToPaint();
    try {
      await store.write(current.plan.label, planWrites(current.plan, encodeText));
      const p = store.project!;
      const check = checkCourse(p.files, p.manifest, openTests(p.files));
      const errors = check.issues.filter((i) => i.severity === 'error').length;
      store.setStatus(`${current.plan.label}: done · course check ${errors ? `found ${errors} problem(s)` : 'passed'}`);
      if (current.plan.page) store.openPage(current.plan.page, 'lectora:page:' + current.plan.page);
      set({ ...current, stage: 'done', check });
    } catch (e) {
      console.error(e);
      set({ ...current, stage: 'error', error: (e as Error).message });
    }
  },

  recheck() {
    if (!state || state.stage !== 'done') return;
    const p = store.project!;
    set({ ...state, check: checkCourse(p.files, p.manifest, openTests(p.files)) });
  },

  close: () => set(null),
};

export function usePageOpFlow(): PageOpFlow | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return state;
}
