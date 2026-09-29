/**
 * Lectora tests: the question list lives in `_tobj<id>.txt`, an XML file
 * that Lectora encrypts (AES, via its bundled copy of CryptoJS in enc.js) so
 * learners can't read the answers. The runtime decrypts it with a passphrase
 * built inside trivantis-titlemgr.js (TMPr.bDc).
 *
 * To edit it we run the package's own enc.js and bDc: no key is stored in
 * this app. The edited XML is re-encrypted the same way, so answers stay
 * hidden from learners.
 */
import { textOf } from './assetRefs';
import type { FileMap } from './package';
import { basename } from './paths';

export const TEST_FILE = /(^|\/)_tobj\d+\.txt$/i;

export interface LectoraCipher {
  decrypt(text: string): string;
  encrypt(xml: string): string;
}

/** The source of TMPr.bDc from trivantis-titlemgr.js, or null. */
export function extractDecryptFunction(titlemgr: string): string | null {
  const start = titlemgr.search(/TMPr\.bDc\s*=\s*function\s*\(/);
  if (start < 0) return null;
  const fnStart = titlemgr.indexOf('function', start);
  // The function body ends at the first closing brace at the start of a line.
  const end = titlemgr.slice(fnStart).search(/\n\}/);
  return end < 0 ? null : titlemgr.slice(fnStart, fnStart + end + 2);
}

/**
 * Build a cipher from the package's own files. Throws if they aren't there or
 * don't look like Lectora's.
 */
