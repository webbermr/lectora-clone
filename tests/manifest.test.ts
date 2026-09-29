import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as mf from '../src/lib/manifest';
import { readScormZip, writeScormZip } from '../src/lib/package';
import { decodeText } from '../src/lib/text';
import { fromEditDocument, toEditCopy } from '../src/lib/html';
import { relative, resolveFrom } from '../src/lib/paths';

const sample12 = () => readScormZip(readFileSync('samples/coffee-basics-scorm12.zip'));
const sample2004 = () => readScormZip(readFileSync('samples/workshop-safety-scorm2004.zip'));

describe('package import', () => {
  it('re-roots a zip that has a parent folder', async () => {
    const files = await sample12();
    expect(Object.keys(files)).toContain('imsmanifest.xml');
    expect(Object.keys(files)).toContain('content/intro.html');
    expect(Object.keys(files).some((k) => k.startsWith('coffee-basics/'))).toBe(false);
  });

  it('rejects zips without a manifest', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('index.html', '<p>hi</p>');
    await expect(readScormZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/imsmanifest/);
  });

  it('round-trips through export', async () => {
    const files = await sample12();
    const blob = await writeScormZip(files);
    const again = await readScormZip(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(again).sort()).toEqual(Object.keys(files).sort());
    expect(decodeText(again['content/intro.html'])).toEqual(decodeText(files['content/intro.html']));
  });
});

describe('manifest parsing', () => {
  it('reads a SCORM 1.2 organization', async () => {
    const m = mf.parseManifest(decodeText((await sample12())['imsmanifest.xml']));
    expect(m.version).toBe('1.2');
    expect(m.title).toBe('Coffee Basics');
    expect(m.items.map((i) => i.title)).toEqual(['Welcome', 'Where Coffee Grows', 'Roasting']);
    expect(m.items[0].href).toBe('content/intro.html');
  });

  it('reads SCORM 2004 with xml:base and item parameters', async () => {
    const m = mf.parseManifest(decodeText((await sample2004())['imsmanifest.xml']));
    expect(m.version).toBe('2004');
    expect(m.items[0].href).toBe('sco/index.html');
    expect(m.items[0].query).toBe('?start=1');
  });
});

describe('manifest editing', () => {
  it('renames, adds, moves and removes pages', async () => {
    let xml = decodeText((await sample12())['imsmanifest.xml']);
    xml = mf.setCourseTitle(xml, 'Coffee 101');
    xml = mf.setItemTitle(xml, 'ITEM_2', 'Origins');
    const added = mf.addPage(xml, { title: 'Brewing', href: 'pages/brewing.html', afterId: 'ITEM_1' });
    xml = added.xml;
    let m = mf.parseManifest(xml);
    expect(m.title).toBe('Coffee 101');
    expect(m.items.map((i) => i.title)).toEqual(['Welcome', 'Brewing', 'Origins', 'Roasting']);
    expect(m.items[1].href).toBe('pages/brewing.html');
    expect(xml).toMatch(/adlcp:scormtype="sco"/);

    xml = mf.moveItem(xml, added.itemId, 1);
    m = mf.parseManifest(xml);
    expect(m.items.map((i) => i.title)).toEqual(['Welcome', 'Origins', 'Brewing', 'Roasting']);

    const removed = mf.removeItem(xml, added.itemId);
    expect(removed.removedResource?.href).toBe('pages/brewing.html');
    m = mf.parseManifest(removed.xml);
    expect(m.items.map((i) => i.title)).toEqual(['Welcome', 'Origins', 'Roasting']);
    // The shared dependency resource must survive.
    expect(removed.xml).toContain('identifier="SHARED"');
  });

  it('keeps 2004 sequencing and places new items before it', async () => {
    const xml = decodeText((await sample2004())['imsmanifest.xml']);
    const { xml: out } = mf.addPage(xml, { title: 'Quiz', href: 'sco/quiz.html' });
    expect(out).toContain('imsss:sequencing');
    expect(out.indexOf('<title>Quiz</title>')).toBeLessThan(out.indexOf('imsss:sequencing'));
    expect(out).toMatch(/adlcp:scormType="sco"/);
    // Paths are written relative to <resources xml:base="sco/">.
    expect(out).toMatch(/href="quiz.html"/);
    expect(mf.parseManifest(out).items[1].href).toBe('sco/quiz.html');
  });

  it('creates valid blank manifests', () => {
    for (const v of ['1.2', '2004'] as const) {
      const xml = mf.addPage(mf.createManifest(v, 'T & C'), { title: 'P1', href: 'p1.html' }).xml;
      const m = mf.parseManifest(xml);
      expect(m.version).toBe(v);
      expect(m.title).toBe('T & C');
      expect(m.items[0].href).toBe('p1.html');
    }
  });
});

