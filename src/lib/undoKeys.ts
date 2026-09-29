import { isTypingTarget } from '../components/LiveStage';
import { store } from './store';

/**
 * Ctrl/⌘+Z undo, Ctrl/⌘+Y or Ctrl/⌘+Shift+Z redo, outside the Edit view (which has its own).
 * Text boxes keep their own undo, and nothing fires while a dialog is open.
 */
export function undoShortcut(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return false;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return false;
  if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop')) return false;
  void (k === 'y' || e.shiftKey ? store.redo() : store.undo());
  return true;
}