export function lectoraCipher(encJs: string, titlemgr: string): LectoraCipher {
  const bdc = extractDecryptFunction(titlemgr);
  if (!bdc || !/\bhlf\s*\(/.test(bdc)) throw new Error("trivantis-titlemgr.js doesn't contain Lectora's test decryption.");
  if (!/\bCJ\b/.test(encJs)) throw new Error("enc.js doesn't look like Lectora's encryption library.");
  // Browser globals are shadowed so the course's script can't touch the editor.
  const factory = new Function(
    'window', 'document', 'self', 'globalThis', 'fetch', 'XMLHttpRequest', 'localStorage', 'indexedDB',
    `${encJs}
;var utf8 = CJ.enc.Utf8;
var __key = null;
var hlf = function (s, k) { __key = String(k); return CJ.AES.dct(s, k); };
var bDc = ${bdc};
return {
  decrypt: function (t) { return String(bDc(t)); },
  encrypt: function (x) {
    if (__key === null) throw new Error('Decrypt a test before encrypting one.');
    return CJ.AES.encrypt(x, __key).toString();
  }
};`,
  );
  return factory() as LectoraCipher;
}

export interface OpenedTests {
  /** Decrypted XML for each test file. */
  xml: Map<string, string>;
  cipher: LectoraCipher;
}

/** Decrypt every test in the package, or explain why that isn't possible. */
export function openTests(files: FileMap): OpenedTests | { error: string } | null {
  const tests = Object.keys(files).filter((f) => TEST_FILE.test(f));
  if (!tests.length) return null;
  const enc = Object.keys(files).find((f) => basename(f).toLowerCase() === 'enc.js');
  const tm = Object.keys(files).find((f) => basename(f).toLowerCase() === 'trivantis-titlemgr.js');
  if (!enc || !tm) return { error: 'The package is missing enc.js or trivantis-titlemgr.js, which are needed to read the encrypted test.' };
  try {
    const cipher = lectoraCipher(textOf(files[enc]), textOf(files[tm]));
    const xml = new Map<string, string>();
    for (const t of tests) {
      const raw = textOf(files[t]);
      const plain = raw.includes('<?xml') ? raw : cipher.decrypt(raw.trim());
      if (!plain.includes('<lectoratest')) throw new Error(`${t} didn't decrypt to a Lectora test.`);
      xml.set(t, plain);
    }
    return { xml, cipher };
  } catch (e) {
    return { error: `Couldn't read the encrypted test: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Editing the test XML
// ---------------------------------------------------------------------------

export interface TestEdit {
  file: string;
  questionsRemoved: number;
  sectionsRemoved: string[];
  /** Sections whose random draw was lowered because fewer questions are left than it asked for. */
  numrandom: { section: string; before: number; after: number }[];
  /** Test settings (pass/fail/back page) that pointed at a deleted page. */
  relinked: { setting: string; from: string; to: string }[];
  /** Questions drawn per attempt, before and after. */
  drawn: { before: number; after: number };
}

const PAGE_BLOCK = /[ \t]*<page(?:\s[^>]*)?>[\s\S]*?<\/page>\r?\n?/g;
const SECTION_BLOCK = /[ \t]*<section>[\s\S]*?<\/section>\r?\n?/g;
const nameOf = (block: string) => /<name>([^<]*)<\/name>/.exec(block)?.[1] ?? '';

/** How many questions an attempt shows: each section's draw (or all its pages), plus loose pages. */
function questionsDrawn(xml: string): number {
  let n = 0;
  for (const s of xml.match(SECTION_BLOCK) ?? []) {
    const pages = (s.match(PAGE_BLOCK) ?? []).filter((p) => p.includes('<question>')).length;
    const draw = Number(/<numrandom>(\d+)<\/numrandom>/.exec(s.slice(0, s.search(/<page[\s>]/)))?.[1] ?? 0);
    n += draw > 0 ? Math.min(draw, pages) : pages;
  }
  const loose = xml.replace(SECTION_BLOCK, '');
  n += (loose.match(PAGE_BLOCK) ?? []).filter((p) => p.includes('<question>')).length;
  return n;
}

/**
 * Remove deleted pages from a Lectora test, keeping it consistent:
 * sections never draw more questions than they have, emptied sections go,
 * pass/fail/back pages that were deleted are pointed elsewhere, and page and
 * section indexes are renumbered in order as Lectora publishes them.
 */
export function editTestXml(
  file: string,
  xml: string,
  deleted: Set<string>,
  target: (deletedPage: string) => string | undefined,
): { xml: string; edit: TestEdit } {
  const edit: TestEdit = { file, questionsRemoved: 0, sectionsRemoved: [], numrandom: [], relinked: [], drawn: { before: questionsDrawn(xml), after: 0 } };
  const dropPages = (block: string) =>
    block.replace(PAGE_BLOCK, (p) => {
      if (!deleted.has(basename(nameOf(p)))) return p;
      if (p.includes('<question>')) edit.questionsRemoved++;
      return '';
    });

  let out = xml.replace(SECTION_BLOCK, (sec) => {
    const id = /<id>([^<]*)<\/id>/.exec(sec)?.[1] ?? '?';
    const kept = dropPages(sec);
    const pages = (kept.match(PAGE_BLOCK) ?? []).length;
    if (!pages) {
      if ((sec.match(PAGE_BLOCK) ?? []).length) edit.sectionsRemoved.push(id);
      return pages === (sec.match(PAGE_BLOCK) ?? []).length ? sec : '';
    }
    const headEnd = kept.search(/<page[\s>]/);
    return kept.slice(0, headEnd).replace(/<numrandom>(\d+)<\/numrandom>/, (m, n) => {
      if (Number(n) <= pages) return m;
      edit.numrandom.push({ section: id, before: Number(n), after: pages });
      return `<numrandom>${pages}</numrandom>`;
    }) + kept.slice(headEnd);
  });

  // Pages outside sections (e.g. the results page) and the test's own navigation settings.
  const [head, ...rest] = out.split(/(?=<section>)/);
  const tail = rest.join('');
  const lastSection = tail.lastIndexOf('</section>');
  const loose = lastSection >= 0 ? tail.slice(lastSection) : '';
  out = rest.length ? head + (lastSection >= 0 ? tail.slice(0, lastSection) + dropPages(loose) : dropPages(tail)) : dropPages(head);
  out = out.replace(/<(cancelfail|passdone|prevpage)>([^<]*)<\/\1>/g, (m, setting: string, page: string) => {
    if (!deleted.has(basename(page))) return m;
    const to = target(page);
    if (!to) return m;
    edit.relinked.push({ setting, from: page, to });
    return `<${setting}>${to}</${setting}>`;
  });

  // Renumber in document order, as Lectora writes them: pages count up through the whole
  // test, and a section's index is the position of its first page (0, 12, 46, …).
  let pageIdx = 0;
  out = out.replace(/(<section>\s*<index>)\d+(<\/index>)|(<page(?:\s[^>]*)?>\s*<index>)\d+(<\/index>)/g, (_m, s1, s2, p1, p2) =>
    s1 !== undefined ? `${s1}${pageIdx}${s2}` : `${p1}${pageIdx++}${p2}`,
  );
  edit.drawn.after = questionsDrawn(out);
  return { xml: out, edit };
}

/** Pages a test lists, for the course check. */
export function testPages(xml: string): string[] {
  return (xml.match(PAGE_BLOCK) ?? []).map(nameOf).filter(Boolean);
}
