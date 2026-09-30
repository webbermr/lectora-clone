/**
 * Course rules: what a course does on its own, read from its pages' scripts.
 *
 * Lectora builds behaviour from triggers and actions:
 *   - triggers: the page opening (`loadActions`), a timer or narration finishing (`progress19923onDone`,
 *     `audio129484onDone`), a button being clicked (`button66713onUp`), an object appearing (`text316actionShow`)
 *   - actions: small functions that may test a condition (`if (Varpageadvance.greaterThan('3'))`) and then
 *     go to a page (`trivExitPage`), show / hide / start objects, change variables, or leave the course.
 * This follows each trigger through its actions and describes the result in plain words. The same rule on
 * hundreds of pages (a timer every page inherits) is reported once, with the pages it's on.
 */
import { textOf } from './assetRefs';
import { declarations } from './lectoraDecl';
import { readLectoraCourse } from './lectora';
import { openTests } from './lectoraTest';
import type { ManifestModel } from './manifest';
import { objectInfos } from './objectTwins';
import type { FileMap } from './package';
import { basename, isHtmlFile } from './paths';

export type RuleCategory = 'timer' | 'narration' | 'open' | 'click' | 'change' | 'password' | 'test' | 'variable';

export interface CourseRule {
  category: RuleCategory;
  /** One line: what starts it. */
  title: string;
  /** What happens, one line each (conditions included). */
  details: string[];
  /** Pages it's on, in course order. */
  pages: string[];
}

export interface RulesReport {
  rules: CourseRule[];
  pagesScanned: number;
}

interface Effect {
  kind: 'jump' | 'exit' | 'show' | 'hide' | 'play' | 'stop' | 'set';
  target: string;
  value?: string;
  when: string[];
  after?: number;
}

interface PageModel {
  page: string;
  funcs: Map<string, string>;
  /** Object id → how to call it in a sentence. */
  label: (id: string) => string;
  /** Page file → "the next page" / "the previous page" / file name. */
  pageLabel: (target: string) => string;
  timers: Map<string, { ms: number; auto: boolean }>;
  media: Map<string, { kind: 'narration' | 'video'; name: string }>;
  secrets: string[];
}

// ---- reading one page ------------------------------------------------------------------------------

