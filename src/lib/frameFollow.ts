/**
 * Follows which package page a Live edit / Preview frame is showing, so the
 * sidebar can highlight it as the learner clicks through the course.
 */
import { useEffect, type RefObject } from 'react';
import { store } from './store';
import { vfsUrl } from './vfs';

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
    let last = '';
    const check = () => {
      let href = '';
      try {
        href = frame.current?.contentWindow?.location.href ?? '';
      } catch {
        return; // navigated off-site
      }
      if (!href || href === last || href === 'about:blank') return;
      last = href;
      const path = pathFromFrameUrl(href, projectId);
      if (path && store.project?.files[path]) store.setViewing(path);
    };
    const timer = setInterval(check, 400);
    return () => clearInterval(timer);
  }, [frame, projectId]);
}
