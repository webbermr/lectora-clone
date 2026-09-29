import { describe, expect, it } from 'vitest';
import { declaredObjects, hiddenIds, navigatesAway, objectRoot, pagesWithObject, setHidden } from '../src/lib/removeObjects';
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
    expect(one).toContain('<style id="lc-removed">\n#shape58889{display:none!important}\n</style>\n</head>');
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
});
