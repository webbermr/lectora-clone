// Builds small SCORM 1.2 and 2004 packages in samples/ for trying the editor.
import JSZip from 'jszip';
import { mkdirSync, writeFileSync } from 'node:fs';
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
var audio1 = { id: 'audio1', src: 'media/welcome_narration.mp3' };`));
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

console.log('Wrote samples/coffee-basics-scorm12.zip samples/workshop-safety-scorm2004.zip, samples/fire-safety-scripted-scorm12.zip and samples/onboarding-modules-scorm2004.zip');
