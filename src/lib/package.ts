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

export async function writeScormZip(files: FileMap): Promise<Blob> {
  const zip = new JSZip();
  // Put the manifest first; some LMS importers only peek at the first entries.
  zip.file('imsmanifest.xml', files['imsmanifest.xml']);
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (path === 'imsmanifest.xml') continue;
    zip.file(path, bytes);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
