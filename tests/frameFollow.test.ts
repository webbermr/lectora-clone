import { describe, expect, it } from 'vitest';
import { pathFromFrameUrl } from '../src/lib/frameFollow';
import { vfsUrl } from '../src/lib/vfs';

describe('following the page a frame shows', () => {
  it('maps a served URL back to the package path', () => {
    expect(pathFromFrameUrl(vfsUrl('p1', 'a001_safety_intro.html') + '?x=1#top', 'p1')).toBe('a001_safety_intro.html');
    expect(pathFromFrameUrl(vfsUrl('p1', 'pages/My Page.html'), 'p1')).toBe('pages/My Page.html');
  });
  it('ignores URLs outside the project', () => {
    expect(pathFromFrameUrl(vfsUrl('other', 'a.html'), 'p1')).toBeNull();
    expect(pathFromFrameUrl('https://example.com/a.html', 'p1')).toBeNull();
    expect(pathFromFrameUrl('about:blank', 'p1')).toBeNull();
  });
});
