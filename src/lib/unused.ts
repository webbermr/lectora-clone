/**
 * Files nothing in the course uses, so a publish can leave them out.
 *
 * Starting from what the manifest launches, a file is in use when a file already in use mentions it: by file
 * name ('images/logo.png', "a001_next.html"), or by name without its extension, which is how Lectora loads its
 * test ('_tobj3566') and how scripts often build names ('images/' + id + '.png'). The manifest's own list of
 * files doesn't count, since Lectora lists every file there. This errs towards keeping: any mention keeps a file,
 * whatever it was mentioned for.
 */
import { textOf } from './assetRefs';
import type { ManifestModel } from './manifest';
import type { FileMap } from './package';
import { basename, isTextFile } from './paths';

export interface UnusedReport {
  paths: string[];
  bytes: number;
}

const TOKEN = /[\w$.\-%]+/g;
// Names the token pattern can't cover in one piece (spaces, brackets…) are looked for as plain text instead.
const PLAIN = /^[\w$.\-]+$/;
/**
 * Always kept: the schemas the manifest validates against, and the course player's own runtime and test
 * files (Lectora's trivantis scripts and styles, enc.js, jQuery, the media player, the SCORM wrapper,
 * _tobjNNN test files). They're small, a course can load them in ways that don't name them, and without
 * them it doesn't run.
 */
const ALWAYS =
  /(\.(xsd|dtd)$)|(^|\/)(trivantis[\w.-]*|jquery[\w.-]*|mediaelement[\w.-]*|es6-promise[\w.-]*|enc|aria-utils|apiwrapper\w*|scofunctions|dialog|scorm_?api\w*)\.(js|css)$|(^|\/)_tobj\w*\.txt$/i;

const stemOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

export function findUnused(files: FileMap, manifest: ManifestModel | null): UnusedReport {
  const all = Object.keys(files);
  if (!manifest || !files['imsmanifest.xml']) return { paths: [], bytes: 0 };

  // Name and name-without-extension → files, for looking up what a text mentions.
  const byName = new Map<string, string[]>();
  const add = (key: string, path: string) => {
    const k = key.toLowerCase();
    const list = byName.get(k);
    if (list) list.push(path);
    else byName.set(k, [path]);
  };
  const odd: string[] = [];
  for (const p of all) {
    const name = basename(p);
    if (PLAIN.test(name)) {
      add(name, p);
      const stem = stemOf(name);
      if (stem !== name && stem.length >= 3) add(stem, p);
    } else odd.push(p);
  }

  const used = new Set<string>();
  const queue: string[] = [];
  const use = (p: string) => {
    if (!files[p] || used.has(p)) return;
    used.add(p);
    if (isTextFile(p)) queue.push(p);
  };
  const scan = (text: string) => {
    for (const m of text.matchAll(TOKEN)) {
      let t = m[0].toLowerCase();
      if (t.includes('%')) {
        try {
          t = decodeURIComponent(t);
        } catch {
          /* not encoded after all */
        }
      }
      // Trailing dots from sentences ("see logo.png.") and leading ones from paths ("./x.html").
      t = t.replace(/^\.+|\.+$/g, '');
      const hit = byName.get(t);
      if (hit) hit.forEach(use);
    }
    for (const p of odd) {
      if (used.has(p)) continue;
      const name = basename(p);
      if (text.includes(name) || text.includes(encodeURI(name)) || text.includes(encodeURIComponent(name))) use(p);
    }
  };

  // What the manifest launches and points at, but not its list of every file.
  used.add('imsmanifest.xml');
  for (const r of manifest.resources) if (r.href) use(r.href);
  for (const p of all) if (ALWAYS.test(p)) use(p);
  scan(textOf(files['imsmanifest.xml']).replace(/<(?:\w+:)?file\b[^>]*>/gi, ''));

  while (queue.length) scan(textOf(files[queue.shift()!]));

  const paths = all.filter((p) => !used.has(p)).sort();
  return { paths, bytes: paths.reduce((n, p) => n + files[p].length, 0) };
}
