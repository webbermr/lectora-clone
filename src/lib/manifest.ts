/**
 * imsmanifest.xml parsing and editing for SCORM 1.2 and SCORM 2004.
 *
 * Edits are applied to the original XML document and re-serialized, so
 * metadata, sequencing rules and vendor extensions we don't model survive.
 */
import { join, normalize, splitQuery } from './paths';

export type ScormVersion = '1.2' | '2004';

export interface ItemNode {
  identifier: string;
  title: string;
  identifierref?: string;
  /** Package path of the launch file (no query string). */
  href?: string;
  /** Query/hash suffix from the resource href plus item parameters. */
  query: string;
  children: ItemNode[];
}

export interface ResourceModel {
  identifier: string;
  href?: string;
  scormType: string;
  files: string[];
  /** Identifiers of resources this one depends on (shared scripts, media). */
  dependencies: string[];
}

export interface ManifestModel {
  version: ScormVersion;
  identifier: string;
  title: string;
  orgIdentifier: string;
  items: ItemNode[];
  resources: ResourceModel[];
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const ADLCP_12 = 'http://www.adlnet.org/xsd/adlcp_rootv1p2';
const ADLCP_2004 = 'http://www.adlnet.org/xsd/adlcp_v1p3';

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('imsmanifest.xml is not valid XML: ' + err.textContent?.slice(0, 200));
  return doc;
}

function serialize(doc: Document, original: string): string {
  const body = new XMLSerializer().serializeToString(doc);
  const decl = /^﻿?\s*(<\?xml[^?]*\?>)/.exec(original)?.[1] ?? '<?xml version="1.0" encoding="UTF-8"?>';
  return /^<\?xml/.test(body) ? body : `${decl}\n${body}`;
}

/** Direct children with the given local name (namespace-agnostic). */
function kids(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name);
}

function kid(el: Element, name: string): Element | undefined {
  return kids(el, name)[0];
}

function xmlBase(el: Element | undefined): string {
  if (!el) return '';
  return el.getAttributeNS(XML_NS, 'base') ?? el.getAttribute('xml:base') ?? '';
}

function scormTypeOf(res: Element): string {
  for (const attr of Array.from(res.attributes)) {
    if (attr.localName.toLowerCase() === 'scormtype') return attr.value;
  }
  return '';
}

export function detectVersion(doc: Document): ScormVersion {
  const root = doc.documentElement;
  const schemaVersion = root.getElementsByTagNameNS('*', 'schemaversion')[0]?.textContent?.trim() ?? '';
  if (/^1\.2/.test(schemaVersion)) return '1.2';
  if (/2004|1\.3/i.test(schemaVersion)) return '2004';
  const text = new XMLSerializer().serializeToString(root).slice(0, 4000);
  if (/adlcp_v1p3|imsss|adlseq|adlnav/.test(text)) return '2004';
  return '1.2';
}

function getOrganization(doc: Document): Element | undefined {
  const orgs = kid(doc.documentElement, 'organizations');
  if (!orgs) return undefined;
  const def = orgs.getAttribute('default');
  const all = kids(orgs, 'organization');
  return all.find((o) => o.getAttribute('identifier') === def) ?? all[0];
}

function readResources(doc: Document): { list: ResourceModel[]; byId: Map<string, ResourceModel> } {
  const root = doc.documentElement;
  const resourcesEl = kid(root, 'resources');
  const base = normalize(xmlBase(root) + '/' + xmlBase(resourcesEl));
  const list: ResourceModel[] = [];
  for (const res of resourcesEl ? kids(resourcesEl, 'resource') : []) {
    const resBase = join(base, xmlBase(res));
    const href = res.getAttribute('href') ?? undefined;
    list.push({
      identifier: res.getAttribute('identifier') ?? '',
      href: href ? (resBase ? `${resBase}/${href}` : href) : undefined,
      scormType: scormTypeOf(res),
      files: kids(res, 'file').map((f) => join(resBase, f.getAttribute('href') ?? '')),
      dependencies: kids(res, 'dependency').map((d) => d.getAttribute('identifierref') ?? '').filter(Boolean),
    });
  }
  return { list, byId: new Map(list.map((r) => [r.identifier, r])) };
}