const FUNC = /function\s+([\w$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;

function parseFunctions(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(FUNC)) if (!out.has(m[1])) out.set(m[1], m[2]);
  return out;
}

/** Top-level arguments of `new ObjX( … )` as raw strings. */
function declArgs(html: string, id: string): string[] | null {
  const start = html.search(new RegExp(`\\bnew\\s+Obj\\w+\\(\\s*'${id}'`));
  if (start < 0) return null;
  const open = html.indexOf('(', start);
  const args: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = open + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += html[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    if (c === '(') depth++;
    if (c === ')' && depth-- === 0) {
      args.push(cur.trim());
      return args;
    }
    if (c === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  return null;
}

const unquote = (s: string) => s.replace(/^'([\s\S]*)'$|^"([\s\S]*)"$/, '$1$2').replace(/\\(.)/g, '$1');

/** A literal that looks like a password rather than a flag or a number. */
export function looksSecret(s: string): boolean {
  return s.length >= 6 && /[a-z]/i.test(s) && /[\d\W_]/.test(s) && !/^(true|false|null|completed|incomplete|passed|failed)$/i.test(s) && !/\.(html?|png|jpe?g|mp3|mp4)$/i.test(s);
}

export function mask(s: string): string {
  return `${s.slice(0, 2)}${'•'.repeat(Math.max(3, s.length - 2))}`;
}

/** `Varpageadvance.greaterThan('3')` → "Varpageadvance > 3" (and so on), masking password-like literals. */
function condition(raw: string, secrets: string[]): string {
  let c = raw.replace(/\s+/g, ' ').trim();
  const lit = (v: string) => {
    if (looksSecret(v)) {
      secrets.push(v);
      return `"${mask(v)}"`;
    }
    return /^-?\d+(\.\d+)?$/.test(v) ? v : `"${v}"`;
  };
  const ops: [string, string, string][] = [
    ['equals', '=', '≠'],
    ['greaterThan', '>', '≤'],
    ['lessThan', '<', '≥'],
    ['greaterThanEqual', '≥', '<'],
    ['lessThanEqual', '≤', '>'],
    ['contains', 'contains', "doesn't contain"],
    ['notEquals', '≠', '='],
  ];
  for (const [fn, op, notOp] of ops) {
    c = c.replace(new RegExp(`(!?)(Var\\w+)\\.${fn}\\(\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|(Var\\w+)\\.getValue\\(\\))\\s*\\)`, 'g'), (_m, not, v, l, other) =>
      `${v} ${not ? notOp : op} ${l !== undefined ? lit(l) : other}`,
    );
  }
  return c.replace(/&&/g, ' and ').replace(/\|\|/g, ' or ').replace(/\s+/g, ' ').trim();
}

const OPPOSITE: Record<string, string> = { '=': '≠', '≠': '=', '>': '≤', '≤': '>', '<': '≥', '≥': '<', contains: "doesn't contain", "doesn't contain": 'contains' };

/** The "otherwise" of a condition: one comparison is flipped, anything longer is wrapped in not (…). */
function negate(c: string): string {
  if (/ and | or /.test(c)) return `not (${c})`;
  return c.replace(/ (≠|=|≤|≥|>|<|doesn't contain|contains) /, (_m, op: string) => ` ${OPPOSITE[op]} `);
}

/** Everything a function (and the actions it calls) does, with the conditions on each. */
function effectsOf(model: PageModel, name: string, when: string[] = [], seen = new Set<string>(), depth = 0): Effect[] {
  const body = model.funcs.get(name);
  if (body === undefined || seen.has(name) || depth > 8) return [];
  seen.add(name);
  const out: Effect[] = [];
  // Lectora's conditional action: if (COND) { THEN } else { actionNelse(); }
  const cond = /^\s*if\s*\(([\s\S]*?)\)\s*\{([\s\S]*?)\}\s*else\s*\{\s*([\w$]+)\(\s*\)\s*;?\s*\}/.exec(body);
  if (cond) {
    const c = condition(cond[1], model.secrets);
    out.push(...statements(model, cond[2], [...when, c], seen, depth));
    out.push(...effectsOf(model, cond[3], [...when, negate(c)], seen, depth + 1));
    out.push(...statements(model, body.slice(cond.index + cond[0].length), when, seen, depth));
  } else out.push(...statements(model, body, when, seen, depth));
  return out;
}

function statements(model: PageModel, text: string, when: string[], seen: Set<string>, depth: number): Effect[] {
  const out: Effect[] = [];
  const code = text.replace(/if\(fn && typeof\(fn\)[^\n]*\n?|else if\(fn[^\n]*\n?/g, '');
  const RE =
    /trivExitPage\(\s*'([^']*)'|trivScormQuit\(|trivExitCourse\(|\b([\w$]+)\.action(Show|Hide|Play|Stop|Pause)\(|\b(Var\w+)\.(set|add|sub|mult|div)\(|setTimeout\(\s*'([\w$]+)\(\s*\)'\s*,\s*(\d+)\s*\)|\b(action\d+(?:else)?|runGroup_\w+|[\w$]+actionShow)\s*\(\s*\)/g;
  for (const m of code.matchAll(RE)) {
    if (m[1] !== undefined) out.push({ kind: 'jump', target: m[1], when });
    else if (m[0].startsWith('trivScormQuit') || m[0].startsWith('trivExitCourse')) out.push({ kind: 'exit', target: '', when });
    else if (m[2]) out.push({ kind: m[3] === 'Pause' ? 'stop' : (m[3].toLowerCase() as Effect['kind']), target: m[2], when });
    else if (m[4]) out.push({ kind: 'set', target: m[4], value: `${m[5]}:${expression(argument(code, m.index! + m[0].length))}`, when });
    else if (m[6]) out.push(...effectsOf(model, m[6], when, seen, depth + 1).map((e) => ({ ...e, after: (e.after ?? 0) + Number(m[7]) })));
    else if (m[8] && !m[8].endsWith('else')) out.push(...effectsOf(model, m[8], when, seen, depth + 1));
  }
  return out;
}

/** The text of a call's argument, from just after its "(" to the matching ")". */
function argument(code: string, from: number): string {
  let depth = 0;
  let quote = '';
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) return code.slice(from, i).trim();
  }
  return code.slice(from).trim();
}

/**
 * A value as the author set it up: a literal stays text ("1"), anything built from variables is shown as
 * a formula, with Lectora's `'' + X.getValue() + ''` wrapping taken off (so VarA, not ''+VarA.getValue()+'').
 */
function expression(v: string): string {
  if (/^'((?:[^'\\]|\\.)*)'$/.test(v)) return `'${unquote(v)}`;
  return v
    .replace(/(['"])\1\s*\+\s*|\s*\+\s*(['"])\2/g, '')
    .replace(/(\w+)\.getValue\(\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const seconds = (ms: number) => {
  if (ms % 60000 === 0) return `${ms / 60000}-minute`;
  return `${Math.round(ms / 100) / 10}-second`;
};

function describe(model: PageModel, e: Effect): string {
  const who = e.target ? model.label(e.target) : '';
  let what: string;
  switch (e.kind) {
    case 'jump':
      what = `go to ${model.pageLabel(e.target)}`;
      break;
    case 'exit':
      what = 'close the course (ends the LMS session)';
      break;
    case 'show':
      what = `show ${who}`;
      break;
    case 'hide':
      what = `hide ${who}`;
      break;
    case 'play':
      what = `start ${who}`;
      break;
    case 'stop':
      what = `stop ${who}`;
      break;
    case 'set': {
      const [op, raw] = (e.value ?? '').split(/:(.*)/s);
      // A literal (marked with a leading ') is quoted, and masked if it looks like a password; a formula isn't.
      const literal = raw.startsWith("'");
      const v = literal ? raw.slice(1) : raw;
      const shown = !literal ? v : looksSecret(v) ? `"${mask(v)}"` : /^-?\d+(\.\d+)?$/.test(v) ? v : `"${v}"`;
      what = op === 'set' ? `set ${e.target} to ${shown}` : op === 'add' ? `add ${shown} to ${e.target}` : op === 'sub' ? `subtract ${shown} from ${e.target}` : `${op} ${e.target} by ${shown}`;
      break;
    }
    default:
      what = e.kind;
  }
  const delay = e.after ? ` after ${e.after >= 1000 ? `${e.after / 1000} s` : `${e.after} ms`}` : '';
  return `${e.when.length ? `if ${e.when.join(' and ')}: ` : ''}${what}${delay}`;
}

function buildModel(files: FileMap, page: string, order: string[]): PageModel {
  const html = textOf(files[page]);
  const decls = declarations(html);
  const infos = objectInfos(files[page]);
  const funcs = parseFunctions(html);
  const groups = new Map<string, string[]>();
  for (const m of html.matchAll(/\b([\w$]+)\.addChild\(\s*'([\w$]+)'\s*\)/g)) groups.set(m[1], [...(groups.get(m[1]) ?? []), m[2]]);
  const timers = new Map<string, { ms: number; auto: boolean }>();
  const media = new Map<string, { kind: 'narration' | 'video'; name: string }>();
  for (const d of decls.values()) {
    if (d.kind === 'ObjProgress') {
      const a = declArgs(html, d.id);
      // ('id', '', x, y, w, h, type, …, interval, duration, …, autostart): type 1 is a timer.
      if (a && a[6] === '1' && Number(a[15]) > 0) timers.set(d.id, { ms: Number(a[15]), auto: a[18] === '1' });
    }
    if (d.kind === 'ObjMedia') {
      const a = declArgs(html, d.id);
      const file = a?.find((x) => /\.(mp3|m4a|wav|ogg|mp4|webm|m4v|mov|flv)'$/i.test(x)) ?? '';
      media.set(d.id, { kind: /mp4|webm|m4v|mov|flv/i.test(file) ? 'video' : 'narration', name: d.name });
    }
  }
  const idx = order.indexOf(page);
  const text = (id: string) => infos.get(id)?.text ?? '';
  const snippet = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
  const label = (id: string): string => {
    if (timers.has(id)) return `the ${seconds(timers.get(id)!.ms)} timer`;
    if (media.has(id)) return `the ${media.get(id)!.kind}`;
    const d = decls.get(id);
    if (groups.has(id)) {
      const words = groups.get(id)!.map(text).find(Boolean);
      return words ? `the group with "${snippet(words)}"` : `a group of ${groups.get(id)!.length} objects`;
    }
    if (d?.kind === 'ObjButton') return `the "${d.name || id}" button`;
    if (html.includes(`${id}form`)) return `the text box ${d?.name ? `"${d.name}"` : id}`;
    if (text(id)) return `the text "${snippet(text(id))}"`;
    if (d?.name) return `"${d.name}"`;
    return id;
  };
  // Every Lectora page says where its Next and Back go (trivNextPage / trivPrevPage).
  const own = (fn: string) => {
    const m = /trivExitPage\(\s*'([^']*)'/.exec(funcs.get(fn) ?? '');
    return m ? basename(m[1].split('#')[0]) : null;
  };
  const nextOf = own('trivNextPage');
  const prevOf = own('trivPrevPage');
  const pageLabel = (target: string) => {
    const t = basename(target.split('#')[0]);
    if (nextOf === t) return 'the next page';
    if (prevOf === t) return 'the previous page';
    if (idx >= 0 && order[idx + 1] && basename(order[idx + 1]) === t) return 'the next page';
    if (idx > 0 && basename(order[idx - 1]) === t) return 'the previous page';
    if (basename(page) === t) return 'this page again';
    return t;
  };
  return { page, funcs, label, pageLabel, timers, media, secrets: [] };
}

/** An effect worth reporting as a rule (plain navigation and cosmetic shows aren't). */
const notable = (e: Effect, model: PageModel) =>
  e.kind === 'exit' ||
  e.kind === 'set' ||
  (e.kind === 'jump' && (e.when.length > 0 || !/^the (next|previous) page$/.test(model.pageLabel(e.target)))) ||
  (e.kind === 'play' && (model.timers.has(e.target) || model.media.has(e.target))) ||
  (e.when.length > 0 && (e.kind === 'show' || e.kind === 'hide'));

// ---- the whole course ------------------------------------------------------------------------------

/** Scan every page; `onProgress` lets a caller show progress and stay responsive. */
export async function courseRules(files: FileMap, manifest: ManifestModel | null, onProgress?: (done: number, total: number) => Promise<void> | void): Promise<RulesReport> {
  const course = readLectoraCourse(files, manifest);
  const inOrder = new Set(course.order);
  const pages = [...course.order, ...Object.keys(files).filter((f) => isHtmlFile(f) && !inOrder.has(f)).sort()].filter((p) => textOf(files[p]).includes('new Obj'));
  const groups = new Map<string, CourseRule>();
  const add = (category: RuleCategory, title: string, details: string[], page: string) => {
    if (!details.length) return;
    const key = `${category}\n${title}\n${details.join('\n')}`;
    const g = groups.get(key);
    if (g) {
      if (!g.pages.includes(page)) g.pages.push(page);
    } else groups.set(key, { category, title, details, pages: [page] });
  };
  const uniq = (xs: string[]) => [...new Set(xs)];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const model = buildModel(files, page, course.order);
    const triggers: { fn: string; category: RuleCategory; title: string; all?: boolean }[] = [];
    if (model.funcs.has('loadActions')) {
      const calls = [...(model.funcs.get('loadActions') ?? '').matchAll(/\b(action\d+)\s*\(/g)].map((m) => m[1]);
      model.funcs.set('__open', calls.map((c) => `${c}();`).join('\n'));
      triggers.push({ fn: '__open', category: 'open', title: 'When the page opens' });
    }
    // Which trigger starts each timer that doesn't start by itself.
    const startedBy = new Map<string, string>();
    for (const name of model.funcs.keys()) {
      const m = /^([\w$]+?)(onDone|onUp|onSelChg|actionShow)$/.exec(name);
      if (!m) continue;
      const [, obj, ev] = m;
      if (ev === 'onDone' && model.timers.has(obj)) {
        const t = model.timers.get(obj)!;
        triggers.push({ fn: name, category: 'timer', title: `${seconds(t.ms)[0].toUpperCase()}${seconds(t.ms).slice(1)} timer (${t.auto ? 'starts when the page opens' : '§'}) — when it runs out`, all: true });
      } else if (ev === 'onDone' && model.media.has(obj)) {
        triggers.push({ fn: name, category: 'narration', title: `When the ${model.media.get(obj)!.kind} finishes`, all: true });
      } else if (ev === 'onUp') triggers.push({ fn: name, category: 'click', title: `Clicking ${model.label(obj)}` });
      else if (ev === 'onSelChg') triggers.push({ fn: name, category: 'change', title: `Typing or choosing in ${model.label(obj)}` });
      else if (ev === 'actionShow') {
        for (const e of effectsOf(model, name)) if (e.kind === 'play' && model.timers.has(e.target)) startedBy.set(e.target, `starts when ${model.label(obj)} appears`);
      }
    }
    for (const t of triggers) {
      const effects = effectsOf(model, t.fn);
      for (const e of effects) if (e.kind === 'play' && model.timers.has(e.target) && !startedBy.has(e.target)) startedBy.set(e.target, `starts ${t.title.toLowerCase()}`);
    }
    for (const t of triggers) {
      const effects = effectsOf(model, t.fn);
      // A timer or narration ending is a rule in itself; for other triggers keep what matters.
      const kept = t.all ? effects : effects.filter((e) => notable(e, model));
      let title = t.title;
      if (title.includes('§')) {
        const obj = /^([\w$]+?)onDone$/.exec(t.fn)![1];
        title = title.replace('§', startedBy.get(obj) ?? 'started by another action');
      }
      add(t.category, title, uniq(kept.map((e) => describe(model, e))), page);
    }
    // Password-like values the page compares against.
    if (model.secrets.length) {
      for (const s of uniq(model.secrets)) {
        const where = [...model.funcs.entries()].find(([, b]) => b.includes(`'${s}'`));
        const jump = where ? effectsOf(model, where[0]).find((e) => e.kind === 'jump') : undefined;
        add('password', `A password written in the page's code (${mask(s)})`, [jump ? `entering it can ${describe(model, { ...jump, when: [] })}` : 'the page compares a variable with it'], page);
      }
    }
    if (onProgress && i % 10 === 9) await onProgress(i + 1, pages.length);
  }

  // Variables the course saves in the LMS (so they carry over between sessions).
  const vars = new Map<string, { def: string; pages: Set<string> }>();
  for (const page of pages) {
    for (const m of textOf(files[page]).matchAll(/\b(Var\w+)\s*=\s*new\s+Variable\(\s*'[^']*'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,[^)]*?'scorm'/g)) {
      const v = vars.get(m[1]) ?? { def: m[2], pages: new Set<string>() };
      v.pages.add(page);
      vars.set(m[1], v);
    }
  }
  for (const [name, v] of [...vars].sort((a, b) => b[1].pages.size - a[1].pages.size)) {
    groups.set(`variable\n${name}`, { category: 'variable', title: name, details: [`starts as ${looksSecret(v.def) ? `"${mask(v.def)}"` : `"${v.def}"`}, saved in the LMS`], pages: [...v.pages] });
  }

  // The test's own settings.
  const tests = openTests(files);
  if (tests && 'xml' in tests) {
    for (const [file, xml] of tests.xml) {
      // Test-wide settings come before the first section.
      const head = xml.includes('<section>') ? xml.slice(0, xml.indexOf('<section>')) : xml;
      const tag = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(head)?.[1];
      const sections = [...xml.matchAll(/<section>([\s\S]*?)<\/section>/g)].map((m) => ({
        draw: Number(/<numrandom>(\d+)<\/numrandom>/.exec(m[1])?.[1] ?? 0),
        have: (m[1].match(/<question>/g) ?? []).length,
      }));
      const perAttempt = sections.reduce((n, s) => n + (s.draw > 0 ? s.draw : s.have), 0);
      const pool = sections.reduce((n, s) => n + s.have, 0);
      const time = Number(tag('testtime') ?? 0);
      const details = [
        tag('grade') === '1' ? `graded; pass mark ${tag('passinggrade')}%` : 'not graded',
        time > 0 ? `time limit ${time} minutes` : 'no time limit',
        `${perAttempt} questions per attempt${pool !== perAttempt ? `, drawn at random from ${pool}` : ''}${sections.length > 1 ? ` in ${sections.length} sections (${sections.map((s) => `${s.draw || s.have} of ${s.have}`).join(', ')})` : ''}`,
        tag('passdone') ? `when passed: go to ${tag('passdone')}` : '',
        tag('cancelfail') ? `when failed: go to ${tag('cancelfail')}` : '',
        tag('prevpage') ? `Back from the test: ${tag('prevpage')}` : '',
      ].filter(Boolean);
      groups.set(`test\n${file}`, { category: 'test', title: `Test "${tag('name') ?? file}" (${file})`, details, pages: [] });
    }
  } else if (tests && 'error' in tests) {
    groups.set('test\nerror', { category: 'test', title: "The test's settings couldn't be read", details: [tests.error], pages: [] });
  }

  const rank: RuleCategory[] = ['timer', 'narration', 'open', 'click', 'change', 'password', 'test', 'variable'];
  const rules = [...groups.values()].sort((a, b) => rank.indexOf(a.category) - rank.indexOf(b.category) || b.pages.length - a.pages.length);
  return { rules, pagesScanned: pages.length };
}

