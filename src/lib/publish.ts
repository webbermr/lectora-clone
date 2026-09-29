/** State of a running "Publish SCORM" export, shown by <PublishProgress>. */
import { useSyncExternalStore } from 'react';

export type PublishStage = 'preparing' | 'packaging' | 'saving' | 'done' | 'error';

export interface PublishState {
  stage: PublishStage;
  fileName: string;
  filesTotal: number;
  bytesTotal: number;
  /** Files stored as-is because they're already compressed (images, audio, video). */
  storedCount: number;
  filesDone: number;
  percent: number;
  currentFile: string | null;
  startedAt: number;
  finishedAt?: number;
  zipSize?: number;
  error?: string;
  blob?: Blob;
}

let state: PublishState | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export const publish = {
  get: () => state,
  start(init: Omit<PublishState, 'stage' | 'filesDone' | 'percent' | 'currentFile' | 'startedAt'>) {
    state = { ...init, stage: 'preparing', filesDone: 0, percent: 0, currentFile: null, startedAt: Date.now() };
    emit();
  },
  update(patch: Partial<PublishState>) {
    if (!state) return;
    state = { ...state, ...patch };
    emit();
  },
  close() {
    state = null;
    emit();
  },
  running: () => !!state && state.stage !== 'done' && state.stage !== 'error',
};

export function usePublish(): PublishState | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return state;
}
