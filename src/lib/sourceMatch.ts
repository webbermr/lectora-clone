/**
 * Find text that is visible on a rendered page inside the package's source
 * files, and rewrite it there.
 *
 * Authoring tools rarely store text as plain HTML. It sits inside JavaScript
 * strings ('It\'s'), HTML entities (&rsquo;), \u escapes, escape() output
 * (%20) or JSON. The matcher accepts any of those spellings for each
 * character, and the replacement is re-encoded to match how the original was
 * stored, so the file stays valid.
 */
import { extname } from './paths';

export interface SourceMatch {
  path: string;
  index: number;
  length: number;
  /** The raw source text that matched. */
  matched: string;
  /** A little source on each side, for showing the user. */
  before: string;
  after: string;
  context: 'html' | 'js' | 'xml' | 'text';
}

const NAMED: Record<string, string[]> = {
  '&': ['&amp;'], '<': ['&lt;'], '>': ['&gt;'], '"': ['&quot;'], "'": ['&apos;'],
  '’': ['&rsquo;'], '‘': ['&lsquo;'], '“': ['&ldquo;'], '”': ['&rdquo;'],
  '—': ['&mdash;'], '–': ['&ndash;'], '…': ['&hellip;'], '•': ['&bull;'],
  '©': ['&copy;'], '®': ['&reg;'], '™': ['&trade;'], '°': ['&deg;'],
  'é': ['&eacute;'], 'è': ['&egrave;'], 'à': ['&agrave;'], 'á': ['&aacute;'],
  'ó': ['&oacute;'], 'í': ['&iacute;'], 'ú': ['&uacute;'], 'ñ': ['&ntilde;'],
  'ü': ['&uuml;'], 'ö': ['&ouml;'], 'ä': ['&auml;'], 'ç': ['&ccedil;'],
  '½': ['&frac12;'], '×': ['&times;'], '÷': ['&divide;'], '€': ['&euro;'],
  '£': ['&pound;'],
};

const WHITESPACE = String.raw`(?:[\s   ]|&nbsp;|&#0*160;|&#[xX]0*[aA]0;|\\u00[aA]0|\\x[aA]0|\\[nrt]|%20|%[aA]0|%u00[aA]0|<br\s*/?>|&lt;br\s*/?&gt;)+`;

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Case-insensitive hex digits, e.g. "a0" -> "[aA]0". */
function ciHex(hex: string): string {
  return hex.replace(/[a-f]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
}

function charPattern(ch: string): string {
  if (/[A-Za-z0-9]/.test(ch)) return ch;
  const code = ch.codePointAt(0)!;
  const hex = code.toString(16);
  const alts = [reEscape(ch)];
  if (code < 128) alts.push('\\\\' + reEscape(ch)); // JS escapes: \' \" \/
  for (const n of NAMED[ch] ?? []) alts.push(reEscape(n));
  alts.push(`&#0*${code};`, `&#[xX]0*${ciHex(hex)};`);
  if (code <= 0xffff) alts.push('\\\\u' + ciHex(hex.padStart(4, '0')));
  if (code < 256) {
    alts.push('\\\\x' + ciHex(hex.padStart(2, '0')));
    alts.push('%' + ciHex(hex.padStart(2, '0').toUpperCase()));
  } else if (code <= 0xffff) {
    alts.push('%u' + ciHex(hex.padStart(4, '0')));
  }
  return `(?:${alts.join('|')})`;
}

/** Normalize text as the user sees it: collapse whitespace, trim. */
export function visibleText(s: string): string {
  return s.replace(/[\s ]+/g, ' ').trim();
}

/** A regex that matches `text` however the source happens to encode it. */
export function flexiblePattern(text: string): RegExp | null {
  const t = visibleText(text);
  if (!t) return null;
  let src = '';
  let inSpace = false;
  for (const ch of Array.from(t)) {
    if (ch === ' ') {
      if (!inSpace) src += WHITESPACE;
      inSpace = true;
      continue;
    }
    inSpace = false;
    src += charPattern(ch);
  }
  // Don't match inside a longer word ("Next" inside "goNext").
  if (/^[A-Za-z0-9_]/.test(t)) src = '(?<![A-Za-z0-9_])' + src;
  if (/[A-Za-z0-9_]$/.test(t)) src += '(?![A-Za-z0-9_])';
  return new RegExp(src, 'g');
}

function contextAt(path: string, text: string, index: number): SourceMatch['context'] {
  const ext = extname(path);
  if (ext === 'js' || ext === 'mjs' || ext === 'json') return 'js';
  if (ext === 'xml') return 'xml';
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') {
    const lower = text.slice(0, index).toLowerCase();
    return lower.lastIndexOf('<script') > lower.lastIndexOf('</script') ? 'js' : 'html';
  }
  return 'text';
}

