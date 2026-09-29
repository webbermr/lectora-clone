/** A promise-based "which of these matches?" dialog, rendered by <MatchChooser>. */
import { useSyncExternalStore } from 'react';
import type { SourceMatch } from './sourceMatch';

export interface ChoiceRequest {
  title: string;
  newText: string;
  matches: SourceMatch[];
  preselected: Set<number>;
  resolve: (chosen: SourceMatch[] | null) => void;
}

let current: ChoiceRequest | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function chooseMatches(title: string, newText: string, matches: SourceMatch[], preselected: Set<number>): Promise<SourceMatch[] | null> {
  return new Promise((resolve) => {
    current = {
      title,
      newText,
      matches,
      preselected,
      resolve: (chosen) => {
        current = null;
        emit();
        resolve(chosen);
      },
    };
    emit();
  });
}

export function useChoice(): ChoiceRequest | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return current;
}
