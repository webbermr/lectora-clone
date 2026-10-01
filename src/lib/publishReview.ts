/**
 * Before publishing: if some files aren't used by the course, ask whether to leave them out of the download
 * (the project keeps them either way). Rendered by <PublishDialog>.
 */
import { useSyncExternalStore } from 'react';
import type { UnusedReport } from './unused';

export interface PublishReview {
  unused: UnusedReport;
  sizes: Record<string, number>;
  totalBytes: number;
  /** The files to leave out, or null to cancel. */
  resolve: (leaveOut: Set<string> | null) => void;
}

let current: PublishReview | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export function askAboutUnused(unused: UnusedReport, sizes: Record<string, number>, totalBytes: number): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    current = {
      unused,
      sizes,
      totalBytes,
      resolve: (leaveOut) => {
        current = null;
        emit();
        resolve(leaveOut);
      },
    };
    emit();
  });
}

export function usePublishReview(): PublishReview | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return current;
}
