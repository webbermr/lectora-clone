import { describe, expect, it } from 'vitest';
import { sameObjectEverywhere } from '../src/lib/objectTwins';
import { encodeText } from '../src/lib/text';

// The copyright line as Lectora 19 publishes it: a separate object per chapter.
const copyright = (id: string, x: number, y: number, z = 68) => `${id} = new ObjText('${id}',null,${x},${y},395,15,1,${z},null,'div',null,0 )
${id}.addIe8Attr(${x}, ${y}, 395, 15, 0, 0)
${id}.addInnerText('<div id=\\"${id}\\" aria-hidden=\\"true\\" ><p style=\\"text-align:center;\\" >\\n<span class=\\"${id}Font1\\"  >Copyright © 2017 The Monitoring Association (TMA). All rights reserved.</span ></p></div>')`;
const shape = (id: string) => `${id} = new ObjImage('${id}',null,0,0,100,100)`;

const files = {
  'a001_technology_welcome.html': encodeText(`<script>\n${copyright('text236596', 203, 41)}\n${shape('shape1')}\n</script>`),
  'a001_technology_goals.html': encodeText(`<script>\n${copyright('text236596', 203, 41)}\n${shape('shape1')}\n</script>`),
  'a001_intro_screens_narration.html': encodeText(`<script>\n${copyright('text236001', 203, 41, 71)}\n${shape('shape2')}\n</script>`),
  'a001_student_dashboard.html': encodeText(`<script>\n${copyright('text236384', 613, 647)}\n</script>`),
  'a001_other.html': encodeText(`<script>\n${copyright('text9', 203, 41).replace('All rights reserved.', 'Draft.')}\n</script>`),
};

describe('the same object on other pages', () => {
  it("finds each chapter's copy with the same content at the same spot", () => {
    const refs = sameObjectEverywhere(files, 'a001_technology_welcome.html', 'text236596');
    expect(refs).toEqual([
      { page: 'a001_intro_screens_narration.html', id: 'text236001' },
      { page: 'a001_technology_goals.html', id: 'text236596' },
      { page: 'a001_technology_welcome.html', id: 'text236596' },
    ]);
  });

  it("leaves copies placed elsewhere or saying something else, and doesn't lump plain shapes together", () => {
    const refs = sameObjectEverywhere(files, 'a001_technology_welcome.html', 'text236596').map((r) => r.page);
    expect(refs).not.toContain('a001_student_dashboard.html');
    expect(refs).not.toContain('a001_other.html');
    expect(sameObjectEverywhere(files, 'a001_technology_welcome.html', 'shape1').map((r) => r.page)).toEqual(['a001_technology_goals.html', 'a001_technology_welcome.html']);
  });
});
