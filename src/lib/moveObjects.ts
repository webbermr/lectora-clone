/**
 * Moving Lectora objects. A page declares where each object sits:
 *   text63337 = new ObjText('text63337', null, 320, 9, 505, 25, …)     (x, y, width, height)
 *   text63337.addIe8Attr(320, 9, 505, 25, 0, 0)                         (the same, for old browsers)
 *   shape66593 = new ObjImage('shape66593', 'images/shape66593.png', 'Rectangle 2', 832, 0, …)
 * Moving an object rewrites those numbers, so the course places it there itself.
 */

export interface Point {
  x: number;
  y: number;
}

import { declarations, declHead, NUM } from './lectoraDecl';

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Any number of text arguments come before the position (images give their file first).
const declRe = (id: string, flags = 'g') => new RegExp(`(${declHead(id)})${NUM}(\\s*,\\s*)${NUM}`, flags);
const ie8Re = (id: string) => new RegExp(`(\\b${reEscape(id)}\\.addIe8Attr\\(\\s*)${NUM}(\\s*,\\s*)${NUM}`, 'g');

/** Where the page first declares an object, or null if it doesn't. */
export function declaredPosition(html: string, id: string): Point | null {
  const m = declRe(id, '').exec(html);
  return m ? { x: Number(m[2]), y: Number(m[4]) } : null;
}

/** Every object's declared position on a page. */
export function declaredPositions(html: string): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const [id, d] of declarations(html)) out.set(id, { x: d.x, y: d.y });
  return out;
}

/**
 * The page with the object moved to `to`. Only places that hold the object's current position change,
 * so a separate layout (say, a phone layout at other coordinates) is left alone.
 */
export function moveInSource(html: string, id: string, to: Point): string {
  const from = declaredPosition(html, id);
  if (!from) return html;
  const x = String(Math.round(to.x));
  const y = String(Math.round(to.y));
  const at = (a: string, b: string) => Number(a) === from.x && Number(b) === from.y;
  return html
    .replace(declRe(id), (m, head, ax, sep, ay) => (at(ax, ay) ? `${head}${x}${sep}${y}` : m))
    .replace(ie8Re(id), (m, head, ax, sep, ay) => (at(ax, ay) ? `${head}${x}${sep}${y}` : m));
}