describe('edit copy', () => {
  it('disables scripts and handlers, then restores them exactly', () => {
    const src = `<!DOCTYPE html><html><head><title>x</title><script src="a.js"></script><script type="module">go()</script></head><body onload="init()"><a href="#" onclick="next()">Next</a></body></html>`;
    const copy = toEditCopy(src);
    expect(copy).not.toMatch(/\sonload=/);
    expect(copy).toContain('text/x-lectora-clone-disabled');
    const doc = new DOMParser().parseFromString(copy, 'text/html');
    doc.querySelector('a')!.textContent = 'Continue';
    const out = fromEditDocument(doc, '<!DOCTYPE html>');
    expect(out).toMatch(/^<!DOCTYPE html>/);
    expect(out).toContain('onload="init()"');
    expect(out).toContain('onclick="next()"');
    expect(out).toContain('<script src="a.js"></script>');
    expect(out).toContain('<script type="module">go()</script>');
    expect(out).toContain('>Continue</a>');
    expect(out).not.toContain('data-lc');
  });
});

describe('paths', () => {
  it('computes relative links between pages', () => {
    expect(relative('content/intro.html', 'images/bean.png')).toBe('../images/bean.png');
    expect(relative('content/intro.html', 'content/next.html')).toBe('next.html');
    expect(relative('index.html', 'assets/a.png')).toBe('assets/a.png');
    expect(resolveFrom('content/intro.html', '../images/bean.png?x=1')).toBe('images/bean.png');
    expect(resolveFrom('content/intro.html', 'https://example.com/x')).toBeNull();
  });
});

describe('export compression', () => {
  it('stores already-compressed media and deflates text, with progress', async () => {
    const { shouldCompress } = await import('../src/lib/package');
    expect(shouldCompress('images/a.PNG')).toBe(false);
    expect(shouldCompress('media/n.mp3')).toBe(false);
    expect(shouldCompress('a001_page.html')).toBe(true);
    expect(shouldCompress('trivantis.js')).toBe(true);

    const text = new TextEncoder().encode('<p>repeat</p>'.repeat(2000));
    const media = new Uint8Array(5000).map((_, i) => (i * 7919) % 251);
    const updates: number[] = [];
    const blob = await writeScormZip(
      { 'imsmanifest.xml': new TextEncoder().encode('<manifest/>'), 'page.html': text, 'images/pic.png': media },
      (p) => updates.push(p.percent),
    );
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    // Internal sizes: STORE keeps compressed == uncompressed; DEFLATE shrinks repetitive text.
    const size = (n: string) => (zip.files[n] as unknown as { _data: { compressedSize: number; uncompressedSize: number } })._data;
    expect(size('images/pic.png').compressedSize).toBe(size('images/pic.png').uncompressedSize);
    expect(size('page.html').compressedSize).toBeLessThan(size('page.html').uncompressedSize / 10);
    expect(Object.keys(zip.files)[0]).toBe('imsmanifest.xml');
    expect(updates.at(-1)).toBe(100);
  });
});
