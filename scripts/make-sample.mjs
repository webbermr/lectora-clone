// Builds small SCORM 1.2 and 2004 packages in samples/ for trying the editor.
import JSZip from 'jszip';
import CryptoJS from 'crypto-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// A 64x64 solid-colour PNG, built by hand so the samples have a real image.
function png(r, g, b) {
  const w = 64, h = 64;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const css = `body { font-family: Georgia, serif; margin: 0; background: #f4f1ea; }
.page { position: relative; width: 900px; height: 560px; margin: 20px auto; background: #fff; box-shadow: 0 2px 10px #0002; }
.nav { position: absolute; right: 30px; bottom: 24px; }
.nav a { background: #7a4b2a; color: #fff; padding: 8px 18px; border-radius: 4px; text-decoration: none; margin-left: 8px; }`;

const api = `var API = null;
function findAPI(win) { for (var i = 0; i < 10 && win; i++) { if (win.API) return win.API; if (win.parent === win) break; win = win.parent; } return null; }
API = findAPI(window);
if (API) { API.LMSInitialize(''); }
function markComplete() { if (API) { API.LMSSetValue('cmi.core.lesson_status', 'completed'); API.LMSCommit(''); } }
window.onunload = function () { if (API) API.LMSFinish(''); };`;

function page(n, title, body, prev, next) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="../css/course.css">
<script src="../js/scorm.js"></script>
</head>
<body onload="${next ? '' : 'markComplete()'}">
<div class="page">
  <h1 id="title${n}" style="position:absolute;left:40px;top:30px;margin:0;color:#7a4b2a;">${title}</h1>
  ${body}
  <div class="nav">${prev ? `<a href="${prev}">Back</a>` : ''}${next ? `<a href="${next}">Next</a>` : ''}</div>
</div>
</body>
</html>
`;
}

const pages = {
  'content/intro.html': page(1, 'Welcome to Coffee Basics', `<p style="position:absolute;left:40px;top:100px;width:500px;font-size:18px;">This short course covers where coffee comes from and how it is roasted.</p>
  <img src="../images/bean.png" alt="A coffee bean" style="position:absolute;left:620px;top:100px;width:200px;">`, null, 'origins.html'),
  'content/origins.html': page(2, 'Where Coffee Grows', `<ul style="position:absolute;left:40px;top:100px;font-size:18px;"><li>Ethiopia</li><li>Colombia</li><li>Vietnam</li></ul>`, 'intro.html', 'roasting.html'),
  'content/roasting.html': page(3, 'Roasting', `<p style="position:absolute;left:40px;top:100px;width:600px;font-size:18px;">Light roasts keep more origin flavour. Dark roasts taste more of the roast itself.</p>`, 'origins.html', null),
};

const items12 = Object.keys(pages).map((p, i) => ({ id: `ITEM_${i + 1}`, res: `RES_${i + 1}`, href: p, title: ['Welcome', 'Where Coffee Grows', 'Roasting'][i] }));

const manifest12 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="COFFEE_BASICS" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>Coffee Basics</title>
${items12.map((i) => `      <item identifier="${i.id}" identifierref="${i.res}"><title>${i.title}</title></item>`).join('\n')}
    </organization>
  </organizations>
  <resources>
${items12.map((i) => `    <resource identifier="${i.res}" type="webcontent" adlcp:scormtype="sco" href="${i.href}">
      <file href="${i.href}"/>
      <dependency identifierref="SHARED"/>
    </resource>`).join('\n')}
    <resource identifier="SHARED" type="webcontent" adlcp:scormtype="asset">
      <file href="css/course.css"/><file href="js/scorm.js"/><file href="images/bean.png"/>
    </resource>
  </resources>
</manifest>
`;

mkdirSync('samples', { recursive: true });

const zip12 = new JSZip();
// Zipped with a parent folder, as people often do by accident.
const root = zip12.folder('coffee-basics');
root.file('imsmanifest.xml', manifest12);
root.file('css/course.css', css);
root.file('js/scorm.js', api);
root.file('images/bean.png', png(122, 75, 42));
for (const [p, html] of Object.entries(pages)) root.file(p, html);
writeFileSync('samples/coffee-basics-scorm12.zip', await zip12.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

// SCORM 2004 single-SCO package with xml:base, like many authoring tools produce.
const manifest2004 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="SAFETY_2004" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 3rd Edition</schemaversion></metadata>
  <organizations default="O1">
    <organization identifier="O1">
      <title>Workshop Safety</title>
      <item identifier="I1" identifierref="R1" parameters="?start=1"><title>Workshop Safety</title></item>
      <imsss:sequencing><imsss:controlMode choice="true" flow="true"/></imsss:sequencing>
    </organization>
  </organizations>
  <resources xml:base="sco/">
    <resource identifier="R1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
`;
const zip2004 = new JSZip();
zip2004.file('imsmanifest.xml', manifest2004);
zip2004.file('sco/index.html', `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Workshop Safety</title>
<script>
var api = (function f(w){ for (var i=0;i<10&&w;i++){ if (w.API_1484_11) return w.API_1484_11; if (w.parent===w) break; w=w.parent; } return null; })(window);
if (api) { api.Initialize(''); }
function finish(){ if (api) { api.SetValue('cmi.completion_status','completed'); api.SetValue('cmi.score.scaled','0.9'); api.Commit(''); } document.getElementById('done').textContent = 'Completed!'; }
</script></head>
<body style="font-family:sans-serif;padding:30px">
<h1>Workshop Safety</h1>
<p>Always wear eye protection when using power tools.</p>
<button onclick="finish()">I understand</button>
<p id="done"></p>
</body></html>
`);
writeFileSync('samples/workshop-safety-scorm2004.zip', await zip2004.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

// A course whose pages are drawn by JavaScript, like Lectora and Storyline
// output: the HTML files are mostly script, and the text lives in JS strings
// and a JSON-ish data file.
const runtime = `/* tiny stand-in for an authoring tool's runtime */
function ObjInline(id, x, y, w, html) { this.id = id; this.x = x; this.y = y; this.w = w; this.html = html; }
ObjInline.prototype.build = function () {
  var d = document.createElement('div');
  d.id = this.id;
  d.style.cssText = 'position:absolute;left:' + this.x + 'px;top:' + this.y + 'px;width:' + this.w + 'px';
  d.innerHTML = this.html;
  document.getElementById('stage').appendChild(d);
};
function ObjImage(id, x, y, w, src) { this.id = id; this.x = x; this.y = y; this.w = w; this.src = src; }
ObjImage.prototype.build = function () {
  var i = new Image();
  i.id = this.id; i.src = this.src; i.alt = '';
  i.style.cssText = 'position:absolute;left:' + this.x + 'px;top:' + this.y + 'px;width:' + this.w + 'px';
  document.getElementById('stage').appendChild(i);
};
function ObjButton(id, x, y, label, target) { this.id = id; this.x = x; this.y = y; this.label = label; this.target = target; }
ObjButton.prototype.build = function () {
  var b = document.createElement('button');
  b.id = this.id; b.textContent = this.label; var t = this.target;
  b.style.cssText = 'position:absolute;left:' + this.x + 'px;top:' + this.y + 'px;padding:8px 20px;background:#b22;color:#fff;border:0;border-radius:4px';
  b.onclick = function () { location.href = t; };
  document.getElementById('stage').appendChild(b);
};
`;
const scriptedPage = (title, body) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<script src="trivantis.js"></script>
<script src="js/scorm.js"></script>
</head>
<body style="margin:0;background:#eee">
<div id="stage" style="position:relative;width:900px;height:560px;margin:20px auto;background:#fff;font-family:Arial,sans-serif"></div>
<script>
${body}
</script>
</body></html>
`;
const zip3 = new JSZip();
zip3.file('imsmanifest.xml', manifest12
  .replace(/COFFEE_BASICS/g, 'FIRE_SAFETY').replace('<title>Coffee Basics</title>', '<title>Fire Safety</title>')
  .replace(/<item identifier="ITEM_2"[\s\S]*?<\/organization>/, '</organization>')
  .replace('<title>Welcome</title>', '<title>Fire Safety</title>')
  .replace(/href="content\/intro.html"/g, 'href="a001_welcome.html"')
  .replace(/<resource identifier="RES_2"[\s\S]*?<resource identifier="SHARED"/, '<resource identifier="SHARED"')
  .replace('images/bean.png', 'images/extinguisher.png')
  .replace('<file href="css/course.css"/>', '<file href="trivantis.js"/><file href="a001_extinguishers.html"/><file href="data/slide2.js"/>'));
zip3.file('trivantis.js', runtime);
zip3.file('js/scorm.js', api);
zip3.file('images/extinguisher.png', png(200, 30, 30));
zip3.file('a001_welcome.html', scriptedPage('Welcome', `var text1 = new ObjInline('text1', 40, 30, 700, '<h1 style="color:#b22;margin:0">Welcome to Fire Safety</h1>');
text1.build();
var text2 = new ObjInline('text2', 40, 100, 520, '<p style="font-size:18px">It\\'s your job to know where the exits are &amp; how to use an extinguisher.</p>');
text2.build();
var image1 = new ObjImage('image1', 620, 100, 200, 'images/extinguisher.png');
image1.build();
var button1 = new ObjButton('button1', 760, 490, 'Next', 'a001_extinguishers.html');
button1.build();
document.getElementById('stage').style.backgroundImage = "url('images/bg_paper.png')";
var spacer = new ObjImage('spacer1', 0, 0, 1, 'images/trans.gif');
spacer.build();
// Narration is only created when an action plays it, so it is not on screen at load.
var audio1 = { id: 'audio1', src: 'media/welcome_narration.mp3' };
var chime = { id: 'audio2', src: 'media/chime.wav' };`));
// A real, playable half-second chime (16-bit mono PCM WAV).
zip3.file('media/chime.wav', (() => {
  const rate = 8000, n = rate / 2, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 880 * i) / rate) * 8000 * (1 - i / n)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
})());
zip3.file('images/bg_paper.png', png(250, 246, 236));
zip3.file('images/trans.gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
// Not real audio; the asset list only needs the file to exist.
zip3.file('media/welcome_narration.mp3', Buffer.from('ID3' + '\0'.repeat(400)));
zip3.file('data/slide2.js', `window.slideData = {"title":"Extinguisher types","lines":["Water \\u2014 for paper and wood","CO\\u2082 \\u2014 for electrical fires","Always check the gauge before use"]};\n`);
zip3.file('a001_extinguishers.html', `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Extinguishers</title>
<script src="data/slide2.js"></script>
</head>
<body style="margin:0;background:#eee">
<svg id="slide" width="900" height="560" style="display:block;margin:20px auto;background:#fff;font-family:Arial,sans-serif"></svg>
<script>
var svg = document.getElementById('slide'), NS = 'http://www.w3.org/2000/svg';
function t(str, y, size) { var e = document.createElementNS(NS, 'text'); e.setAttribute('x', 40); e.setAttribute('y', y); e.setAttribute('font-size', size); e.textContent = str; svg.appendChild(e); }
t(slideData.title, 60, 32);
slideData.lines.forEach(function (l, i) { t(l, 130 + i * 40, 20); });
</script>
</body></html>
`);
writeFileSync('samples/fire-safety-scripted-scorm12.zip', await zip3.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));


