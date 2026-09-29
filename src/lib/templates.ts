/** Starter content for new courses, pages and inserted objects. */

export const SCORM_HELPER_PATH = 'lc_scorm.js';

export const SCORM_HELPER_JS = `/* SCORM helper added by SCORM Editor. Finds the LMS API, marks the page complete. */
(function () {
  function find(win, name) {
    for (var i = 0; win && i < 10; i++) {
      try { if (win[name]) return win[name]; } catch (e) { return null; }
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }
  function locate(name) {
    return find(window, name) || (window.opener ? find(window.opener, name) : null);
  }
  var api2004 = locate('API_1484_11');
  var api12 = api2004 ? null : locate('API');
  var done = false;

  function init() {
    if (api2004) {
      api2004.Initialize('');
      if (api2004.GetValue('cmi.completion_status') !== 'completed') api2004.SetValue('cmi.completion_status', 'incomplete');
    } else if (api12) {
      api12.LMSInitialize('');
      var s = api12.LMSGetValue('cmi.core.lesson_status');
      if (s === 'not attempted' || s === '') api12.LMSSetValue('cmi.core.lesson_status', 'incomplete');
    }
  }

  window.LC = {
    complete: function () {
      if (api2004) { api2004.SetValue('cmi.completion_status', 'completed'); api2004.Commit(''); }
      else if (api12) { api12.LMSSetValue('cmi.core.lesson_status', 'completed'); api12.LMSCommit(''); }
    },
    score: function (raw, max) {
      max = max || 100;
      if (api2004) {
        api2004.SetValue('cmi.score.raw', String(raw));
        api2004.SetValue('cmi.score.max', String(max));
        api2004.SetValue('cmi.score.scaled', String(raw / max));
        api2004.Commit('');
      } else if (api12) {
        api12.LMSSetValue('cmi.core.score.raw', String(raw));
        api12.LMSSetValue('cmi.core.score.max', String(max));
        api12.LMSCommit('');
      }
    },
    finish: function () {
      if (done) return;
      done = true;
      if (api2004) api2004.Terminate('');
      else if (api12) api12.LMSFinish('');
    }
  };

  init();
  // Each page is its own SCO: viewing it counts as completing it.
  window.addEventListener('load', function () { window.LC.complete(); });
  window.addEventListener('pagehide', function () { window.LC.finish(); });
})();
`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function newPageHtml(title: string, helperHref: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; background: #e9edf2; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c2430; }
  .lc-page { position: relative; width: 960px; height: 600px; margin: 0 auto; background: #ffffff; overflow: hidden; }
</style>
<script src="${esc(helperHref)}"></script>
</head>
<body>
<div class="lc-page">
  <h1 style="position:absolute;left:40px;top:30px;width:880px;margin:0;font-size:32px;color:#1f3b63;">${esc(title)}</h1>
  <div style="position:absolute;left:40px;top:100px;width:880px;font-size:18px;line-height:1.5;">Double-click to edit this text.</div>
</div>
</body>
</html>
`;
}

export type InsertKind = 'text' | 'heading' | 'image' | 'button' | 'shape' | 'video' | 'audio' | 'link';

/** HTML for a new object, absolutely positioned at (x, y). `src` is a relative URL for media. */
export function objectHtml(kind: InsertKind, x: number, y: number, src = ''): string {
  const pos = `position:absolute;left:${x}px;top:${y}px;`;
  switch (kind) {
    case 'heading':
      return `<h2 style="${pos}width:600px;margin:0;font-size:28px;color:#1f3b63;">New heading</h2>`;
    case 'text':
      return `<div style="${pos}width:400px;font-size:16px;line-height:1.5;">New text block. Double-click to edit.</div>`;
    case 'image':
      return `<img src="${esc(src)}" alt="" style="${pos}width:320px;height:auto;">`;
    case 'button':
      return `<a href="#" style="${pos}display:inline-block;padding:10px 24px;background:#2f7de1;color:#fff;border-radius:6px;font-size:16px;text-decoration:none;font-family:Arial,sans-serif;">Button</a>`;
    case 'link':
      return `<a href="#" style="${pos}font-size:16px;color:#2f7de1;">Link text</a>`;
    case 'shape':
      return `<div style="${pos}width:200px;height:120px;background:#dbe8f8;border:2px solid #2f7de1;border-radius:8px;"></div>`;
    case 'video':
      return `<video src="${esc(src)}" controls style="${pos}width:480px;"></video>`;
    case 'audio':
      return `<audio src="${esc(src)}" controls style="${pos}"></audio>`;
  }
}
