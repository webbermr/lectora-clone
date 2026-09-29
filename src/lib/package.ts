/** Reading and writing SCORM .zip packages. */
import JSZip from 'jszip';
import { normalize } from './paths';

export type FileMap = Record<string, Uint8Array>;

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

export async function readScormZip(data: ArrayBuffer | Uint8Array | Blob): Promise<FileMap> {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !JUNK.test(f.name));

  // The manifest must be at the package root, but zips are often made from
  // the parent folder, so accept the shallowest manifest and re-root there.
  const manifests = entries
    .map((f) => normalize(f.name))
    .filter((n) => n.toLowerCase().endsWith('imsmanifest.xml'))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (!manifests.length) {
    throw new Error('No imsmanifest.xml found. This does not look like a SCORM package.');
  }
  const prefix = manifests[0].slice(0, manifests[0].length - 'imsmanifest.xml'.length);

  const files: FileMap = {};
  await Promise.all(
    entries.map(async (entry) => {
      const name = normalize(entry.name);
      if (!name.startsWith(prefix)) return;
      files[name.slice(prefix.length)] = await entry.async('uint8array');
    }),
  );
  // Normalise manifest case (IMSManifest.xml → imsmanifest.xml).
  const manifestKey = Object.keys(files).find((k) => k.toLowerCase() === 'imsmanifest.xml');
  if (manifestKey && manifestKey !== 'imsmanifest.xml') {
    files['imsmanifest.xml'] = files[manifestKey];
    delete files[manifestKey];
  }
  return files;
}

/**
 * Formats that are already compressed. Deflating them again costs most of the
 * export time (a course is mostly images and audio) and saves almost nothing,
 * so they're stored as-is.
 */
const PRECOMPRESSED = /\.(png|jpe?g|gif|webp|avif|ico|mp3|m4a|aac|ogg|oga|opus|mp4|m4v|mov|webm|ogv|flv|swf|zip|gz|7z|rar|pdf|docx|xlsx|pptx|woff2?|eot)$/i;

export function shouldCompress(path: string): boolean {
  return !PRECOMPRESSED.test(path);
}

export interface ZipProgress {
  /** 0–100 across the whole package. */
  percent: number;
  /** The file being written right now. */
  currentFile: string | null;
}

export async function writeScormZip(
  files: FileMap,
  onProgress?: (p: ZipProgress) => void,
  opts: { compressAll?: boolean } = {},
): Promise<Blob> {
  const zip = new JSZip();
  const add = (path: string, bytes: Uint8Array) =>
    zip.file(path, bytes, {
      compression: opts.compressAll || shouldCompress(path) ? 'DEFLATE' : 'STORE',
      compressionOptions: { level: 6 },
    });
  // Put the manifest first; some LMS importers only peek at the first entries.
  add('imsmanifest.xml', files['imsmanifest.xml']);
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (path !== 'imsmanifest.xml') add(path, bytes);
  }
  return zip.generateAsync({ type: 'blob' }, (m) => onProgress?.({ percent: m.percent, currentFile: m.currentFile }));
}
