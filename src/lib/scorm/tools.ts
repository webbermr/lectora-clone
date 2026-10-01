/**
 * What SCORM (the editor's assistant) can look at and propose, as Claude tools. Every tool reads the open
 * project's files; nothing here changes them. Changes are only ever proposed (propose_edit) and applied by
 * the person, through the editor's normal undoable write.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { textOf } from '../assetRefs';
import { checkCourse } from '../courseCheck';
import { courseRules, forwardNavigation, reportText } from '../courseRules';
import { declarations } from '../lectoraDecl';
import { openTests } from '../lectoraTest';
import type { ManifestModel } from '../manifest';
import { objectInfos, sameObjectEverywhere } from '../objectTwins';
import type { FileMap } from '../package';
import { isHtmlFile, isTextFile } from '../paths';
import { hiddenIds } from '../removeObjects';
import { readRule } from '../answerRule';

export interface ToolContext {
  files: FileMap;
  manifest: ManifestModel | null;
  courseName: string;
}

/** A change SCORM suggests: replace `find` (which occurs exactly once) with `replace` in `path`. */
export interface Proposal {
  id: string;
  path: string;
  find: string;
  replace: string;
  summary: string;
  /**
   * The same change on other pages that have the same object (an inherited object, or a chapter's own copy
   * under another id), for the person to apply on this page only or everywhere.
   */
  elsewhere?: { path: string; find: string; replace: string }[];
  /** The object the change is in, when it could be told. */
  object?: { id: string; name: string };
}

export type ToolOutcome = { content: string; isError?: boolean; proposal?: Proposal; label: string };

const READ_LIMIT = 40000;
const SEARCH_BEFORE = 150;
const SEARCH_AFTER = 400;
const SEARCH_MAX = 200;

const str = (description: string) => ({ type: 'string', description }) as const;
const int = (description: string) => ({ type: 'integer', description }) as const;

/** Tool definitions, in a fixed order so the request prefix stays cacheable. */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_files',
    description:
      'List files in the SCORM package with their sizes. Use a prefix to narrow it (e.g. "images/" or "a001_reporting"). Returns at most 500 entries.',
    input_schema: { type: 'object', properties: { prefix: str('Only files whose path starts with this.') }, required: [] },
  },
  {
    name: 'read_file',
    description: `Read a text file from the package (HTML, JS, CSS, XML, TXT). Returns up to ${READ_LIMIT} characters starting at offset; the result says how long the file is so you can read further.`,
    input_schema: {
      type: 'object',
      properties: { path: str('Package path, e.g. "a001_technology_welcome.html".'), offset: int('Character offset to start at (default 0).') },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search the text files of the package for a regular expression (case-insensitive). Each match comes as path:line (offset N): the text around the match. Matches with the same text in many files (an inherited object) are listed once with the files they are in. To see more of a line, read_file from its offset. Use path_prefix to narrow the search.',
    input_schema: {
      type: 'object',
      properties: { pattern: str('JavaScript regular expression.'), path_prefix: str('Only search files whose path starts with this.') },
      required: ['pattern'],
    },
  },
  {
    name: 'page_overview',
    description:
      "Summarise a Lectora page: title, every object it declares (kind, id, name, position and size, visible text or image), where Next and Back go, objects hidden by this editor, and any answer rule. Read this before the page's HTML.",
    input_schema: { type: 'object', properties: { path: str('Package path of the page.') }, required: ['path'] },
  },
  {
    name: 'course_check',
    description: 'Run the editor\'s course check: broken links, missing files, manifest problems, and other issues across the whole package.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'course_rules',
    description:
      'Describe the rules the course enforces (timers, lockouts, what happens when narration ends, button conditions, test settings, variables saved in the LMS), for one page or the whole course. Passwords found in page code are masked.',
    input_schema: { type: 'object', properties: { path: str('A page to report on; omit for the whole course.') }, required: [] },
  },
  {
    name: 'propose_edit',
    description:
      'Propose a change to a text file: replace `find` (copied exactly from the current file, and occurring exactly once in it) with `replace`. Nothing changes until the person reviews it and clicks Apply; they can undo it afterwards. Keep each proposal small and focused; make several for several changes. When the change is in a Lectora object that also appears on other pages (an inherited object such as a copyright line or a button, or a chapter\'s own copy of it), the editor finds those pages itself and lets the person apply it on this page only or on all of them: propose it once, on the page being discussed.',
    input_schema: {
      type: 'object',
      properties: {
        path: str('Package path of the file to change.'),
        find: str('Exact current text to replace. Include enough surrounding text that it occurs only once.'),
        replace: str('The new text.'),
        summary: str('One short sentence saying what the change does, for the person approving it.'),
      },
      required: ['path', 'find', 'replace', 'summary'],
    },
  },
];

