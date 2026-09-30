/**
 * "Answer required" for question pages: the page's Next button stays hidden until the question is answered
 * (a Submit button, which scores the answer and moves on, stays visible but does nothing until then).
 *
 * Lectora keeps each question's answer in a variable (the test file names it, e.g. VarTMAL1_M1_P3) and treats
 * it as unanswered while that is empty or "~~~null~~~". The editor adds a small script to the page that hides
 * the Next button(s) until either that variable has a value or a choice is picked / text entered on the page
 * (compared with how each input was when the page opened, so pre-set values don't count).
 * Then it steps aside, and Next behaves as Lectora made it (it may still wait for narration, say).
 * Until then it also stops the page moving itself on to the next page (auto-advance when the narration ends):
 * a move there that no click or key press asked for is dropped. Back, the table of contents and moves to
 * other pages (a session timeout, say) are untouched.
 *
 * Settings live in the page itself, in `<script id="lc-answer-rule" data-rule="required|optional"
 * data-set="page|default">`: "page" is a choice made for that page, "default" came from the course default.
 * The course default is "required" when any page carries a default-set required rule, otherwise "not required".
 */
import { textOf } from './assetRefs';
import { forwardNavigation } from './courseRules';
import { openTests } from './lectoraTest';
import type { FileMap } from './package';
import { basename, isHtmlFile } from './paths';
import { partIds } from './removeObjects';

export type AnswerRule = 'required' | 'optional';

export interface QuestionPage {
  /** How it was recognised: listed in the test file, a Lectora question on the page, or its file name. */
  source: 'test' | 'content' | 'name';
  /** e.g. "Final test question" or "Quiz page (by its name)". */
  label: string;
  /** Answer variables Lectora uses for the page's questions (test pages). */
  vars: string[];
}

const BLOCK = /<script id="lc-answer-rule"[^>]*>[\s\S]*?<\/script>\n?/;
const QUIZ_NAME = /(^|_)(quiz|question|questions|knowledge_?check|kc|self_?check|check_?your_?(knowledge|understanding))(_|\d|\.)/i;

const questionCache = new WeakMap<FileMap, Map<string, QuestionPage>>();

/** A page Lectora put a question on declares it: `var trivQuestionArray=[qu166063];`. */
const HAS_QUESTION = /\btrivQuestionArray\s*=\s*\[\s*[\w$]/;

/**
 * The variables a page's questions keep their answers in. Lectora writes one updater per question:
 *   function Update_qu166063(value) { if(typeof(value) !== "undefined")  VarQUIZ_M3_P7.set(value) …
 */
export function answerVariables(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/function\s+Update_qu\w+\s*\([^)]*\)\s*\{[^{}]{0,200}?\b([A-Za-z_$][\w$]*)\.set\(/g)) out.add(m[1]);
  return [...out];
}