export function findInFile(path: string, text: string, pattern: RegExp, limit = 200): SourceMatch[] {
  const out: SourceMatch[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m && out.length < limit; m = pattern.exec(text)) {
    if (!m[0].length) {
      pattern.lastIndex++;
      continue;
    }
    out.push({
      path,
      index: m.index,
      length: m[0].length,
      matched: m[0],
      before: text.slice(Math.max(0, m.index - 50), m.index),
      after: text.slice(m.index + m[0].length, m.index + m[0].length + 50),
      context: contextAt(path, text, m.index),
    });
  }
  return out;
}

/** Search text files in priority order. */
export function findEverywhere(
  files: Iterable<[string, string]>,
  search: string,
  opts: { flexible?: boolean } = {},
): SourceMatch[] {
  const pattern = opts.flexible === false ? literalPattern(search) : flexiblePattern(search);
  if (!pattern) return [];
  const out: SourceMatch[] = [];
  for (const [path, text] of files) out.push(...findInFile(path, text, pattern));
  return out;
}

function literalPattern(s: string): RegExp | null {
  return s ? new RegExp(reEscape(s), 'g') : null;
}

/** Which quote character encloses `index` on its line, if any. */
function enclosingQuote(text: string, index: number): string | null {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let quote: string | null = null;
  for (let i = lineStart; i < index; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    }
  }
  return quote;
}

/** Encode replacement text the same way the matched source was encoded. */
export function encodeLike(newText: string, match: SourceMatch, fileText: string): string {
  const m = match.matched;
  let t = newText;
  const nearby = fileText.slice(Math.max(0, match.index - 300), match.index + match.length + 300);
  const markupAround = /<(p|span|div|br|b|i|u|strong|em|font|li|td|h\d)\b|&lt;(p|span|div|br)\b/i.test(nearby);
  const usesEntities = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(m);
  const htmlish = match.context === 'html' || match.context === 'xml' || usesEntities || (match.context === 'js' && markupAround);
  const escaped = /%[0-9A-F]{2}|%u[0-9A-F]{4}/i.test(m) && !/[ \t]/.test(m);

  if (htmlish) {
    t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    if (/&rsquo;|&ldquo;|&rdquo;|&mdash;|&ndash;/.test(m)) {
      for (const [ch, names] of Object.entries(NAMED)) {
        if (ch.charCodeAt(0) > 127) t = t.split(ch).join(names[0]);
      }
    }
  }
  if (escaped) {
    // Legacy escape() output, which some older authoring tools use.
    t = escape(t);
  }
  if (match.context === 'js' && !escaped) {
    const quote = enclosingQuote(fileText, match.index);
    t = t.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
    if (quote) t = t.split(quote).join('\\' + quote);
    if (/\\\//.test(m)) t = t.replace(/\//g, '\\/');
    if (/\\u[0-9a-f]{4}/i.test(m)) {
      t = t.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    }
  }
  return t;
}

/** Apply replacements to one file's text. Matches must all belong to that file. */
export function applyToText(fileText: string, matches: SourceMatch[], newText: string): string {
  let out = fileText;
  for (const m of [...matches].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, m.index) + encodeLike(newText, m, fileText) + out.slice(m.index + m.length);
  }
  return out;
}
