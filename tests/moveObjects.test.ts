import { describe, expect, it } from 'vitest';
import { declaredPosition, declaredPositions, moveInSource } from '../src/lib/moveObjects';

// As Lectora 19 publishes them.
const page = `<script>
text63337 = new ObjText('text63337',null,320,9,505,25,1,76,null,'div',null,0 )
text63337.initSLine(0)
text63337.addIe8Attr(320, 9, 505, 25, 0, 0)
button6746 = new ObjButton('button6746', 'Close TOC',772,156,27.000000,28.000000,0,90,'div','',1,0)
button6746.addIe8Attr(772, 156, 27, 28, 0, 0)
text633370 = new ObjText('text633370',null,320,9,10,10)
</script>`;

describe('moving objects', () => {
  it('reads declared positions, named or not', () => {
    expect(declaredPosition(page, 'text63337')).toEqual({ x: 320, y: 9 });
    expect(declaredPosition(page, 'button6746')).toEqual({ x: 772, y: 156 });
    expect(declaredPosition(page, 'nope')).toBeNull();
    expect(declaredPositions(page).size).toBe(3);
  });

  it('rewrites the declaration and the old-browser copy, and nothing else', () => {
    const moved = moveInSource(page, 'text63337', { x: 370.4, y: 39 });
    expect(moved).toContain("new ObjText('text63337',null,370,39,505,25,1,76");
    expect(moved).toContain('text63337.addIe8Attr(370, 39, 505, 25, 0, 0)');
    // A different object whose id starts the same, at the same spot, is untouched.
    expect(moved).toContain("new ObjText('text633370',null,320,9,10,10)");
    expect(moveInSource(moved, 'text63337', { x: 320, y: 9 })).toBe(page);
  });

  it('leaves a second layout at other coordinates alone', () => {
    const twoLayouts = page + "\nif (is.isPhone) { text63337 = new ObjText('text63337',null,10,20,300,25) }";
    const moved = moveInSource(twoLayouts, 'text63337', { x: 400, y: 50 });
    expect(moved).toContain("new ObjText('text63337',null,400,50,505,25");
    expect(moved).toContain("new ObjText('text63337',null,10,20,300,25)");
  });
});
