/**
 * "Answer required" for question pages: the page's Next button stays hidden until the question is answered.
 *
 * Lectora keeps each question's answer in a variable (the test file names it, e.g. VarTMAL1_M1_P3) and treats
 * it as unanswered while that is empty or "~~~null~~~". The editor adds a small script to the page that hides
 * the Next button(s) until either that variable has a value or a choice is picked / text entered on the page
 * (compared with how each input was when the page opened, so pre-set values don't count).
 * Then it steps aside, and Next behaves as Lectora made it (it may still wait for narration, say). Back, the
 * table of contents and auto-advance are untouched.
 *
 * Settings live in the page itself, in `<script id="lc-answer-rule" data-rule="required|optional"
 * data-set="page|default">`: "page" is a choice made for that page, "default" came from the course default.
 * The course default is "required" when any page carries a default-set required rule, otherwise "not required".
 */
import { textOf } from './assetRefs';
import { nextButtons } from './courseRules';
import { openTests } from './lectoraTest';
import type { FileMap } from './package';
import { basename, isHtmlFile } from './paths';
import { partIds } from './removeObjects';

export type AnswerRule = 'required' | 'optional';

export interface QuestionPage {
  /** How it was recognised: listed in the test file, or by its file name. */
  source: 'test' | 'name';
  /** e.g. "Final test question" or "Quiz page (by its name)". */
  label: string;
  /** Answer variables Lectora uses for the page's questions (test pages). */
  vars: string[];
}

const BLOCK = /<script id="lc-answer-rule"[^>]*>[\s\S]*?<\/script>\n?/;
const QUIZ_NAME = /(^|_)(quiz|question|questions|knowledge_?check|kc|self_?check|check_?your_?(knowledge|understanding))(_|\d|\.)/i;

const questionCache = new WeakMap<FileMap, Map<string, QuestionPage>>();

/** Pages with a question: every page the test lists (not its results page), plus pages named like quizzes. */
export function questionPages(files: FileMap): Map<string, QuestionPage> {
  const cached = questionCache.get(files);
  if (cached) return cached;
  const out = new Map<string, QuestionPage>();
  const byName = new Map(Object.keys(files).filter(isHtmlFile).map((p) => [basename(p), p]));
  const tests = openTests(files);
  if (tests && 'xml' in tests) {
    for (const xml of tests.xml.values()) {
      for (const m of xml.matchAll(/<page(?![^>]*hasResults)[^>]*>([\s\S]*?)<\/page>/g)) {
        const name = /<name>([^<]*)<\/name>/.exec(m[1])?.[1];
        const page = name ? byName.get(basename(name)) : undefined;
        if (!page) continue;
        const vars = [...m[1].matchAll(/<var>([^<]*)<\/var>/g)].map((v) => v[1]);
        out.set(page, { source: 'test', label: 'Test question', vars });
      }
    }
  }
  for (const [name, page] of byName) {
    if (!out.has(page) && QUIZ_NAME.test(name.replace(/\.html?$/i, '.'))) out.set(page, { source: 'name', label: 'Quiz page (recognised by its name)', vars: [] });
  }
  questionCache.set(files, out);
  return out;
}

export interface PageRule {
  rule: AnswerRule;
  set: 'page' | 'default';
}

export function readRule(html: string): PageRule | null {
  const tag = /<script id="lc-answer-rule"([^>]*)>/.exec(html)?.[1];
  if (!tag) return null;
  const rule = /data-rule="(required|optional)"/.exec(tag)?.[1] as AnswerRule | undefined;
  const set = /data-set="(page|default)"/.exec(tag)?.[1] as PageRule['set'] | undefined;
  return rule ? { rule, set: set ?? 'page' } : null;
}

