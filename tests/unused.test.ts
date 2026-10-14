import { describe, expect, it } from 'vitest';
import { findUnused } from '../src/lib/unused';
import { BLANK_GIF, withoutFiles } from '../src/lib/actions';
import { setHidden } from '../src/lib/removeObjects';
import { parseManifest } from '../src/lib/manifest';
import { encodeText } from '../src/lib/text';

// Lectora lists every file in the manifest, so that list mustn't count as using them.
const manifest = (files: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="M" version="1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd">
  <organizations default="O"><organization identifier="O"><title>Course</title><item identifier="I1" identifierref="SCO"><title>Course</title></item></organization></organizations>
  <resources>
    <resource identifier="SCO" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource>
${files.map((f, i) => `    <resource identifier="A${i}" type="webcontent" adlcp:scormtype="asset"><file href="${f}"/></resource>`).join('\n')}
  </resources>
</manifest>`;

const course = () => {
  const others = ['page2.html', 'old_page.html', 'images/a.png', 'images/c.png', 'images/d.png', 'images/pic.png', 'media/b.mp3', 'resources/My Handbook.pdf', '_tobj1.txt', 'trivantis.js', 'imscp_rootv1p1p2.xsd'];
  const files: Record<string, Uint8Array> = {
    'imsmanifest.xml': encodeText(manifest(others)),
    'index.html': encodeText(`<html><head><script src="trivantis.js"></script></head><body><img src="images/a.png"><script>function trivNextPage(){ trivExitPage('page2.html') }</script></body></html>`),
    // Audio by name, a picture whose name the script builds, a PDF with a space in its name (as a link would encode it).
    'page2.html': encodeText(`<html><body><script>var snd = 'media/b.mp3'; var img = 'images/' + 'pic' + '.png';</script><a href="resources/My%20Handbook.pdf">Handbook</a></body></html>`),
    // A page nothing links to any more, and the picture only it shows.
    'old_page.html': encodeText('<html><body><img src="images/c.png"></body></html>'),
  };
  for (const f of others) files[f] ??= new Uint8Array(1000);
  return files;
};

describe('files nothing in the course uses', () => {
  it('follows what the launched page links to, shows and loads, and leaves the rest', () => {
    const files = course();
    const r = findUnused(files, parseManifest(new TextDecoder().decode(files['imsmanifest.xml'])));
    expect(r.paths).toEqual(['images/c.png', 'images/d.png', 'old_page.html']);
    expect(r.bytes).toBe(files['images/c.png'].length + files['images/d.png'].length + files['old_page.html'].length);
  });

  it('leaves them out of the published files and the manifest, and drops asset entries left empty', () => {
    const files = course();
    const m = parseManifest(new TextDecoder().decode(files['imsmanifest.xml']));
    const out = withoutFiles(files, m, new Set(['images/c.png', 'old_page.html']));
    expect(Object.keys(out)).not.toContain('old_page.html');
    expect(Object.keys(out)).toContain('images/d.png');
    const xml = new TextDecoder().decode(out['imsmanifest.xml']);
    expect(xml).not.toContain('old_page.html');
    expect(xml).not.toContain('images/c.png');
    expect(xml).toContain('images/d.png');
    expect(parseManifest(xml).resources.map((r) => r.identifier)).not.toContain('A1'); // old_page.html's entry
    expect(files['old_page.html']).toBeDefined(); // the project keeps everything
    expect(withoutFiles(files, m, new Set())).toBe(files);
  });

  it('counts pictures only removed objects show as unused, and blanks them on the published page', () => {
    const files = course();
    const page = [
      '<html><head></head><body><script>',
      "image1 = new ObjImage('image1','images/a.png','Logo',0,0,10,10,1,1,'div',null,0)",
      "button2 = new ObjButton('button2','Next',0,0,10,10)",
      'button2.setImages({"disabledState":"","downState":"images/button2_down.png","normalState":"images/button2.png","overState":""});',
      'button2.build();',
      "shape3 = new ObjImage('shape3','images/d.png','Line',0,0,10,10,1,2,'div','',0)",
      '</script></body></html>',
    ].join('\n');
    // button2 removed in the editor; the logo also stays on index.html, so it's still used.
    files['page2.html'] = encodeText(setHidden(page, ['button2', 'shape3']).replace('</script>', "var snd = 'media/b.mp3';</script>"));
    files['images/button2.png'] = new Uint8Array(10);
    files['images/button2_down.png'] = new Uint8Array(10);
    files['index.html'] = encodeText(new TextDecoder().decode(files['index.html']).replace('</body>', '<a href="page2.html">2</a></body>'));
    const m = parseManifest(new TextDecoder().decode(files['imsmanifest.xml']));
    const r = findUnused(files, m);
    expect(r.paths).toEqual(expect.arrayContaining(['images/button2.png', 'images/button2_down.png', 'images/d.png']));
    expect(r.paths).not.toContain('images/a.png');
    expect(r.removedOnly.sort()).toEqual(['images/button2.png', 'images/button2_down.png', 'images/d.png']);

    const out = withoutFiles(files, m, new Set(r.removedOnly));
    const html = new TextDecoder().decode(out['page2.html']);
    expect(html).toContain(`"normalState":"${BLANK_GIF}"`);
    expect(html).toContain(`'shape3','${BLANK_GIF}'`);
    expect(html).toContain("'image1','images/a.png'");
  });
});