export function parseManifest(xml: string): ManifestModel {
  const doc = parse(xml);
  const root = doc.documentElement;
  const { list, byId } = readResources(doc);
  const org = getOrganization(doc);

  const readItem = (el: Element): ItemNode => {
    const ref = el.getAttribute('identifierref') ?? undefined;
    const res = ref ? byId.get(ref) : undefined;
    let href: string | undefined;
    let query = '';
    if (res?.href) {
      const split = splitQuery(res.href);
      href = normalize(split.path);
      query = split.suffix;
      const params = el.getAttribute('parameters');
      if (params) {
        const p = params.replace(/^[?&]/, '');
        query = query ? `${query}&${p}` : params.startsWith('#') ? params : `?${p}`;
      }
    }
    return {
      identifier: el.getAttribute('identifier') ?? '',
      title: kid(el, 'title')?.textContent?.trim() ?? '(untitled)',
      identifierref: ref,
      href,
      query,
      children: kids(el, 'item').map(readItem),
    };
  };

  return {
    version: detectVersion(doc),
    identifier: root.getAttribute('identifier') ?? '',
    title: (org && kid(org, 'title')?.textContent?.trim()) || 'Untitled course',
    orgIdentifier: org?.getAttribute('identifier') ?? '',
    items: org ? kids(org, 'item').map(readItem) : [],
    resources: list,
  };
}

