import { describe, expect, it } from 'vitest';
import { aspectRatio, imageInfo, replacementMismatches } from '../src/lib/imageInfo';

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

describe('image facts from bytes', () => {
  it('reads PNG size and transparency', () => {
    // 1x1 RGBA PNG
    const rgba = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
    expect(imageInfo(rgba)).toEqual({ format: 'PNG', width: 1, height: 1, transparent: true, animated: false });
  });

  it('reads GIF size and transparency', () => {
    const gif = b64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    expect(imageInfo(gif)).toMatchObject({ format: 'GIF', width: 1, height: 1, transparent: true });
  });

  it('reads JPEG size from the frame header', () => {
    // Minimal JPEG header: SOI, APP0 (skipped), SOF0 with 480 high x 640 wide.
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(imageInfo(jpg)).toEqual({ format: 'JPEG', width: 640, height: 480, transparent: false });
  });

  it('reads SVG size from width/height or viewBox', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"></svg>');
    expect(imageInfo(svg)).toEqual({ format: 'SVG', width: 120, height: 80 });
  });

  it('describes aspect ratios and mismatches', () => {
    expect(aspectRatio(1280, 720)).toBe('16:9');
    expect(aspectRatio(400, 300)).toBe('4:3');
    const png = { format: 'PNG' as const, width: 400, height: 300, transparent: true };
    expect(replacementMismatches(png, { ...png })).toEqual([]);
    const msgs = replacementMismatches(png, { format: 'JPEG', width: 1280, height: 720, transparent: false });
    expect(msgs.join(' ')).toMatch(/JPEG.*PNG/);
    expect(msgs.join(' ')).toMatch(/16:9.*4:3/);
    expect(msgs.join(' ')).toMatch(/transparent/);
  });
});
