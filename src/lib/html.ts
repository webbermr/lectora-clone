/**
 * Converting between a page's saved HTML and the "edit copy" shown in the
 * WYSIWYG stage. The edit copy has scripts and inline event handlers disabled,
 * so the DOM you edit is the DOM that was authored, not whatever the page's
 * JavaScript builds at runtime.
 */

const DISABLED_TYPE = 'text/x-lectora-clone-disabled';
const ORIG_TYPE_ATTR = 'data-lc-orig-type';
const ON_PREFIX = 'data-lc-on-';
export const EDITOR_ATTR = 'data-lc-editor';

export function extractDoctype(html: string): string {
  return /^﻿?\s*(<!doctype[^>]*>)/i.exec(html)?.[1] ?? '';
}

export function toEditCopy(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const type = script.getAttribute('type');
    if (type !== null) script.setAttribute(ORIG_TYPE_ATTR, type);
    script.setAttribute('type', DISABLED_TYPE);
  }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        el.setAttribute(ON_PREFIX + attr.name.slice(2), attr.value);
        el.removeAttribute(attr.name);
      }
    }
  }
  // Pages that hide the body until their script reveals it would be blank.
  const style = doc.createElement('style');
  style.setAttribute(EDITOR_ATTR, '');
  style.textContent =
    '[data-lc-editing]{outline:2px dashed #2f7de1;outline-offset:2px;cursor:text}' +
    'html,body{visibility:visible!important}';
  (doc.head ?? doc.documentElement).appendChild(style);
  return extractDoctype(html) + '\n' + doc.documentElement.outerHTML;
}

/** Turn the live edit document back into savable HTML. */
export function fromEditDocument(doc: Document, doctype: string): string {
  const root = doc.documentElement.cloneNode(true) as HTMLElement;
  root.querySelectorAll(`[${EDITOR_ATTR}]`).forEach((n) => n.remove());
  for (const el of Array.from(root.querySelectorAll('*'))) {
    el.removeAttribute('data-lc-editing');
    if (el.getAttribute('contenteditable') === 'true' && el.hasAttribute('data-lc-ce')) {
      el.removeAttribute('contenteditable');
    }
    el.removeAttribute('data-lc-ce');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(ON_PREFIX)) {
        el.setAttribute('on' + attr.name.slice(ON_PREFIX.length), attr.value);
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'SCRIPT') {
      const orig = el.getAttribute(ORIG_TYPE_ATTR);
      el.removeAttribute(ORIG_TYPE_ATTR);
      if (orig !== null) el.setAttribute('type', orig);
      else el.removeAttribute('type');
    }
  }
  return (doctype ? doctype + '\n' : '') + root.outerHTML + '\n';
}

export function getPageTitle(html: string): string {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? '';
}
