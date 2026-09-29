/**
 * Follows which package page a Live edit / Preview frame is showing, so the
 * sidebar can highlight it as the learner clicks through the course.
 */
import { useEffect, type RefObject } from 'react';
import { store } from './store';
import { vfsUrl } from './vfs';
import { documentPage } from './pageIdentity';

/** Package path for a frame URL served from the project, or null if it isn't one. */
export function pathFromFrameUrl(href: string, projectId: string): string | null {
  const root = vfsUrl(projectId, '');
  if (!href.startsWith(root)) return null;
  const rest = href.slice(root.length).split(/[?#]/)[0];
  try {
    return decodeURIComponent(rest) || null;
  } catch {
    return null;
  }
}

export function useFollowFrame(frame: RefObject<HTMLIFrameElement | null>, projectId: string) {
  useEffect(() => {
    const check = () => {
      let href = '';
      let doc: Document | null = null;
      try {
        href = frame.current?.contentWindow?.location.href ?? '';
        doc = frame.current?.contentDocument ?? null;
      } catch {
        return; // navigated off-site
      }
      const files = store.project?.files;
      if (!href || href === 'about:blank' || !doc || !files) return;
      const address = pathFromFrameUrl(href, projectId);
      // A page player (Lectora's pagePlayer) swaps pages in without changing the address.
      const path = documentPage(doc, address, files);
      if (path && files[path]) store.setViewing(path);
    };
    const timer = setInterval(check, 500);
    return () => clearInterval(timer);
  }, [frame, projectId]);
}