export function flattenItems(items: ItemNode[]): ItemNode[] {
  return items.flatMap((i) => [i, ...flattenItems(i.children)]);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function findItem(doc: Document, id: string): Element {
  const el = Array.from(doc.getElementsByTagNameNS('*', 'item')).find((i) => i.getAttribute('identifier') === id);
  if (!el) throw new Error(`Item ${id} not found in manifest`);
  return el;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function setTitle(doc: Document, parent: Element, title: string) {
  let t = kid(parent, 'title');
  if (!t) {
    t = doc.createElementNS(parent.namespaceURI, 'title');
    parent.insertBefore(t, parent.firstChild);
  }
  t.textContent = title;
}

export function setCourseTitle(xml: string, title: string): string {
  const doc = parse(xml);
  const org = getOrganization(doc);
  if (!org) throw new Error('Manifest has no organization');
  setTitle(doc, org, title);
  return serialize(doc, xml);
}

export function setItemTitle(xml: string, id: string, title: string): string {
  const doc = parse(xml);
  setTitle(doc, findItem(doc, id), title);
  return serialize(doc, xml);
}

export interface AddPageOptions {
  title: string;
  /** Package-relative path of the page's launch file. */
  href: string;
  /** Other files the resource uses (listed as <file> entries). */
  files?: string[];
  /** Insert as the next sibling of this item; otherwise append to the organization. */
  afterId?: string;
}

export function addPage(xml: string, opts: AddPageOptions): { xml: string; itemId: string } {
  const doc = parse(xml);
  const root = doc.documentElement;
  const ns = root.namespaceURI;
  const version = detectVersion(doc);
  const org = getOrganization(doc);
  if (!org) throw new Error('Manifest has no organization');

  let resources = kid(root, 'resources');
  if (!resources) {
    resources = doc.createElementNS(ns, 'resources');
    root.appendChild(resources);
  }
  // Paths inside the manifest are relative to any xml:base on <resources>.
  const base = normalize(xmlBase(root) + '/' + xmlBase(resources));
  const rel = (p: string) => (base && p.startsWith(base + '/') ? p.slice(base.length + 1) : p);

  const resId = uid('RES');
  const res = doc.createElementNS(ns, 'resource');
  res.setAttribute('identifier', resId);
  res.setAttribute('type', 'webcontent');
  const adlcpNs = root.lookupNamespaceURI('adlcp') ?? (version === '2004' ? ADLCP_2004 : ADLCP_12);
  res.setAttributeNS(adlcpNs, version === '2004' ? 'adlcp:scormType' : 'adlcp:scormtype', 'sco');
  res.setAttribute('href', rel(opts.href));
  for (const f of [opts.href, ...(opts.files ?? [])]) {
    const file = doc.createElementNS(ns, 'file');
    file.setAttribute('href', rel(f));
    res.appendChild(file);
  }
  resources.appendChild(res);

  const itemId = uid('ITEM');
  const item = doc.createElementNS(org.namespaceURI, 'item');
  item.setAttribute('identifier', itemId);
  item.setAttribute('identifierref', resId);
  setTitle(doc, item, opts.title);

  if (opts.afterId) {
    const after = findItem(doc, opts.afterId);
    after.parentNode!.insertBefore(item, after.nextSibling);
  } else {
    // Items must precede <metadata>/<imsss:sequencing> inside an organization.
    const trailing = Array.from(org.children).find((c) => c.localName !== 'title' && c.localName !== 'item');
    org.insertBefore(item, trailing ?? null);
  }
  return { xml: serialize(doc, xml), itemId };
}

/** Remove an item. Its resource is removed too when nothing else references it. */
export function removeItem(xml: string, id: string): { xml: string; removedResource?: ResourceModel } {
  const doc = parse(xml);
  const item = findItem(doc, id);
  const ref = item.getAttribute('identifierref');
  item.parentNode!.removeChild(item);

  let removedResource: ResourceModel | undefined;
  if (ref) {
    const stillUsed = Array.from(doc.getElementsByTagNameNS('*', 'item')).some((i) => i.getAttribute('identifierref') === ref);
    const dependedOn = Array.from(doc.getElementsByTagNameNS('*', 'dependency')).some((d) => d.getAttribute('identifierref') === ref);
    if (!stillUsed && !dependedOn) {
      removedResource = readResources(doc).byId.get(ref);
      const res = Array.from(doc.getElementsByTagNameNS('*', 'resource')).find((r) => r.getAttribute('identifier') === ref);
      res?.parentNode?.removeChild(res);
    }
  }
  return { xml: serialize(doc, xml), removedResource };
}

/** Move an item up (-1) or down (+1) among its sibling items. */
export function moveItem(xml: string, id: string, delta: -1 | 1): string {
  const doc = parse(xml);
  const item = findItem(doc, id);
  const siblings = kids(item.parentElement!, 'item');
  const idx = siblings.indexOf(item);
  const target = siblings[idx + delta];
  if (!target) return xml;
  if (delta < 0) item.parentNode!.insertBefore(item, target);
  else item.parentNode!.insertBefore(item, target.nextSibling);
  return serialize(doc, xml);
}

/** Add a <file> entry to the resource that launches `pageHref` (keeps packages LMS-tidy). */
export function listFileInResource(xml: string, resourceId: string, fileHref: string): string {
  const doc = parse(xml);
  const res = Array.from(doc.getElementsByTagNameNS('*', 'resource')).find((r) => r.getAttribute('identifier') === resourceId);
  if (!res) return xml;
  if (kids(res, 'file').some((f) => f.getAttribute('href') === fileHref)) return xml;
  const file = doc.createElementNS(res.namespaceURI, 'file');
  file.setAttribute('href', fileHref);
  const firstDep = kid(res, 'dependency');
  res.insertBefore(file, firstDep ?? null);
  return serialize(doc, xml);
}

/**
 * Remove resources, every <dependency> that points at them, and any <file>
 * entry for the given paths (e.g. images in a shared resource). Whitespace
 * left by removed elements is tidied so the file doesn't fill with blank lines.
 */
export function removeResourcesAndFiles(xml: string, resourceIds: Iterable<string>, filePaths: Iterable<string>): string {
  const doc = parse(xml);
  const ids = new Set(resourceIds);
  const paths = new Set(filePaths);
  const drop = (el: Element) => {
    const prev = el.previousSibling;
    if (prev && prev.nodeType === 3 && !prev.textContent!.trim()) prev.parentNode!.removeChild(prev);
    el.parentNode?.removeChild(el);
  };
  for (const res of Array.from(doc.getElementsByTagNameNS('*', 'resource'))) {
    if (ids.has(res.getAttribute('identifier') ?? '')) drop(res);
  }
  for (const dep of Array.from(doc.getElementsByTagNameNS('*', 'dependency'))) {
    if (ids.has(dep.getAttribute('identifierref') ?? '')) drop(dep);
  }
  if (paths.size) {
    const { list } = readResources(doc);
    const byId = new Map(list.map((r) => [r.identifier, r]));
    for (const res of Array.from(doc.getElementsByTagNameNS('*', 'resource'))) {
      const model = byId.get(res.getAttribute('identifier') ?? '');
      kids(res, 'file').forEach((f, i) => {
        if (model && paths.has(model.files[i])) drop(f);
      });
    }
  }
  return serialize(doc, xml);
}

export function createManifest(version: ScormVersion, title: string): string {
  const id = uid('COURSE');
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (version === '1.2') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_1">
    <organization identifier="ORG_1">
      <title>${esc}</title>
    </organization>
  </organizations>
  <resources/>
</manifest>
`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG_1">
    <organization identifier="ORG_1">
      <title>${esc}</title>
    </organization>
  </organizations>
  <resources/>
</manifest>
`;
}
