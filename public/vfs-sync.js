// Added to course pages the editor shows (never to published files).
//
// Browsers don't pass synchronous XMLHttpRequests through a service worker, so a
// course that loads a file that way (Lectora's player reads its test, _tobj….txt,
// like this) would ask the web server, which doesn't have the course, and fail with
// "You must run this content from a web-based server". Answer those requests from the
// project the editor has open instead.
(function () {
  var read = null;
  try {
    for (var w = window; ; w = w.parent) {
      if (w.__lcVfsRead) { read = w.__lcVfsRead; break; }
      if (w === w.parent) break;
    }
  } catch (e) {
    return; // not inside the editor
  }
  if (!read) return;

  var proto = window.XMLHttpRequest.prototype;
  var open = proto.open;
  var send = proto.send;
  proto.open = function (method, url, async) {
    this.__lcUrl = null;
    if (async === false && /^get$/i.test(String(method))) {
      try { this.__lcUrl = new URL(String(url), document.baseURI).href; } catch (e) {}
    }
    return open.apply(this, arguments);
  };
  proto.send = function () {
    var hit = this.__lcUrl ? read(this.__lcUrl) : null;
    if (!hit) return send.apply(this, arguments);
    var xhr = this;
    var fixed = function (name, value) { Object.defineProperty(xhr, name, { configurable: true, get: function () { return value; } }); };
    var xml = null;
    fixed('readyState', 4);
    fixed('status', 200);
    fixed('statusText', 'OK');
    fixed('responseURL', this.__lcUrl);
    fixed('responseText', hit.text);
    fixed('response', hit.text);
    Object.defineProperty(xhr, 'responseXML', { configurable: true, get: function () {
      if (xml === null && /xml/i.test(hit.type)) { try { xml = new DOMParser().parseFromString(hit.text, 'application/xml'); } catch (e) {} }
      return xml;
    } });
    xhr.getResponseHeader = function (h) { return /^content-type$/i.test(h) ? hit.type : null; };
    xhr.getAllResponseHeaders = function () { return 'content-type: ' + hit.type + '\r\n'; };
    ['readystatechange', 'load', 'loadend'].forEach(function (t) { try { xhr.dispatchEvent(new Event(t)); } catch (e) {} });
  };
})();

// In Live edit nothing on the page starts by itself: narration and video don't play until you press
// play, and the page doesn't move on by itself (narration ending, a timer, a session timeout). Your own
// clicks and keys still work, so in Interact mode Next, menus and play buttons behave as usual. Preview
// is left alone and plays the course as a learner sees it.
(function () {
  var editor = null;
  try {
    for (var w = window; ; w = w.parent) {
      if (w.__lcStage !== undefined) { editor = w; break; }
      if (w === w.parent) break;
    }
  } catch (e) {
    return; // not inside the editor
  }
  if (!editor) return;
  var live = function () { return editor.__lcStage === 'live'; };
  var now = function () { return new Date().getTime(); };
  // A new page (or a page the player loads into a frame) starts now: clicks before this don't count for it,
  // so clicking Next doesn't let the next page's narration start by itself.
  editor.__lcPageStart = now();
  var gesture = function () { editor.__lcLastGesture = now(); };
  ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function (t) { window.addEventListener(t, gesture, true); });
  var askedFor = function (within) {
    var g = editor.__lcLastGesture || 0;
    return g >= (editor.__lcPageStart || 0) && now() - g < within;
  };
  var held = function (what) {
    try { if (typeof editor.__lcOnHeld === 'function') editor.__lcOnHeld(what); } catch (e) {}
  };

  // Media that starts without a click or key (autoplay, or a play() the page calls) is paused at once.
  document.addEventListener('play', function (e) {
    var m = e.target;
    // The browser's own media controls don't pass clicks to the page, but they take focus when used.
    if (!live() || askedFor(2000) || (m && m.ownerDocument && m.ownerDocument.activeElement === m)) return;
    if (m && typeof m.pause === 'function') {
      m.pause();
      held('narration');
    }
  }, true);

  // Lectora moves between pages with trivExitPage (defined by each page's own script, after this one).
  // A move nobody clicked for is held back.
  var wrap = function () {
    var f = window.trivExitPage;
    if (typeof f !== 'function' || f.__lcLive) return;
    var g = function (url) {
      if (live() && !askedFor(3000)) { held(String(url || '').split('/').pop()); return; }
      // The click that moved on doesn't count for the next page (players that swap pages in one window).
      editor.__lcPageStart = now() + 1;
      return f.apply(this, arguments);
    };
    g.__lcLive = true;
    window.trivExitPage = g;
  };
  // Lectora's timers (ObjProgress: the session timeout, the 7-second counter) act when they run out, through
  // the timer's onDone (progress19923.onDone = progress19923onDone). In Live edit that does nothing.
  var stopTimers = function () {
    var P = window.ObjProgress;
    if (typeof P !== 'function') return;
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!/^progress\w*$/.test(k)) continue;
      var v;
      try { v = window[k]; } catch (e) { continue; }
      if (typeof v === 'function' && /onDone$/.test(k) && !v.__lcLive) window[k] = held_(v, k);
      else if (v instanceof P && typeof v.onDone === 'function' && !v.onDone.__lcLive) v.onDone = held_(v.onDone, k);
    }
  };
  var held_ = function (f, name) {
    var g = function () {
      if (live()) { held('timer'); return; }
      return f.apply(this, arguments);
    };
    g.__lcLive = true;
    return g;
  };
  var timer = setInterval(function () { wrap(); stopTimers(); }, 250);
  window.addEventListener('pagehide', function () { clearInterval(timer); });
})();