// SCORM 2004 course split into modules and sections in the manifest, with a
// shared-assets resource and one file the manifest doesn't list.
{
  const api2004 = `var api = (function f(w){ for (var i=0;i<10&&w;i++){ if (w.API_1484_11) return w.API_1484_11; if (w.parent===w) break; w=w.parent; } return null; })(window);
if (api) { api.Initialize(''); api.SetValue('cmi.completion_status','completed'); api.Commit(''); }
window.addEventListener('pagehide', function(){ if (api) api.Terminate(''); });`;
  const pg = (title, body, depth) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${'../'.repeat(depth)}common/style.css">
<script src="${'../'.repeat(depth)}common/scorm.js"></script>
</head><body><div class="page">
<img class="logo" src="${'../'.repeat(depth)}images/logo.png" alt="Acme">
<h1>${title}</h1>
${body}
</div></body></html>
`;
  const pages = [
    { id: 'P1', file: 'm1/welcome.html', title: 'Welcome', extra: ['m1/team.png'], body: '<p>Welcome to Acme. This is your first week.</p><img src="team.png" alt="The team" width="200">' },
    { id: 'P2', file: 'm1/values.html', title: 'Our Values', body: '<ul><li>Be kind</li><li>Ship often</li></ul>' },
    { id: 'P3', file: 'm2/time-off/vacation.html', title: 'Vacation', body: '<p>You get 25 days of vacation a year.</p>' },
    { id: 'P4', file: 'm2/time-off/sick.html', title: 'Sick Leave', body: '<p>Tell your manager before 9am.</p>' },
    { id: 'P5', file: 'm2/conduct.html', title: 'Code of Conduct', body: '<p>Treat everyone with respect.</p>' },
  ];
  const item = (p) => `<item identifier="I_${p.id}" identifierref="R_${p.id}"><title>${p.title}</title></item>`;
  const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="ONBOARDING" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>New Hire Onboarding</title>
      <item identifier="MOD1"><title>Module 1: Getting Started</title>
        ${item(byId.P1)}
        ${item(byId.P2)}
      </item>
      <item identifier="MOD2"><title>Module 2: Policies</title>
        <item identifier="SEC_TIMEOFF"><title>Time Off</title>
          ${item(byId.P3)}
          ${item(byId.P4)}
        </item>
        ${item(byId.P5)}
      </item>
    </organization>
  </organizations>
  <resources>
${pages.map((p) => `    <resource identifier="R_${p.id}" type="webcontent" adlcp:scormType="sco" href="${p.file}">
      <file href="${p.file}"/>${(p.extra ?? []).map((e) => `<file href="${e}"/>`).join('')}
      <dependency identifierref="SHARED"/>
    </resource>`).join('\n')}
    <resource identifier="SHARED" type="webcontent" adlcp:scormType="asset">
      <file href="common/style.css"/><file href="common/scorm.js"/><file href="images/logo.png"/>
    </resource>
  </resources>
</manifest>
`;
  const z = new JSZip();
  z.file('imsmanifest.xml', manifest);
  z.file('common/style.css', 'body{font-family:Arial,sans-serif;background:#eef;margin:0}.page{width:860px;margin:20px auto;background:#fff;padding:30px;min-height:480px;position:relative}.logo{position:absolute;right:30px;top:30px;width:48px}h1{color:#235}');
  z.file('common/scorm.js', api2004);
  z.file('images/logo.png', png(35, 55, 90));
  z.file('m1/team.png', png(90, 160, 90));
  z.file('extras/notes.txt', 'Authoring notes that were never listed in the manifest.');
  for (const p of pages) z.file(p.file, pg(p.title, p.body, p.file.split('/').length - 1));
  writeFileSync('samples/onboarding-modules-scorm2004.zip', await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}


// A course built the way Lectora 19 publishes (single SCO, pages named
// a001_<chapter>_<page>.html, trivExitPage navigation, a page-tracking tree,
// P_<id> resources). The runtime here is a tiny stand-in written for this
// sample, not Lectora's. The dashboard only unlocks the final assessment once
// each module's last page has set its "done" variable.
{
  const modules = [
    { id: 200, slug: 'getting_started', title: 'Getting Started', pages: ['welcome', 'how_to_navigate', 'module_summary'] },
    { id: 300, slug: 'workplace_safety', title: 'Workplace Safety', pages: ['welcome', 'hazards', 'protective_gear', 'let_s_review', 'module_summary'] },
    { id: 400, slug: 'reporting', title: 'Reporting', pages: ['welcome', 'when_to_report', 'module_summary'] },
    { id: 500, slug: 'old_policies', title: 'Old Policies', pages: ['welcome', 'retired_rules'] },
  ];
  let nextId = 1000;
  const pages = []; // { file, id, module, title, last }
  pages.push({ file: 'a001_student_dashboard.html', id: 100, module: null, title: 'Dashboard' });
  for (const m of modules) {
    m.pages.forEach((p, i) => pages.push({ file: `a001_${m.slug}_${p}.html`, id: nextId++, module: m, title: p.replace(/_/g, ' '), last: i === m.pages.length - 1 }));
  }
  // A Lectora-style test: sections of question pages plus a results page.
  const testSections = [
    { id: 710, slug: 'module_1', draw: 2, questions: ['q1', 'q2', 'q3'] },
    { id: 720, slug: 'module_2', draw: 0, questions: ['q1', 'q2'] },
  ];
  for (const sec of testSections) {
    sec.questions.forEach((q, i) => pages.push({ file: `a001_test_${sec.slug}_${q}.html`, id: 7000 + sec.id + i, module: null, test: sec, title: `Question ${i + 1}` }));
  }
  pages.push({ file: 'a001_test_test_results.html', id: 790, module: null, test: true, title: 'Test Results' });
  pages.push({ file: 'a001_final_assessment_begin.html', id: 900, module: null, title: 'Final Assessment' });
  const idx = (f) => pages.findIndex((p) => p.file === f);
  const runtime = `// Minimal stand-in for Lectora's runtime, for this sample only.
function Variable(name, def) { this.name = name; this.def = def; }
Variable.prototype.getValue = function () { var v = sessionStorage.getItem(this.name); return v === null ? this.def : v; };
Variable.prototype.set = function (v) { sessionStorage.setItem(this.name, String(v)); };
Variable.prototype.equals = function (v) { return this.getValue() == v; };
Variable.prototype.add = function (n) { this.set(Number(this.getValue()) + Number(n)); };
Variable.prototype.lessThan = function (v) { return Number(this.getValue()) < Number(v); };
function ObjProgress(name, alt, x, y, w, h, vis, z, a, b, c, d, e, f, min, max) { this.name = name; this.min = min; this.max = max; }
function trivExitPage(page) { location.href = page; }
// Like Lectora's runtime, this names a debug window learners never open.
function trivDebug() { window.open('trivantisdebug.html'); }
`;
  const tracking = (tree, numPages) => `function PageTrackingObj() { this.numPages = 0; this.title = null; }
PageTrackingObj.prototype.find = function (n, id) { if (n.id == id) return n; for (var i = 0; n.c && i < n.c.length; i++) { var m = this.find(n.c[i], id); if (m) return m; } return null; };
PageTrackingObj.prototype.SetRangeStatus = function (id, s) { var n = this.find(this.title, id); if (n) n.v = s; };
var trivPageTracking = new PageTrackingObj();
trivPageTracking.numPages = ${numPages};

trivPageTracking.publishTimeStamp = 2026101012000;

trivPageTracking.title=${tree};
`;
  const testTree = `{id:700,v:0,t:1,c:[${testSections.map((sec) => `{id:${sec.id},v:0,c:[${pages.filter((p) => p.test === sec).map((p) => `{id:${p.id},v:0}`).join(',')}]}`).join(',')},{id:790,v:0}]}`;
  const tree = `{id:1,v:0,c:[{id:100,v:0},${modules.map((m) => `{id:${m.id},v:0,c:[${pages.filter((p) => p.module === m).map((p) => `{id:${p.id},v:0}`).join(',')}]}`).join(',')},${testTree},{id:900,v:0}]}`;
  const numPages = pages.length;
  const progressPages = pages.filter((p) => p.module);
  const progressTotal = progressPages.length;
  const pageHtml = (p) => {
    const i = idx(p.file);
    const prev = pages[i - 1]?.file;
    const next = pages[i + 1]?.file ?? 'a001_student_dashboard.html';
    const img = p.module ? `images/${p.module.slug}_${i}.png` : 'images/logo.png';
    let body;
    if (p.file === 'a001_student_dashboard.html') {
      body = `<h1>Dashboard</h1>
<ul>${modules.map((m) => `<li><a href="#" onclick="trivExitPage('a001_${m.slug}_welcome.html', true); return false;">${m.title}</a> <span id="st${m.id}"></span></li>`).join('')}</ul>
<button id="final" onclick="action_final()">Final Assessment</button> <span id="lock"></span>
<p>Course progress: <b id="pct"></b> · <a href="#" onclick="trivExitPage('a001_toc1.html', true); return false;">Table of contents</a> · <a href="resources/Safety%20Handbook.pdf">Handbook (PDF)</a></p>
<script>
Varprogress_track = new Variable( 'Varprogress_track', '0' )
Vara_progress_total = new Variable( 'Vara_progress_total', '${progressTotal}' )
progress1 = new ObjProgress('progress1','',57,355,322,22,0,22,1,29,'#0000ff','','#405d87','',1,${progressTotal},0,0,0,1,0,'div',0 )
function showProgress() {
  var pct = Varprogress_track.lessThan(Vara_progress_total.getValue()) ? Math.round(100 * Varprogress_track.getValue() / Vara_progress_total.getValue()) : 100;
  document.getElementById('pct').textContent = pct + '%';
}
showProgress();
${modules.map((m) => `var VarModule${m.id}Done = new Variable('VarModule${m.id}Done', '0');`).join('\n')}
function action_final() {
  if (${modules.map((m) => `VarModule${m.id}Done.equals('1')`).join(' && ')}) trivExitPage('a001_final_assessment_begin.html', true);
  else document.getElementById('lock').textContent = 'Finish every module first.';
}
${modules.map((m) => `document.getElementById('st${m.id}').textContent = VarModule${m.id}Done.equals('1') ? '✓' : '';`).join('\n')}
</script>`;
    } else {
      body = `<h1>${p.module ? p.module.title + ': ' : ''}${p.title}</h1>
<p>Sample text for ${p.title}.</p>
<img src="${img}" alt="" width="120">
<p><button onclick="trivPrevPage()">Back</button> <button onclick="trivNextPage()">Next</button></p>
${p.module ? `<script>
var Varprogress_track = new Variable('Varprogress_track', '0');
if (!sessionStorage.getItem('seen_${p.id}')) { sessionStorage.setItem('seen_${p.id}', '1'); Varprogress_track.add('1'); }
</script>` : ''}
${p.last ? `<script>var VarModule${p.module.id}Done = new Variable('VarModule${p.module.id}Done', '0'); VarModule${p.module.id}Done.set('1');</script>` : ''}`;
    }
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Safety Basics</title>
<script src="trivantis.js"></script>
<script src="trivantis-pagetracking.js"></script>
<script src="js/scorm.js"></script>
<script>
var pgID = 'page${p.id}';
${prev ? `function trivPrevPage() {
    trivExitPage( '${prev}', true )
}
` : 'function trivPrevPage() {}\n'}
function trivNextPage() {
    trivExitPage( '${next}', true )
}
function postPageShowAction(){
  trivPageTracking.SetRangeStatus(${p.id},2);
}
</script>
</head><body style="font-family:Arial,sans-serif;padding:24px" onload="postPageShowAction()">
${body}
</body></html>
`;
  };
  const allImages = ['images/logo.png', ...pages.map((p, i) => (p.module ? `images/${p.module.slug}_${i}.png` : null)).filter(Boolean)];
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<!--GENERATED BY:  Lectora-style sample for lectora-clone -->
<manifest identifier="CourseID" version="1.2" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <organizations default="CourseID-org">
    <organization identifier="CourseID-org">
      <title>Safety Basics</title>
      <item identifier="I_A001" identifierref="A001">
        <title>Safety Basics</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="A001" type="webcontent" adlcp:scormtype="sco" href="a001index.html">
      <file href="a001index.html"/>
${pages.map((p) => `      <dependency identifierref="P_${p.id}"/>`).join('\n')}
      <dependency identifierref="R_images"/>
      <dependency identifierref="S_BaseFiles"/>
    </resource>
${pages.map((p) => `    <resource identifier="P_${p.id}" type="webcontent" adlcp:scormtype="asset">
      <file href="${p.file}"/>
${p.file === 'a001_student_dashboard.html' ? pages.filter((q) => q !== p).map((q) => `      <dependency identifierref="P_${q.id}"/>`).join('\n') + '\n' : ''}    </resource>`).join('\n')}
    <resource identifier="R_images" type="webcontent" adlcp:scormtype="asset">
${allImages.map((f) => `      <file href="${f}"/>`).join('\n')}
    </resource>
    <resource identifier="T_700" type="webcontent" adlcp:scormtype="asset">
      <file href="_tobj700.txt"/>
    </resource>
    <resource identifier="F_1" type="webcontent" adlcp:scormtype="asset">
      <file href="a001_toc1.html"/>
    </resource>
    <resource identifier="R_extern" type="webcontent" adlcp:scormtype="asset">
      <file href="resources/Safety%20Handbook.pdf"/>
    </resource>
    <resource identifier="S_BaseFiles" type="webcontent" adlcp:scormtype="asset">
      <file href="trivantis.js"/>
      <file href="trivantis-pagetracking.js"/>
      <file href="trivantis-titlemgr.js"/>
      <file href="enc.js"/>
      <file href="js/scorm.js"/>
    </resource>
  </resources>
</manifest>
`;
  const esc = (t) => JSON.stringify(t.replace(/(^|_)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()));
  const toc = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Table of Contents</title>
<script src="trivantis.js"></script>
<script>
function insertEntry(f, e) { f.items.push(e); } function insertFolder(f, g) { f.items.push(g); return g; }
function NewFolder(t, h) { return { t: t, h: h, items: [] }; } function NewLink(t, h) { return { t: t, h: h }; }
  fT = NewFolder("<i>Table Of Contents</i>", "", null)
  insertEntry(fT, NewLink("Student Dashboard", "a001_student_dashboard.html", "page", 100))
${modules.map((m) => `  aux1 = insertFolder(fT, NewFolder(${JSON.stringify(m.title)}, "a001_${m.slug}_welcome.html", "chap", ${m.id}))
${pages.filter((p) => p.module === m).map((p) => `  insertEntry(aux1, NewLink(${esc(p.title.replace(/ /g, '_'))}, "${p.file}", "page", ${p.id}))`).join('\n')}`).join('\n')}
  aux1 = insertFolder(fT, NewFolder("Final Assessment", "a001_final_assessment_begin.html", "chap", 800))
  insertEntry(aux1, NewLink("Begin Final Assessment", "a001_final_assessment_begin.html", "page", 900))
document.write(fT.items.map(function (x) { return x.items ? '<h3><a href="' + x.h + '">' + x.t + '</a></h3>' + x.items.map(function (e) { return '<div><a href="' + e.h + '">' + e.t + '</a></div>'; }).join('') : '<div><a href="' + x.h + '">' + x.t + '</a></div>'; }).join(''));
</script>
</head><body style="font-family:Arial,sans-serif;padding:24px"></body>
</html>
`;
  const z = new JSZip();
  z.file('imsmanifest.xml', manifest);
  z.file('a001_toc1.html', toc);
  const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<lectoratest>
<grade>1</grade>
<name>Knowledge Check</name>
<numrandom>0</numrandom>
<passinggrade>80</passinggrade>
<cancelfail>a001_student_dashboard.html</cancelfail>
<passdone>a001_final_assessment_begin.html</passdone>
<prevpage>a001_student_dashboard.html</prevpage>
${(() => {
    let idx = 0;
    return testSections.map((sec) => {
      const first = idx;
      const qs = pages.filter((p) => p.test === sec).map((p, i) => `<page>
<index>${idx++}</index>
<name>${p.file}</name>
<question>
<id>${p.id}0</id>
<type>2</type>
<weight>1</weight>
<name>Q_${sec.slug}_${i + 1}</name>
<var>VarQ_${sec.slug}_${i + 1}</var>
<text>Sample question ${i + 1} for ${sec.slug}?</text>
<arcorrectans><answer>Yes</answer></arcorrectans>
<archoices><choice>Yes</choice><choice>No</choice></archoices>
</question>
</page>`).join('\n');
      return `<section>
<index>${first}</index>
<id>${sec.id}</id>
<numrandom>${sec.draw}</numrandom>
${qs}
</section>`;
    }).join('\n') + `
<page hasResults = "true">
<index>${idx}</index>
<name>a001_test_test_results.html</name>
</page>`;
  })()}
</lectoratest>
`;
  // Sample-only passphrase: Lectora's real key is never stored in this project.
  const SAMPLE_KEY = 'lectora-clone-sample';
  z.file('_tobj700.txt', CryptoJS.AES.encrypt(testXml, SAMPLE_KEY).toString());
  z.file('enc.js', `var CJ = (function () { var module = { exports: {} }; var exports = module.exports;
${readFileSync('node_modules/crypto-js/crypto-js.js', 'utf8')}
return module.exports; })();
CJ.AES.dct = CJ.AES.decrypt;
`);
  z.file('trivantis-titlemgr.js', `// Stand-in for Lectora's title manager, for this sample only.
function TitleMgr() {}
var TMPr = TitleMgr.prototype;
var hlf = CJ.AES.dct;
var utf8 = CJ.enc.Utf8;

//LD-5993
TMPr.bDc = function(str) {
  var rur  = hlf(str, '${SAMPLE_KEY}');
  var ret = rur.toString(utf8);
  return ret;
}
`);
  z.file('resources/Safety Handbook.pdf', '%PDF-1.4 placeholder');
  z.file('a001index.html', `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Player</title><script>location.replace('a001_student_dashboard.html');</script></head><body></body></html>`);
  z.file('trivantis.js', runtime);
  z.file('trivantis-pagetracking.js', tracking(tree, numPages));
  z.file('js/scorm.js', api);
  for (const p of pages) z.file(p.file, pageHtml(p));
  allImages.forEach((f, i) => z.file(f, png(40 + ((i * 37) % 200), 90, 140)));
  writeFileSync('samples/lectora-style-scorm12.zip', await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

console.log('Wrote samples/coffee-basics-scorm12.zip samples/workshop-safety-scorm2004.zip, samples/fire-safety-scripted-scorm12.zip samples/onboarding-modules-scorm2004.zip and samples/lectora-style-scorm12.zip');
