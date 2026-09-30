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
