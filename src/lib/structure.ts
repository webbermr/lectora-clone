/**
 * Which package files belong to which module/section/page, as declared in
 * imsmanifest.xml: an item's resource lists its files, and <dependency>
 * pulls in shared resources. A module (an item with children) owns what its
 * pages own.
 */
import { flattenItems, type ItemNode, type ManifestModel } from './manifest';
import { referencedAssets } from './assetRefs';
import type { FileMap } from './package';
import { splitQuery } from './paths';

export interface FileIndex {
  /** Files each item uses, including its dependencies and, for modules, its children's. */
  itemFiles: Map<string, string[]>;
  /** Items (pages/SCOs with a resource) that use each file. */
  fileItems: Map<string, ItemNode[]>;
  /** Top-level modules that use each file. */
  fileModules: Map<string, ItemNode[]>;
  /** Files in the package that no item claims. */
  unlisted: string[];
}

export function buildFileIndex(manifest: ManifestModel, packageFiles: string[]): FileIndex {
  const resById = new Map(manifest.resources.map((r) => [r.identifier, r]));
  const exists = new Set(packageFiles);

  const resourceFiles = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    const res = resById.get(id);
    if (!res || seen.has(id)) return out;
    seen.add(id);
    if (res.href) out.add(splitQuery(res.href).path);
    for (const f of res.files) out.add(f);
    for (const dep of res.dependencies) for (const f of resourceFiles(dep, seen)) out.add(f);
    return out;
  };

  const itemFiles = new Map<string, string[]>();
  const fileItems = new Map<string, ItemNode[]>();
  const fileModules = new Map<string, ItemNode[]>();

  const visit = (item: ItemNode): Set<string> => {
    const own = item.identifierref ? resourceFiles(item.identifierref) : new Set<string>();
    for (const f of own) {
      if (!fileItems.has(f)) fileItems.set(f, []);
      fileItems.get(f)!.push(item);
    }
    const all = new Set(own);
    for (const child of item.children) for (const f of visit(child)) all.add(f);
    const list = [...all].filter((f) => exists.has(f)).sort();
    itemFiles.set(item.identifier, list);
    return all;
  };

  for (const top of manifest.items) {
    for (const f of visit(top)) {
      if (!fileModules.has(f)) fileModules.set(f, []);
      const mods = fileModules.get(f)!;
      if (!mods.includes(top)) mods.push(top);
    }
  }

  const claimed = new Set(fileItems.keys());
  const unlisted = packageFiles.filter((f) => f !== 'imsmanifest.xml' && !claimed.has(f) && !/\.xsd$|\.dtd$/i.test(f)).sort();
  return { itemFiles, fileItems, fileModules, unlisted };
}

/** Number of pages (items with a launch file) under an item, itself included. */
export function pageCount(item: ItemNode): number {
  return flattenItems([item]).filter((i) => i.href).length;
}

// ---------------------------------------------------------------------------
// Lectora: chapters/sections recovered from page file names
// ---------------------------------------------------------------------------

/**
 * Lectora usually publishes a whole title as one SCO, so the manifest has a
 * single item. Its chapters survive in the page file names, which Lectora
 * builds as `a001_<chapter>_<page>.html` and lists in course order:
 *   a001_industry_overview_welcome.html, a001_industry_overview_quiz_question_1.html, ...
 * Consecutive pages that share a leading name form a chapter; long runs
 * inside a chapter that share a longer prefix (test sections) form sections.
 * Asset ownership comes from scanning each page's HTML, because Lectora puts
 * every image and sound into one shared resource.
 */
export interface InferredStructure {
  modules: ItemNode[];
  index: FileIndex;
  pageCount: number;
}

const LECTORA_PAGE = /^(a\d{3})_(.+)\.html?$/i;
const SECTION_MIN = 5;

export function isLectoraPackage(manifestXml: string, files: FileMap): boolean {
  return /Lectora/i.test(manifestXml.slice(0, 600)) || 'trivantis.js' in files;
}