/** The script that keeps Next hidden until answered. ES5, so it runs in any LMS browser. */
function guardScript(nextIds: string[], vars: string[]): string {
  const hide = nextIds.flatMap((id) => partIds(id)).map((id) => `#${id}`).join(',');
  return `(function(){
  var vars=${JSON.stringify(vars)}, doc=document, page=window.pgID;
  if(doc.getElementById('lc-answer-guard'))doc.getElementById('lc-answer-guard').parentNode.removeChild(doc.getElementById('lc-answer-guard'));
  var st=doc.createElement('style');st.id='lc-answer-guard';st.appendChild(doc.createTextNode(${JSON.stringify(`${hide}{visibility:hidden!important}`)}));
  (doc.head||doc.documentElement).appendChild(st);
  // Inputs are compared with how they were when first seen, so pre-set choices (a default radio in an
  // options popup) don't count, and custom-drawn choices (hidden inputs) still do when picked.
  function state(e){var t=(e.type||'').toLowerCase();return t=='radio'||t=='checkbox'?(e.checked?'1':'0'):e.tagName=='SELECT'?String(e.selectedIndex):String(e.value||'');}
  function answered(){
    for(var i=0;i<vars.length;i++){var v=window[vars[i]];if(v&&v.getValue){var x=String(v.getValue());if(x&&x!='~~~null~~~')return true;}}
    var els=doc.querySelectorAll('input,textarea,select');
    for(i=0;i<els.length;i++){
      var e=els[i],t=(e.type||'').toLowerCase();if(t=='hidden'||t=='button'||t=='submit'||t=='image'||t=='reset')continue;
      var now=state(e),base=e.getAttribute('data-lc-base');
      if(base===null){e.setAttribute('data-lc-base',now);continue;}
      if(now!==base&&now!=='0'&&now.replace(/\s/g,'')!==''&&now!=='-1')return true;
    }
    return false;
  }
  var timer=setInterval(function(){
    var gone=page!==undefined&&window.pgID!==page;
    if(gone||answered()){clearInterval(timer);if(st.parentNode)st.parentNode.removeChild(st);}
  },250);
})();`;
}

/**
 * The page with this rule (or none). Needs the page's Next buttons for "required"; returns null when there
 * are none to hide, so the caller can say so.
 */
export function setRule(files: FileMap, page: string, rule: PageRule | null): string | null {
  const html = textOf(files[page]);
  const without = html.replace(BLOCK, '');
  if (!rule) return without;
  let script = '';
  if (rule.rule === 'required') {
    const next = nextButtons(files, page).map((b) => b.id);
    if (!next.length) return null;
    script = guardScript(next, questionPages(files).get(page)?.vars ?? []);
  }
  const block = `<script id="lc-answer-rule" data-rule="${rule.rule}" data-set="${rule.set}">${script}</script>\n`;
  const end = /<\/body\s*>/i.exec(without);
  return end ? without.slice(0, end.index) + block + without.slice(end.index) : without + block;
}

const DEFAULT_NOTE = /<!-- scorm-editor answer-default: (required|optional) -->\n?/;

/** The manifest with the course default noted in a comment (LMSs ignore comments; it travels with the package). */
export function noteDefault(manifestXml: string, rule: AnswerRule): string {
  const note = `<!-- scorm-editor answer-default: ${rule} -->\n`;
  if (DEFAULT_NOTE.test(manifestXml)) return manifestXml.replace(DEFAULT_NOTE, note);
  const decl = /^\s*<\?xml[^>]*\?>\s*\n?/.exec(manifestXml);
  return decl ? manifestXml.slice(0, decl[0].length) + note + manifestXml.slice(decl[0].length) : note + manifestXml;
}

/** The course default: as noted in the manifest, else "required" when a question page follows a required default. */
export function courseDefault(files: FileMap): AnswerRule {
  const noted = files['imsmanifest.xml'] ? DEFAULT_NOTE.exec(textOf(files['imsmanifest.xml']))?.[1] : undefined;
  if (noted) return noted as AnswerRule;
  for (const p of questionPages(files).keys()) {
    const r = files[p] ? readRule(textOf(files[p])) : null;
    if (r?.set === 'default' && r.rule === 'required') return 'required';
  }
  return 'optional';
}

/** Page changes that apply a course default to every question page without its own setting. */
export function applyDefault(files: FileMap, rule: AnswerRule): { changes: { path: string; text: string }[]; skipped: string[] } {
  const changes: { path: string; text: string }[] = [];
  const skipped: string[] = [];
  for (const page of questionPages(files).keys()) {
    if (!files[page]) continue;
    const current = readRule(textOf(files[page]));
    if (current?.set === 'page') continue;
    const next = setRule(files, page, rule === 'required' ? { rule, set: 'default' } : null);
    if (next === null) skipped.push(page);
    else if (next !== textOf(files[page])) changes.push({ path: page, text: next });
  }
  if (files['imsmanifest.xml']) {
    const xml = textOf(files['imsmanifest.xml']);
    const noted = noteDefault(xml, rule);
    if (noted !== xml) changes.push({ path: 'imsmanifest.xml', text: noted });
  }
  return { changes, skipped };
}
