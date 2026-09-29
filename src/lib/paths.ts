/** Path helpers for forward-slash, package-relative paths (no leading slash). */

export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'));
}

/** Split "a/b.html?x=1#y" into path and the query/hash suffix. */
export function splitQuery(href: string): { path: string; suffix: string } {
  const m = /[?#]/.exec(href);
  if (!m) return { path: href, suffix: '' };
  return { path: href.slice(0, m.index), suffix: href.slice(m.index) };
}

/** Relative URL from the directory of `fromFile` to `toFile`. */
export function relative(fromFile: string, toFile: string): string {
  const from = dirname(normalize(fromFile)).split('/').filter(Boolean);
  const to = normalize(toFile).split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
}

/** Resolve a URL found inside `fromFile` to a package path, or null if external. */
export function resolveFrom(fromFile: string, url: string): string | null {
  if (!url || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return null;
  const { path } = splitQuery(url);
  if (path.startsWith('/')) return normalize(path);
  return join(dirname(fromFile), decodeURIComponentSafe(path));
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', xml: 'application/xml', xsd: 'application/xml', dtd: 'application/xml-dtd',
  txt: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', m4v: 'video/mp4',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf', swf: 'application/x-shockwave-flash', vtt: 'text/vtt',
};

export function mimeType(path: string): string {
  return MIME[extname(path)] ?? 'application/octet-stream';
}

const TEXT_EXT = new Set(['html', 'htm', 'xhtml', 'js', 'mjs', 'css', 'json', 'xml', 'xsd', 'dtd', 'txt', 'svg', 'vtt', 'md', 'csv']);

export function isTextFile(path: string): boolean {
  return TEXT_EXT.has(extname(path));
}

export function isHtmlFile(path: string): boolean {
  return ['html', 'htm', 'xhtml'].includes(extname(path));
}

export function isImageFile(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(extname(path));
}

export function isMediaFile(path: string): boolean {
  return ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'ogv', 'm4v'].includes(extname(path));
}
