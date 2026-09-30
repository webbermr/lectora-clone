/**
 * Reading Lectora object declarations. Every object on a page is created like
 *   text63337  = new ObjText('text63337', null, 320, 9, 505, 25, …)
 *   button6746 = new ObjButton('button6746', 'Close TOC', 772, 156, 27, 28, …)
 *   shape66593 = new ObjImage('shape66593', 'images/shape66593.png', 'Rectangle 2', 832, 0, 178, 58, …)
 * that is: the id, then one or more text arguments (name, and for images the file first), then the
 * position and size as the first run of four numbers.
 */

/** One text argument: null, '…' or "…". */
export const STR = `(?:null|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`;
export const NUM = '(-?\\d+(?:\\.\\d+)?)';
/** The text arguments between the id and the numbers. */
export const TEXT_ARGS = `(?:\\s*,\\s*${STR})*`;

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `new ObjX('id', …texts…, ` up to the first number, for rewriting positions. */
export function declHead(id: string): string {
  return `\\bnew\\s+Obj\\w+\\(\\s*'${reEscape(id)}'${TEXT_ARGS}\\s*,\\s*`;
}

export interface Declaration {
  kind: string;
  id: string;
  /** Lectora's name for it ("Close TOC", "Rectangle 2"); empty when it has none. */
  name: string;
  /** The image file it shows, for image objects. */
  image: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const ALL = new RegExp(`\\bnew\\s+(Obj\\w+)\\(\\s*'([\\w-]+)'(${TEXT_ARGS})\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}`, 'g');
const IMAGE_FILE = /\.(?:png|jpe?g|gif|svg|webp|bmp)$/i;

/** Every object declaration on a page, first one per id. */
export function declarations(html: string): Map<string, Declaration> {
  const out = new Map<string, Declaration>();
  if (!html.includes('new Obj')) return out;
  for (const m of html.matchAll(ALL)) {
    const [, kind, id, texts, x, y, w, h] = m;
    if (out.has(id)) continue;
    const values = [...texts.matchAll(/null|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((v) => (v[1] ?? v[2] ?? '').replace(/\\(.)/g, '$1'));
    const image = values.find((v) => IMAGE_FILE.test(v)) ?? '';
    const name = values.find((v) => v && !IMAGE_FILE.test(v)) ?? '';
    out.set(id, { kind, id, name, image, x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
  }
  return out;
}
