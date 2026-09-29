/**
 * Which package files belong to which module/section/page, as declared in
 * imsmanifest.xml: an item's resource lists its files, and <dependency>
 * pulls in shared resources. A module (an item with children) owns what its
 * pages own.
 */
import { flattenItems, type ItemNode, type ManifestModel } from './manifest';
import { splitQuery } from './paths';

export interface FileIndex {
  /** Files each item uses, including its dependencies and, for modules, its children's. */
  itemFiles: Map<string, string[]>;
  /** Items (pages/SCOs with a resource) that use each file. */
  fileItems: Map<string, ItemNode[]>;
  /** Top-level modules that use each file. */
  fileModules: Map<string, ItemNode[]>;
  /** Files in the package that no item claims. */
  unlisted: string[];
}

export function buildFileIndex(manifest: ManifestModel, packageFiles: string[]): FileIndex {
  const resById = new Map(manifest.resources.map((r) => [r.identifier, r]));
  const exists = new Set(packageFiles);

  const resourceFiles = (id: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    const res = resById.get(id);
    if (!res || seen.has(id)) return out;
    seen.add(id);
    if (res.href) out.add(splitQuery(res.href).path);
    for (const f of res.files) out.add(f);
    for (const dep of res.dependencies) for (const f of resourceFiles(dep, seen)) out.add(f);
    return out;
  };

  const itemFiles = new Map<string, string[]>();
  const fileItems = new Map<string, ItemNode[]>();
  const fileModules = new Map<string, ItemNode[]>();

  const visit = (item: ItemNode): Set<string> => {
    const own = item.identifierref ? resourceFiles(item.identifierref) : new Set<string>();
    for (const f of own) {
      if (!fileItems.has(f)) fileItems.set(f, []);
      fileItems.get(f)!.push(item);
    }
    const all = new Set(own);
    for (const child of item.children) for (const f of visit(child)) all.add(f);
    const list = [...all].filter((f) => exists.has(f)).sort();
    itemFiles.set(item.identifier, list);
    return all;
  };

  for (const top of manifest.items) {
    for (const f of visit(top)) {
      if (!fileModules.has(f)) fileModules.set(f, []);
      const mods = fileModules.get(f)!;
      if (!mods.includes(top)) mods.push(top);
    }
  }

  const claimed = new Set(fileItems.keys());
  const unlisted = packageFiles.filter((f) => f !== 'imsmanifest.xml' && !claimed.has(f) && !/\.xsd$|\.dtd$/i.test(f)).sort();
  return { itemFiles, fileItems, fileModules, unlisted };
}

/** Number of pages (items with a launch file) under an item, itself included. */
export function pageCount(item: ItemNode): number {
  return flattenItems([item]).filter((i) => i.href).length;
}
