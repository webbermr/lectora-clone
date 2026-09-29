/** Byte <-> string helpers that respect the charset declared by HTML/XML files. */

const utf8 = new TextEncoder();

export function detectCharset(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const m =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  if (m) {
    const label = m[1].toLowerCase();
    try {
      new TextDecoder(label);
      return label;
    } catch {
      /* unknown label, fall through */
    }
  }
  return 'utf-8';
}

export function decodeText(bytes: Uint8Array): string {
  const charset = detectCharset(bytes);
  return new TextDecoder(charset).decode(bytes);
}

/**
 * Encode text as UTF-8. If the markup declares a different charset, rewrite the
 * declaration so the saved bytes and the declared encoding agree.
 */
export function encodeText(text: string): Uint8Array {
  const fixed = text
    .replace(/(<meta[^>]+charset\s*=\s*["']?\s*)(?!utf-8)[\w-]+/i, '$1utf-8')
    .replace(/(<\?xml[^>]+encoding\s*=\s*["'])(?!utf-8)[\w-]+/i, '$1UTF-8');
  return utf8.encode(fixed);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
