/** The review → delete → check flow behind the Title Explorer's delete button. */
import { useSyncExternalStore } from 'react';
import { checkCourse, type CheckResult } from './courseCheck';
import { planChanges, planDelete, type DeletePlan } from './lectora';
import { store } from './store';
import { yieldToPaint } from './task';

export interface DeleteFlow {
  label: string;
  pages: string[];
  /** Set flags the deleted pages used to set, so nothing waits on them forever. */
  keepFinishable: boolean;
  stage: 'planning' | 'review' | 'applying' | 'done' | 'error';
  plan?: DeletePlan;
  check?: CheckResult;
  error?: string;
}

let state: DeleteFlow | null = null;
let version = 0;
const listeners = new Set<() => void>();
const set = (next: DeleteFlow | null) => {
  state = next;
  version++;
  listeners.forEach((l) => l());
};

export const deleteFlow = {
  async start(label: string, pages: string[], keepFinishable = true) {
    set({ label, pages, keepFinishable, stage: 'planning' });
    await yieldToPaint();
    try {
      const p = store.project!;
      set({ label, pages, keepFinishable, stage: 'review', plan: planDelete(p.files, p.manifest, pages, { keepFinishable }) });
    } catch (e) {
      console.error(e);
      set({ label, pages, keepFinishable, stage: 'error', error: (e as Error).message });
    }
  },

  setKeepFinishable(on: boolean) {
    if (state) void deleteFlow.start(state.label, state.pages, on);
  },

  async confirm() {
    if (!state?.plan || state.plan.blocked) return;
    const { label, plan, pages, keepFinishable } = state;
    set({ ...state, stage: 'applying' });
    await yieldToPaint();
    try {
      await store.write(label, planChanges(plan));
      const p = store.project!;
      const check = checkCourse(p.files, p.manifest);
      const errors = check.issues.filter((i) => i.severity === 'error').length;
      store.setStatus(`${label}: ${plan.pages.length} pages removed · course check ${errors ? `found ${errors} problem(s)` : 'passed'}`);
      set({ label, pages, keepFinishable, stage: 'done', plan, check });
    } catch (e) {
      console.error(e);
      set({ label, pages, keepFinishable, stage: 'error', error: (e as Error).message });
    }
  },

  close: () => set(null),
};

export function useDeleteFlow(): DeleteFlow | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return state;
}