/**
 * Pages with a question: every page the test lists (not its results page), every page with a Lectora
 * question on it (module quizzes), and pages named like quizzes.
 */
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
  for (const page of byName.values()) {
    if (out.has(page)) continue;
    const html = textOf(files[page]);
    if (HAS_QUESTION.test(html)) out.set(page, { source: 'content', label: 'Quiz question', vars: answerVariables(html) });
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

/** Bumped whenever the guard script changes, so pages carrying an older copy can be spotted and refreshed. */
export const GUARD_VERSION = 5;

/**
 * The script that holds the learner on a question page until it's answered. ES5, so it runs in any LMS browser.
 *
 * Lectora's page player runs each page's scripts in a hidden frame and draws the page in the player's own
 * window (getDisplayWindow / getDisplayDocument). So the page's variables, button objects and trivExitPage
 * live in this script's window, while the elements the learner sees and clicks live in the display document.
 * Without the player the two are the same.
 */
function guardScript(hideIds: string[], blockIds: string[], vars: string[], targets: string[]): string {
  const hide = hideIds.flatMap((id) => partIds(id)).map((id) => `#${id}`).join(',');
  return `(function(){
  var vars=${JSON.stringify(vars)}, targets=${JSON.stringify(targets)}, block=${JSON.stringify(blockIds)}, css=${JSON.stringify(hide ? `${hide}{visibility:hidden!important}` : '')};
  var page=window.pgID, done=false, timer=null;
  function display(){try{if(typeof getDisplayDocument=='function'){var d=getDisplayDocument();if(d&&d.getElementById)return d;}}catch(e){}return document;}
  function docs(){var d=display();return d===document?[document]:[d,document];}
  function wins(){var out=[],ds=docs();for(var i=0;i<ds.length;i++){var w=ds[i].defaultView;if(w&&out.indexOf(w)<0)out.push(w);}if(out.indexOf(window)<0)out.push(window);return out;}
  // Next is hidden with a style in the document the learner sees (added again if the page redraws).
  function style(){
    if(!css)return;
    var ds=docs();
    for(var i=0;i<ds.length;i++)if(!ds[i].getElementById('lc-answer-guard')){var st=ds[i].createElement('style');st.id='lc-answer-guard';st.appendChild(ds[i].createTextNode(css));(ds[i].head||ds[i].documentElement).appendChild(st);}
  }
  function unstyle(){var ds=docs();for(var i=0;i<ds.length;i++){var st=ds[i].getElementById('lc-answer-guard');if(st&&st.parentNode)st.parentNode.removeChild(st);}}
  // Submit stays on screen (it's how the learner answers), but does nothing until there is an answer.
  var told=0;
  function tell(){
    var now=new Date().getTime();if(now-told<600)return;told=now;
    var d=display(),n=d.getElementById('lc-answer-note');if(n)n.parentNode.removeChild(n);
    n=d.createElement('div');n.id='lc-answer-note';n.setAttribute('role','alert');
    n.style.cssText='position:fixed;left:50%;top:40%;transform:translateX(-50%);background:#333;color:#fff;padding:12px 18px;border-radius:6px;font:16px sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    n.appendChild(d.createTextNode('Please choose an answer first.'));
    (d.body||d.documentElement).appendChild(n);
    setTimeout(function(){if(n.parentNode)n.parentNode.removeChild(n);},2500);
  }
  // Any element of the button: its own id, or one named after it (button169467SVG, button169467btn…).
  function partOf(id){for(var i=0;i<block.length;i++){var b=block[i];if(id===b||(id.indexOf(b)===0&&!/[0-9]/.test(id.charAt(b.length))))return true;}return false;}
  function blocked(t){for(;t&&t.nodeType===1;t=t.parentNode)if(t.id&&partOf(t.id))return true;return false;}
  function stop(e){
    if(done||!blocked(e.target))return;
    if(e.type=='keydown'&&e.key!=='Enter'&&e.key!==' ')return;
    if(e.stopImmediatePropagation)e.stopImmediatePropagation();else e.stopPropagation();
    if(e.preventDefault)e.preventDefault();
    if(e.type=='click'||e.type=='touchend'||e.type=='keydown')tell();
  }
  var lastGesture=0;
  function gesture(){lastGesture=new Date().getTime();}
  var stops=['mousedown','mouseup','click','touchstart','touchend','pointerdown','pointerup','keydown'];
  var kinds=['mousedown','mouseup','click','touchstart','touchend','pointerdown','pointerup','keydown','keyup'];
  // Clicks are stopped on the window the learner clicks in, before any handler the page has there.
  var heard=[];
  function listen(){
    var ws=wins();
    for(var i=0;i<ws.length;i++){
      if(heard.indexOf(ws[i])>=0)continue;heard.push(ws[i]);
      try{
        if(block.length)for(var k=0;k<stops.length;k++)ws[i].addEventListener(stops[k],stop,true);
        for(k=0;k<kinds.length;k++)ws[i].addEventListener(kinds[k],gesture,true);
      }catch(e){}
    }
  }
  function unlisten(){
    for(var i=0;i<heard.length;i++)try{
      for(var k=0;k<stops.length;k++)heard[i].removeEventListener(stops[k],stop,true);
      for(k=0;k<kinds.length;k++)heard[i].removeEventListener(kinds[k],gesture,true);
    }catch(e){}
  }
  // And Lectora's own click handler, which every way of pressing the button ends up calling. The button
  // object keeps its own reference to it (button169467.onUp = button169467onUp), so the object's onUp is
  // wrapped as well as the global function.
  var ups=[];
  function guarded(orig){var g=function(){if(!done){tell();return;}return orig.apply(this,arguments);};g.__lcGuard=true;return g;}
  function wrapUps(){
    for(var i=0;i<block.length;i++){
      var names=[block[i],block[i]+'Object'];
      for(var j=0;j<names.length;j++){
        var obj=window[names[j]];
        if(obj&&typeof obj.onUp=='function'&&!obj.onUp.__lcGuard){var o=obj.onUp,g=guarded(o);obj.onUp=g;ups.push({owner:obj,key:'onUp',orig:o,g:g});}
      }
      var name=block[i]+'onUp',f=window[name];
      if(typeof f=='function'&&!f.__lcGuard){var h=guarded(f);window[name]=h;ups.push({owner:window,key:name,orig:f,g:h});}
    }
  }
  // Inputs are compared with how they were when first seen, so pre-set choices (a default radio in an
  // options popup) don't count, and custom-drawn choices (hidden inputs) still do when picked.
  function state(e){var t=(e.type||'').toLowerCase();return t=='radio'||t=='checkbox'?(e.checked?'1':'0'):e.tagName=='SELECT'?String(e.selectedIndex):String(e.value||'');}
  var bases={};
  function answered(){
    // The question's own answer variable is the truth when there is one: other inputs on the page (the
    // advance-mode radios Lectora ticks once the page loads, a password the browser fills in) aren't answers.
    var known=false;
    for(var i=0;i<vars.length;i++){var v=window[vars[i]];if(v&&v.getValue){known=true;var x=String(v.getValue());if(x&&x!='~~~null~~~')return true;}}
    info.varFound=known;
    if(known)return false;
    var els=display().querySelectorAll('input,textarea,select');
    for(i=0;i<els.length;i++){
      var e=els[i],t=(e.type||'').toLowerCase();if(t=='hidden'||t=='button'||t=='submit'||t=='image'||t=='reset'||t=='password')continue;
      // Kept by id where there is one, so a choice Lectora redraws is still compared with how it started.
      var now=state(e),key=e.id?'#'+e.id:null,base=key?bases[key]:e.getAttribute('data-lc-base');
      if(base===undefined||base===null){if(key)bases[key]=now;else e.setAttribute('data-lc-base',now);continue;}
      if(now!==base&&now!=='0'&&now.replace(/\\s/g,'')!==''&&now!=='-1')return true;
    }
    return false;
  }
  // Auto-advance: while unanswered, a move to the next page that no click, tap or key press asked for is
  // dropped. Any move that does go ahead ends the guard, so nothing of it is left on the next page.
  function file(u){return String(u||'').replace(/^\\s+|\\s+$/g,'').split('#')[0].split('?')[0].split('/').pop();}
  function byUser(){var ws=wins();for(var i=0;i<ws.length;i++){try{var e=ws[i].event;if(e&&/^(mouse|click|touch|pointer|key)/.test(e.type))return true;}catch(x){}}return new Date().getTime()-lastGesture<1000;}
  var real=null,wrapper=null;
  function wrap(){
    if(real||typeof window.trivExitPage!='function')return;
    real=window.trivExitPage;
    wrapper=function(u){
      if(!done&&!byUser())for(var i=0;i<targets.length;i++)if(file(u)==targets[i])return;
      info.state=done?info.state:'left';finish();
      return real.apply(this,arguments);
    };
    window.trivExitPage=wrapper;
  }
  function finish(){
    if(done)return;
    done=true;if(timer)clearInterval(timer);
    unstyle();unlisten();
    for(var u=0;u<ups.length;u++)if(ups[u].owner[ups[u].key]===ups[u].g)ups[u].owner[ups[u].key]=ups[u].orig;
    if(real&&window.trivExitPage===wrapper)window.trivExitPage=real;
  }
  // One guard at a time: the last page's stands down before this one starts (kept on the player window,
  // which outlives the frames pages run in), and this one stands down if its frame goes away.
  var ws0=wins();
  for(var w=0;w<ws0.length;w++)try{if(typeof ws0[w].__lcAnswerGuard=='function'&&ws0[w].__lcAnswerGuard!==finish)ws0[w].__lcAnswerGuard();}catch(e){}
  for(w=0;w<ws0.length;w++)try{ws0[w].__lcAnswerGuard=finish;}catch(e){}
  try{window.addEventListener('pagehide',finish);window.addEventListener('unload',finish);}catch(e){}
  // What the guard is doing, for the editor to show (and for anyone looking in the browser console).
  var info=window.__lcAnswerGuardInfo={v:${GUARD_VERSION},page:page,watching:vars,holding:block.length?'submit':'next',state:'waiting'};
  style();listen();wrap();wrapUps();
  timer=setInterval(function(){
    style();listen();wrap();wrapUps();
    var gone=page!==undefined&&window.pgID!==page;
    if(gone){info.state='left';finish();}
    else if(answered()){info.state='answered';finish();}
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
    const forward = forwardNavigation(files, page);
    if (!forward.buttons.length) return null;
    // Submit (scores the answer and moves on) stays visible but inactive; Next is hidden.
    const submit = (b: { label: string }) => /submit/i.test(b.label);
    script = guardScript(forward.buttons.filter((b) => !submit(b)).map((b) => b.id), forward.buttons.filter(submit).map((b) => b.id), [...new Set([...(questionPages(files).get(page)?.vars ?? []), ...answerVariables(html)])], forward.targets);
  }
  const block = `<script id="lc-answer-rule" data-rule="${rule.rule}" data-set="${rule.set}"${rule.rule === 'required' ? ` data-v="${GUARD_VERSION}"` : ''}>${script}</script>\n`;
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

/**
 * Pages whose answer check was written by an older version of the editor (the script is copied into each
 * page when Required is chosen, so updating the editor doesn't change pages already set), rewritten with
 * the current check and the same settings.
 */
const refreshCache = new WeakMap<Uint8Array, string | null>();
export function outdatedRules(files: FileMap): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const p of Object.keys(files)) {
    if (!isHtmlFile(p)) continue;
    const bytes = files[p];
    let next = refreshCache.get(bytes);
    if (next === undefined) {
      next = null;
      const html = textOf(bytes);
      const tag = /<script id="lc-answer-rule"([^>]*)>/.exec(html)?.[1];
      // Only pages set to required whose check isn't the current version are rewritten.
      if (tag && /data-rule="required"/.test(tag) && !tag.includes(`data-v="${GUARD_VERSION}"`)) {
        const rewritten = setRule(files, p, readRule(html)!);
        next = rewritten !== null && rewritten !== html ? rewritten : null;
      }
      refreshCache.set(bytes, next);
    }
    if (next !== null) out.push({ path: p, text: next });
  }
  return out;
}