const isString = (v: unknown): v is string => typeof v === 'string';

/** How many times `needle` occurs in `hay` (stops counting at 2). */
function occurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  const first = hay.indexOf(needle);
  if (first < 0) return 0;
  return hay.indexOf(needle, first + 1) < 0 ? 1 : 2;
}

/** Why a proposal can't be applied to the file as it is now, or null when it can. */
export function proposalProblem(files: FileMap, p: Pick<Proposal, 'path' | 'find' | 'replace'>): string | null {
  if (!files[p.path]) return `${p.path} isn't in the package.`;
  if (!isTextFile(p.path)) return `${p.path} isn't a text file.`;
  if (p.find === p.replace) return 'The new text is the same as the old.';
  const n = occurrences(textOf(files[p.path]), p.find);
  if (n === 0) return `The text to replace isn't in ${p.path} (it may have changed).`;
  if (n > 1) return `The text to replace occurs more than once in ${p.path}; include more of the surrounding text.`;
  return null;
}

/** The file's text with the change applied. Assumes proposalProblem() returned null. */
export function applyProposal(files: FileMap, p: Pick<Proposal, 'path' | 'find' | 'replace'>): string {
  const text = textOf(files[p.path]);
  const at = text.indexOf(p.find);
  return text.slice(0, at) + p.replace + text.slice(at + p.find.length);
}

