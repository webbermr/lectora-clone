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
console.log('Wrote samples/coffee-basics-scorm12.zip and samples/workshop-safety-scorm2004.zip');
