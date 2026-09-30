import { describe, expect, it } from 'vitest';
import { declaredObjects, hiddenIds, hiddenRules, navigatesAway, objectIdOf, objectRoot, pagesWithObject, setHidden } from '../src/lib/removeObjects';
import { pageFromObjectIds } from '../src/lib/pageIdentity';
import { encodeText } from '../src/lib/text';

const page = `<html><head><title>P</title></head><body>
<script>
button6746 = new ObjButton('button6746', 'Close TOC',772,156,27,28,0,90,'div','',1,0)
shape58889 = new ObjImage('shape58889', 'Callout 1',10,10,300,200)
text236596 = new ObjText('text236596', 'Callout text',20,20,200,100)
button139 = new ObjButton('button139', 'Next',900,700,30,30)
function button139onUp() {
    trivExitPage('a001_next.html',true);
}
function button6746onUp() {
    if( toc1603.isVisible()) toc1603.actionHide();
}
</script></body></html>`;

describe('removing objects from a page', () => {
  it('reads what the page declares, with Lectora names', () => {
    const d = declaredObjects(page);
    expect(d.get('button6746')).toEqual({ id: 'button6746', kind: 'ObjButton', name: 'Close TOC' });
    expect(d.get('shape58889')?.name).toBe('Callout 1');
    expect(d.size).toBe(4);
  });

  it('hides by id in one editor-owned block, and restores cleanly', () => {
    const one = setHidden(page, ['shape58889']);
    expect(one).toMatch(/<style id="lc-removed">\n#shape58889,#shape58889div,#shape58889path,#shape58889SVG,[^\n]*\{display:none!important\}\n<\/style>\n<\/head>/);
    expect(hiddenIds(one)).toEqual(['shape58889']);
    const two = setHidden(one, [...hiddenIds(one), 'text236596', 'shape58889']);
    expect(hiddenIds(two)).toEqual(['shape58889', 'text236596']);
    expect(two.match(/lc-removed/g)).toHaveLength(1);
    // Restoring everything gives back the page byte for byte.
    expect(setHidden(two, [])).toBe(page);
  });

  it('warns about buttons that leave the page', () => {
    expect(navigatesAway(page, 'button139')).toBe(true);
    expect(navigatesAway(page, 'button6746')).toBe(false);
    expect(navigatesAway(page, 'shape58889')).toBe(false);
  });

  it('finds every page that has an inherited object', () => {
    const files = { 'a.html': encodeText(page), 'b.html': encodeText(page.replace(/shape58889[^\n]*\n/, '')), 'c.js': encodeText("new ObjButton('button6746'") };
    expect(pagesWithObject(files, 'button6746')).toEqual(['a.html', 'b.html']);
    expect(pagesWithObject(files, 'shape58889')).toEqual(['a.html']);
  });

  it('selects the whole object from a click on its inner SVG path', () => {
    document.body.innerHTML = '<div id="pageDIV"><div id="shape58889"><svg><path id="shape58889path"></path></svg></div><div><span>no id</span></div></div>';
    const d = declaredObjects(page);
    expect(objectRoot(document.getElementById('shape58889path')!, d)?.id).toBe('shape58889');
    expect(objectRoot(document.querySelector('span')!, d)).toBeNull();
  });

  it("finds the object from a part that isn't nested inside it, and hides every part", () => {
    // Lectora can draw a button's clickable path in its own SVG, outside the button's element.
    document.body.innerHTML = '<div id="pageDIV"><div id="button6746"></div><svg id="button6746SVG"><path id="button6746path"></path></svg><div id="button67460"></div></div>';
    const d = declaredObjects(page);
    const root = objectRoot(document.getElementById('button6746path')!, d)!;
    expect(root.id).toBe('button6746');
    expect(root.element.id).toBe('button6746');
    expect(objectIdOf('button67460', d)).toBeNull(); // a different object, not a part
    const html = setHidden(page, ['button6746'], new Map([['button6746', ['button6746', 'button6746Extra']]]));
    const parts = hiddenRules(html).get('button6746')!;
    expect(parts).toEqual(expect.arrayContaining(['button6746', 'button6746path', 'button6746SVG', 'button6746MapArea', 'button6746Extra']));
    expect(parts).not.toContain('button67460');
    // Adding another object keeps the parts already recorded.
    expect(hiddenRules(setHidden(html, ['button6746', 'shape58889'])).get('button6746')).toContain('button6746Extra');
  });

  it("tells which page a page player is showing from the objects on screen", () => {
    const decl = (ids: string[]) => ids.map((id) => `${id} = new ObjText('${id}', 'x')`).join('\n');
    const inherited = ['button1', 'button2', 'text3', 'image4'];
    const files = {
      'a001index.html': encodeText('<script>pagePlayer.gotoPage(" a.html ")</script>'),
      'a001_a.html': encodeText(decl([...inherited, 'text10', 'text11'])),
      'a001_b.html': encodeText(decl([...inherited, 'text20'])),
      'a001_only_inherited.html': encodeText(decl(inherited)),
    };
    expect(pageFromObjectIds([...inherited, 'text20', 'pageDIV'], files)).toBe('a001_b.html');
    expect(pageFromObjectIds([...inherited, 'text10', 'text11'], files)).toBe('a001_a.html');
    expect(pageFromObjectIds(inherited, files)).toBe('a001_only_inherited.html');
    expect(pageFromObjectIds(['pageDIV', 'something'], files)).toBeNull();
  });
});

describe('image object names', () => {
  it("uses Lectora's name, not the image file", () => {
    const d = declaredObjects("shape66593 = new ObjImage('shape66593','images/shape66593.png','Rectangle 2',832,0,178,58,1,71,'div','',0 )");
    expect(d.get('shape66593')).toEqual({ id: 'shape66593', kind: 'ObjImage', name: 'Rectangle 2' });
  });
});