export function inferLectoraStructure(manifest: ManifestModel, files: FileMap): InferredStructure | null {
  // Page order: as the manifest lists them (course order), then any stragglers.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const take = (f: string) => {
    if (!seen.has(f) && files[f] && LECTORA_PAGE.test(f) && !/_toc\d*\.html?$/i.test(f)) {
      seen.add(f);
      ordered.push(f);
    }
  };
  for (const r of manifest.resources) for (const f of r.files) take(f);
  for (const f of Object.keys(files).sort()) take(f);
  if (ordered.length < 3) return null;

  const pages = ordered.map((path) => {
    const m = LECTORA_PAGE.exec(path)!;
    return { path, au: m[1], tokens: m[2].split('_').filter(Boolean) };
  });
  const titles = pageTitles(ordered, files);

  // Chapters: consecutive runs sharing the first name token (within one AU).
  const runs: (typeof pages)[] = [];
  for (const p of pages) {
    const last = runs.at(-1);
    if (last && last[0].au === p.au && last[0].tokens[0] === p.tokens[0]) last.push(p);
    else runs.push([p]);
  }

  const pageNode = (p: (typeof pages)[number], dropTokens: number): ItemNode => ({
    identifier: 'lectora:page:' + p.path,
    title: titles.get(p.path) ?? prettify(p.tokens.slice(dropTokens).join('_') || p.tokens.join('_')),
    href: p.path,
    query: '',
    children: [],
  });

  const modules: ItemNode[] = runs.map((run) => {
    const k = commonPrefix(run.map((p) => p.tokens), run.length > 1 ? 0 : 1);
    const name = run[0].tokens.slice(0, Math.max(1, k)).join('_');
    const children: ItemNode[] = [];
    // Sections: long runs whose remaining names share their first two tokens.
    let i = 0;
    while (i < run.length) {
      const key = run[i].tokens.slice(k, k + 2).join('_');
      let j = i;
      while (j < run.length && run[j].tokens.length >= k + 2 && run[j].tokens.slice(k, k + 2).join('_') === key) j++;
      if (j - i >= SECTION_MIN && j - i < run.length) {
        children.push({
          identifier: `lectora:sec:${name}:${key}:${i}`,
          title: prettify(key),
          query: '',
          children: run.slice(i, j).map((p) => pageNode(p, k + 2)),
        });
        i = j;
      } else {
        children.push(pageNode(run[i], k));
        i++;
      }
    }
    return { identifier: `lectora:mod:${name}:${modulesKey(run)}`, title: prettify(name), query: '', children };
  });

  // File ownership from each page's references.
  const itemFiles = new Map<string, string[]>();
  const fileItems = new Map<string, ItemNode[]>();
  const fileModules = new Map<string, ItemNode[]>();
  const visit = (item: ItemNode, module: ItemNode): Set<string> => {
    const all = new Set<string>();
    if (item.href) {
      const own = [item.href, ...referencedAssets(item.href, files)];
      for (const f of own) {
        all.add(f);
        if (!fileItems.has(f)) fileItems.set(f, []);
        fileItems.get(f)!.push(item);
        if (!fileModules.has(f)) fileModules.set(f, []);
        const mods = fileModules.get(f)!;
        if (!mods.includes(module)) mods.push(module);
      }
    }
    for (const c of item.children) for (const f of visit(c, module)) all.add(f);
    itemFiles.set(item.identifier, [...all].sort());
    return all;
  };
  for (const mod of modules) visit(mod, mod);

  const unlisted = Object.keys(files)
    .filter((f) => !fileItems.has(f) && f !== 'imsmanifest.xml' && !/\.(xsd|dtd)$/i.test(f))
    .sort();
  return { modules, index: { itemFiles, fileItems, fileModules, unlisted }, pageCount: ordered.length };
}

function modulesKey(run: { path: string }[]): string {
  return run[0].path;
}

/** Number of leading tokens every name shares, leaving at least `keep` tokens for the page. */
function commonPrefix(names: string[][], keep: number): number {
  let k = 0;
  while (names.every((n) => n.length > k + keep) && new Set(names.map((n) => n[k])).size === 1) k++;
  return k;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

// File names drop apostrophes: "let_s_review", "don_t_listen", "you_re".
const CONTRACTION = new Set(['s', 't', 're', 'll', 've']);

export function prettify(slug: string): string {
  const words: string[] = [];
  for (const w of slug.split(/[_\-]+/).filter(Boolean)) {
    if (words.length && CONTRACTION.has(w.toLowerCase())) words[words.length - 1] += "'" + w.toLowerCase();
    else words.push(w);
  }
  return words
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Real page titles from each page's <title>, when they're informative.
 * Lectora often gives every page the course's title, in which case we fall
 * back to the file name.
 */
function pageTitles(paths: string[], files: FileMap): Map<string, string> {
  const found = new Map<string, string>();
  const counts = new Map<string, number>();
  const head = new TextDecoder();
  for (const p of paths) {
    const text = head.decode(files[p].subarray(0, 4096));
    const t = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    found.set(p, decodeEntities(t));
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  for (const [p, t] of found) {
    // Titles shared by many pages (the course name) say nothing about the page.
    if ((counts.get(t) ?? 0) > 2) found.delete(p);
  }
  return found;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
