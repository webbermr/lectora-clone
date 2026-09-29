/**
 * Moving Lectora objects. A page declares where each object sits:
 *   text63337 = new ObjText('text63337', null, 320, 9, 505, 25, …)     (x, y, width, height)
 *   text63337.addIe8Attr(320, 9, 505, 25, 0, 0)                         (the same, for old browsers)
 * Moving an object rewrites those numbers, so the course places it there itself.
 */

export interface Point {
  x: number;
  y: number;
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const NAME = `(?:null|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const declRe = (id: string, flags = 'g') => new RegExp(`(\\bnew\\s+Obj\\w+\\(\\s*'${reEscape(id)}'\\s*,\\s*${NAME}\\s*,\\s*)${NUM}(\\s*,\\s*)${NUM}`, flags);
const ie8Re = (id: string) => new RegExp(`(\\b${reEscape(id)}\\.addIe8Attr\\(\\s*)${NUM}(\\s*,\\s*)${NUM}`, 'g');
const ALL_DECLS = new RegExp(`\\bnew\\s+Obj\\w+\\(\\s*'([\\w-]+)'\\s*,\\s*${NAME}\\s*,\\s*${NUM}\\s*,\\s*${NUM}`, 'g');

/** Where the page first declares an object, or null if it doesn't. */
export function declaredPosition(html: string, id: string): Point | null {
  const m = declRe(id, '').exec(html);
  return m ? { x: Number(m[2]), y: Number(m[4]) } : null;
}

/** Every object's declared position on a page. */
export function declaredPositions(html: string): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const m of html.matchAll(ALL_DECLS)) if (!out.has(m[1])) out.set(m[1], { x: Number(m[2]), y: Number(m[3]) });
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