const HEADINGS: Record<RuleCategory, string> = {
  timer: 'Timers',
  narration: 'When narration or video ends',
  open: 'When a page opens',
  click: 'Buttons with rules',
  change: 'Text boxes and choices',
  password: 'Passwords in the page code',
  test: 'Test settings',
  variable: 'Variables saved in the LMS',
};

export function categoryHeading(c: RuleCategory): string {
  return HEADINGS[c];
}

/** Plain-text version for pasting into an email or a chat. Page lists are shortened. */
export function reportText(r: RulesReport, courseName: string): string {
  const lines = [`Course rules: ${courseName} (${r.pagesScanned} pages scanned)`, ''];
  let last: RuleCategory | null = null;
  for (const rule of r.rules) {
    if (rule.category !== last) {
      lines.push(`## ${HEADINGS[rule.category]}`);
      last = rule.category;
    }
    const where = rule.pages.length ? ` [on ${rule.pages.length} page${rule.pages.length === 1 ? '' : 's'}: ${rule.pages.slice(0, 3).map((p) => basename(p)).join(', ')}${rule.pages.length > 3 ? ', …' : ''}]` : '';
    lines.push(`- ${rule.title}${where}`);
    for (const d of rule.details) lines.push(`    • ${d}`);
  }
  return lines.join('\n');
}