/** The Lectora object whose script line holds the text at `index` (`text5.addInnerText(…)`, `text5 = new ObjText(…)`). */
export function objectAt(html: string, index: number): string | null {
  const start = html.lastIndexOf('\n', index) + 1;
  const end = html.indexOf('\n', index);
  const line = html.slice(start, end < 0 ? undefined : end);
  const id = /^\s*([A-Za-z_$][\w$]*)\s*(?:=\s*new\s+Obj\w+\s*\(|\.\w+\s*\()/.exec(line)?.[1];
  return id && declarations(html).has(id) ? id : null;
}

/**
 * Where else the same change applies: pages that have the same object as the one the change is in, where
 * the text to replace (with that page's id for the object, when its copy has another) occurs exactly once.
 */
export function sameChangeElsewhere(files: FileMap, path: string, find: string, replace: string): Pick<Proposal, 'elsewhere' | 'object'> {
  const html = textOf(files[path]);
  const id = objectAt(html, html.indexOf(find));
  if (!id) {
    // Not in an object the editor can name: pages with exactly the same text (long enough not to be a fragment).
    if (find.trim().length < 15) return {};
    const elsewhere = Object.keys(files)
      .sort()
      .filter((p) => p !== path && isHtmlFile(p) && !proposalProblem(files, { path: p, find, replace }))
      .map((p) => ({ path: p, find, replace }));
    return elsewhere.length ? { elsewhere } : {};
  }
  const object = { id, name: declarations(html).get(id)?.name ?? '' };
  const swap = (s: string, other: string) => (other === id ? s : s.split(id).join(other));
  const elsewhere: NonNullable<Proposal['elsewhere']> = [];
  for (const ref of sameObjectEverywhere(files, path, id)) {
    if (ref.page === path) continue;
    const change = { path: ref.page, find: swap(find, ref.id), replace: swap(replace, ref.id) };
    if (!proposalProblem(files, change)) elsewhere.push(change);
  }
  return { elsewhere, object };
}

let proposalCount = 0;

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const { files } = ctx;
  const fail = (content: string, label: string): ToolOutcome => ({ content, isError: true, label });
  switch (name) {
    case 'list_files': {
      const prefix = isString(args.prefix) ? args.prefix : '';
      const paths = Object.keys(files).filter((p) => p.startsWith(prefix)).sort();
      const lines = paths.slice(0, 500).map((p) => `${p}\t${files[p].length}`);
      const more = paths.length > 500 ? `\n… and ${paths.length - 500} more; narrow it with a prefix.` : '';
      return { content: `${paths.length} files\n${lines.join('\n')}${more}`, label: prefix ? `Listed files starting "${prefix}"` : 'Listed the package files' };
    }
    case 'read_file': {
      if (!isString(args.path)) return fail('path is required.', 'Read a file');
      const path = args.path;
      if (!files[path]) return fail(`${path} isn't in the package. Use list_files to find the right path.`, `Read ${path}`);
      if (!isTextFile(path)) return fail(`${path} isn't a text file (${files[path].length} bytes).`, `Read ${path}`);
      const text = textOf(files[path]);
      const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0;
      const part = text.slice(offset, offset + READ_LIMIT);
      const end = offset + part.length;
      const note = end < text.length ? `\n\n[Characters ${offset}–${end} of ${text.length}. Read on with offset ${end}.]` : offset ? `\n\n[Characters ${offset}–${end} of ${text.length}.]` : '';
      return { content: part + note, label: `Read ${path}` };
    }
    case 'search_files': {
      if (!isString(args.pattern)) return fail('pattern is required.', 'Searched the package');
      let re: RegExp;
      try {
        re = new RegExp(args.pattern, 'i');
      } catch (e) {
        return fail(`Not a valid regular expression: ${(e as Error).message}`, 'Searched the package');
      }
      const prefix = isString(args.path_prefix) ? args.path_prefix : '';
      // Lectora writes a text object's whole styled HTML on one long line, so each match is shown with the
      // text around it (not the start of the line), with its character offset for read_file. A line that is
      // the same in many files (an inherited footer) is shown once, with the files it's in.
      const hits = new Map<string, { first: string; offset: number; more: string[] }>();
      let lineCount = 0;
      let truncated = false;
      for (const p of Object.keys(files).sort()) {
        if (!p.startsWith(prefix) || !isTextFile(p)) continue;
        const text = textOf(files[p]);
        let lineStart = 0;
        let lineNo = 0;
        for (const line of text.split('\n')) {
          lineNo++;
          const m = re.exec(line);
          if (m) {
            const from = Math.max(0, m.index - SEARCH_BEFORE);
            const to = Math.min(line.length, m.index + m[0].length + SEARCH_AFTER);
            const excerpt = `${from > 0 ? '…' : ''}${line.slice(from, to).trim()}${to < line.length ? '…' : ''}`;
            const seen = hits.get(excerpt);
            if (seen) seen.more.push(`${p}:${lineNo}`);
            else if (hits.size < SEARCH_MAX) hits.set(excerpt, { first: `${p}:${lineNo}`, offset: lineStart + m.index, more: [] });
            else truncated = true;
            lineCount++;
          }
          lineStart += line.length + 1;
        }
      }
      if (!hits.size) return { content: 'No matches.', label: `Searched for "${args.pattern}"` };
      const out = [...hits].map(([excerpt, h]) => {
        const also = h.more.length ? `\n  (the same text is also in ${h.more.length} more: ${h.more.slice(0, 40).join(', ')}${h.more.length > 40 ? ', …' : ''})` : '';
        return `${h.first} (offset ${h.offset}): ${excerpt}${also}`;
      });
      const head = `${lineCount} matching lines (${hits.size} different)${truncated ? `; only the first ${SEARCH_MAX} different ones are shown, narrow the search` : ''}. Excerpts show up to ${SEARCH_BEFORE} characters before and ${SEARCH_AFTER} after each match; read_file with the offset shows more.`;
      return { content: [head, ...out].join('\n'), label: `Searched for "${args.pattern}"` };
    }
    case 'page_overview': {
      if (!isString(args.path)) return fail('path is required.', 'Looked at a page');
      const path = args.path;
      if (!files[path] || !isHtmlFile(path)) return fail(`${path} isn't an HTML page in the package.`, `Looked at ${path}`);
      return { content: pageOverview(files, path), label: `Looked at ${path}` };
    }
    case 'course_check': {
      const tests = openTests(files);
      const r = checkCourse(files, ctx.manifest, tests);
      const lines = r.issues.slice(0, 300).map((i) => `[${i.severity}] ${i.kind}: ${i.message}${i.file ? ` (${i.file})` : ''}`);
      const more = r.issues.length > 300 ? `\n… and ${r.issues.length - 300} more.` : '';
      const chain = r.nextChain ? `\nFollowing Next from the first page: ${r.nextChain.length} pages, ending at ${r.nextChain.endsAt}.` : '';
      return { content: `${r.pagesChecked} pages checked, ${r.issues.length} issues.${chain}\n${lines.join('\n')}${more}`, label: 'Ran the course check' };
    }
    case 'course_rules': {
      const page = isString(args.path) ? args.path : null;
      if (page && !files[page]) return fail(`${page} isn't in the package.`, 'Read the course rules');
      const scope = page ? { ...pickPage(files, page) } : files;
      const report = await courseRules(scope, page ? null : ctx.manifest);
      return { content: reportText(report, ctx.courseName), label: page ? `Read the rules on ${page}` : 'Read the course rules' };
    }
    case 'propose_edit': {
      const { path, find, replace, summary } = args;
      if (!isString(path) || !isString(find) || !isString(replace) || !isString(summary)) {
        return fail('INVALID_INPUT: path, find, replace and summary are all required strings.', 'Proposed a change');
      }
      const problem = proposalProblem(files, { path, find, replace });
      if (problem) return fail(problem, `Proposed a change to ${path}`);
      const proposal: Proposal = { id: `p${++proposalCount}`, path, find, replace, summary, ...sameChangeElsewhere(files, path, find, replace) };
      const more = proposal.elsewhere?.length
        ? ` The changed text is in ${proposal.object ? proposal.object.id : 'text that'}, which is also on ${proposal.elsewhere.length} other page${proposal.elsewhere.length === 1 ? '' : 's'} (${proposal.elsewhere.slice(0, 10).map((e) => e.path).join(', ')}${proposal.elsewhere.length > 10 ? ', …' : ''}); the person is offered this page only or all of them, so don't propose those pages separately.`
        : '';
      return {
        content: `Proposal ${proposal.id} is shown to the person for review. It is not applied yet; you will be told if they apply or dismiss it.${more}`,
        proposal,
        label: `Proposed a change to ${path}`,
      };
    }
    default:
      return fail(`Unknown tool ${name}.`, name);
  }
}

/** Just one page (and the scripts it needs), for a per-page rules report. */
function pickPage(files: FileMap, page: string): FileMap {
  const out: FileMap = { [page]: files[page] };
  for (const p of Object.keys(files)) if (!isHtmlFile(p)) out[p] = files[p];
  return out;
}

export function pageOverview(files: FileMap, path: string): string {
  const html = textOf(files[path]);
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const infos = objectInfos(files[path]);
  const decls = declarations(html);
  const lines: string[] = [`Page: ${path}`, `Title: ${title || '(none)'}`];
  const next = /function\s+trivNextPage\s*\(\s*\)\s*\{\s*trivExitPage\(\s*['"]([^'"]+)/.exec(html)?.[1];
  const prev = /function\s+trivPrevPage\s*\(\s*\)\s*\{\s*trivExitPage\(\s*['"]([^'"]+)/.exec(html)?.[1];
  if (next) lines.push(`Next page: ${next}`);
  if (prev) lines.push(`Previous page: ${prev}`);
  const forward = forwardNavigation(files, path).buttons;
  if (forward.length) lines.push(`Buttons that move on: ${forward.map((b) => `${b.id} (${b.label})`).join(', ')}`);
  const hidden = hiddenIds(html);
  if (hidden.length) lines.push(`Hidden by this editor: ${hidden.join(', ')}`);
  const rule = readRule(html);
  if (rule) lines.push(`Answer rule (set in this editor): ${rule.rule}${rule.set === 'default' ? ' (course default)' : ''}`);
  lines.push('', `Objects (${decls.size}): kind id "name" x,y w×h — content`);
  for (const [id, d] of decls) {
    const info = infos.get(id);
    const content = info?.text ? `text: ${info.text.slice(0, 200)}` : info?.image ? `image: ${info.image}` : '';
    lines.push(`${d.kind} ${id} "${d.name}" ${d.x},${d.y} ${d.w}×${d.h}${content ? ` — ${content}` : ''}`);
  }
  return lines.join('\n');
}
