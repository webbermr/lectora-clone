/** The review → delete → check flow behind the Title Explorer's delete button. */
import { useSyncExternalStore } from 'react';
import { checkCourse, type CheckResult } from './courseCheck';
import { planChanges, planDelete, type DeletePlan } from './lectora';
import { openTests } from './lectoraTest';
import { store } from './store';
import { yieldToPaint } from './task';

export interface DeleteFlow {
  label: string;
  pages: string[];
  /** Non-page files (images, documents…) deleted as they are. */
  otherFiles: string[];
  /** Set flags the deleted pages used to set, so nothing waits on them forever. */
  keepFinishable: boolean;
  stage: 'planning' | 'review' | 'applying' | 'done' | 'error';
  plan?: DeletePlan;
  check?: CheckResult;
  error?: string;
}

let state: DeleteFlow | null = null;
/** The package's test files, decrypted for this delete (kept out of React state). */
let opened: ReturnType<typeof openTests> = null;
let version = 0;
const listeners = new Set<() => void>();
const set = (next: DeleteFlow | null) => {
  state = next;
  version++;
  listeners.forEach((l) => l());
};

export const deleteFlow = {
  async start(label: string, pages: string[], keepFinishable = true, otherFiles: string[] = []) {
    const base = { label, pages, otherFiles, keepFinishable };
    set({ ...base, stage: 'planning' });
    await yieldToPaint();
    try {
      const p = store.project!;
      opened = openTests(p.files);
      set({ ...base, stage: 'review', plan: planDelete(p.files, p.manifest, pages, { keepFinishable, tests: opened, otherFiles }) });
    } catch (e) {
      console.error(e);
      set({ ...base, stage: 'error', error: (e as Error).message });
    }
  },

  setKeepFinishable(on: boolean) {
    if (state) void deleteFlow.start(state.label, state.pages, on, state.otherFiles);
  },

  async confirm() {
    if (!state?.plan || state.plan.blocked) return;
    const { label, plan, pages, keepFinishable, otherFiles } = state;
    set({ ...state, stage: 'applying' });
    await yieldToPaint();
    try {
      // Re-encrypt edited tests the way Lectora does, and prove they read back exactly.
      if (plan.testXml.size) {
        if (!opened || !('cipher' in opened)) throw new Error("The test couldn't be re-encrypted.");
        for (const [file, xml] of plan.testXml) {
          const sealed = opened.cipher.encrypt(xml);
          if (opened.cipher.decrypt(sealed) !== xml) throw new Error(`Re-encrypting ${file} didn't round-trip; nothing was changed.`);
          plan.edits.set(file, sealed);
        }
      }
      await store.write(label, planChanges(plan));
      const p = store.project!;
      const check = checkCourse(p.files, p.manifest, openTests(p.files));
      const errors = check.issues.filter((i) => i.severity === 'error').length;
      store.setStatus(`${label}: ${plan.pages.length + plan.otherFiles.length} removed · course check ${errors ? `found ${errors} problem(s)` : 'passed'}`);
      set({ label, pages, otherFiles, keepFinishable, stage: 'done', plan, check });
    } catch (e) {
      console.error(e);
      set({ label, pages, otherFiles, keepFinishable, stage: 'error', error: (e as Error).message });
    }
  },

  /** Run the course check again after fixing something from the results. */
  recheck() {
    if (!state || state.stage !== 'done') return;
    const p = store.project!;
    set({ ...state, check: checkCourse(p.files, p.manifest, openTests(p.files)) });
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
