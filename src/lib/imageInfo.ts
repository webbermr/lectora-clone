/**
 * Exact facts about an image file, read from its header bytes: real format
 * (whatever the extension says), pixel size and transparency. Used to tell
 * authors what a replacement image needs to be.
 */

export interface ImageInfo {
  format: 'PNG' | 'JPEG' | 'GIF' | 'WebP' | 'SVG' | 'BMP' | 'Unknown';
  width?: number;
  height?: number;
  /** true/false when the format says; undefined when it can't be told from the header. */
  transparent?: boolean;
  animated?: boolean;
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

export function imageInfo(bytes: Uint8Array): ImageInfo {
  const b = bytes;
  // PNG: IHDR holds size and colour type; alpha comes from colour type 4/6 or a tRNS chunk.
  if (b.length > 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    const colorType = b[25];
    let transparent = colorType === 4 || colorType === 6;
    let animated = false;
    for (let i = 8; i + 8 <= b.length; ) {
      const len = be32(b, i);
      const type = ascii(b, i + 4, 4);
      if (type === 'tRNS') transparent = true;
      if (type === 'acTL') animated = true;
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return { format: 'PNG', width: be32(b, 16), height: be32(b, 20), transparent, animated };
  }
  // JPEG: walk segments to the start-of-frame marker. Never transparent.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'JPEG', height: be16(b, i + 5), width: be16(b, i + 7), transparent: false };
      }
      i += 2 + be16(b, i + 2);
    }
    return { format: 'JPEG', transparent: false };
  }
  // GIF: logical screen size; a graphic control extension with the transparency flag.
  if (b.length > 10 && ascii(b, 0, 3) === 'GIF') {
    let transparent = false;
    let frames = 0;
    for (let i = 13; i + 3 < b.length; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) {
        if (b[i + 3] & 1) transparent = true;
        frames++;
      }
    }
    return { format: 'GIF', width: le16(b, 6), height: le16(b, 8), transparent, animated: frames > 1 };
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X, which flags alpha/animation).
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return { format: 'WebP', width: le24(b, 24) + 1, height: le24(b, 27) + 1, transparent: !!(b[20] & 0x10), animated: !!(b[20] & 0x02) };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { format: 'WebP', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, transparent: !!((bits >> 28) & 1) };
    }
    if (chunk === 'VP8 ') return { format: 'WebP', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff, transparent: false };
    return { format: 'WebP' };
  }
  if (b.length > 26 && ascii(b, 0, 2) === 'BM') {
    return { format: 'BMP', width: b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24), height: Math.abs(new DataView(b.buffer, b.byteOffset).getInt32(22, true)) };
  }
  // SVG: size from width/height, else the viewBox. Scales to any size.
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  if (/<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
    const num = (attr: string) => {
      const v = new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`).exec(tag);
      return v ? Math.round(Number(v[1])) : undefined;
    };
    const vb = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    return { format: 'SVG', width: num('width') ?? (vb ? Math.round(Number(vb[1])) : undefined), height: num('height') ?? (vb ? Math.round(Number(vb[2])) : undefined) };
  }
  return { format: 'Unknown' };
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** "4:3", "16:9", or a decimal ratio when it isn't a tidy one. */
export function aspectRatio(w: number, h: number): string {
  if (!w || !h) return '';
  const g = gcd(w, h);
  const [a, b] = [w / g, h / g];
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  return `${(w / h).toFixed(2)}:1`;
}

const EXT: Record<string, ImageInfo['format']> = { png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', svg: 'SVG', bmp: 'BMP' };

/** The format a file's extension claims, for spotting mislabelled images. */
export function formatFromName(name: string): ImageInfo['format'] | undefined {
  return EXT[name.split('.').pop()?.toLowerCase() ?? ''];
}

/**
 * How a replacement compares with the original, as sentences for a confirmation.
 * Empty when it's a like-for-like swap.
 */
export function replacementMismatches(original: ImageInfo, next: ImageInfo): string[] {
  const out: string[] = [];
  if (original.format !== next.format && original.format !== 'Unknown' && next.format !== 'Unknown') {
    out.push(`It's a ${next.format}, but the original is a ${original.format}. Browsers will still show it, but it keeps the original's file name and extension.`);
  }
  if (original.width && original.height && next.width && next.height) {
    const r0 = original.width / original.height;
    const r1 = next.width / next.height;
    if (Math.abs(r0 - r1) / r0 > 0.02) {
      out.push(`Its shape is ${aspectRatio(next.width, next.height)} (${next.width} × ${next.height}), but the original is ${aspectRatio(original.width, original.height)} (${original.width} × ${original.height}). If the page sets the image's size, it will look stretched or squashed.`);
    } else if (next.width !== original.width || next.height !== original.height) {
      const bigger = next.width > original.width;
      out.push(`It's ${next.width} × ${next.height}, the original is ${original.width} × ${original.height} (same shape). ${bigger ? 'It will be scaled down to fit, which is fine.' : 'It may look blurry where it is shown larger than its size.'}`);
    }
  }
  if (original.transparent && next.transparent === false) {
    out.push("The original has a transparent background and this one doesn't, so a solid background may show around it.");
  }
  return out;
}
