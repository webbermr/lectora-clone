/**
 * How SCORM reaches Claude. Either the editor's server holds an Anthropic API key and passes requests on
 * (Docker: ANTHROPIC_API_KEY; the key never reaches the browser), or the person enters their own key, kept
 * only in this browser and sent straight to Anthropic.
 */
const KEY_STORE = 'scorm-editor.anthropic-key';
const MODE_STORE = 'scorm-editor.ai-mode';

export type Mode = 'server' | 'own';

export interface Connection {
  /** The server has a key to use. */
  server: boolean;
  /** This browser has a key the person entered. */
  ownKey: string | null;
  /** Which one requests go through, or null when neither is set up. */
  mode: Mode | null;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the key lasts for this page only */
  }
}

let memoryKey: string | null = null;

/** Asks the editor's server whether it has a key (answers 404 or nothing when it doesn't). */
export async function serverHasKey(): Promise<boolean> {
  try {
    const r = await fetch(new URL('api/scorm-ai/status', document.baseURI), { cache: 'no-store' });
    if (!r.ok) return false;
    const j = (await r.json()) as { server?: unknown };
    return j.server === true;
  } catch {
    return false;
  }
}

export async function loadConnection(): Promise<Connection> {
  const server = await serverHasKey();
  const ownKey = read(KEY_STORE) ?? memoryKey;
  const preferred = read(MODE_STORE) as Mode | null;
  const mode: Mode | null = preferred === 'own' && ownKey ? 'own' : server ? 'server' : ownKey ? 'own' : null;
  return { server, ownKey, mode };
}

export function saveOwnKey(key: string | null) {
  memoryKey = key;
  write(KEY_STORE, key);
}

export function saveMode(mode: Mode) {
  write(MODE_STORE, mode);
}

/** Where the SDK sends requests, and with which key. */
export function endpoint(c: Connection): { baseURL?: string; apiKey: string } | null {
  if (c.mode === 'own' && c.ownKey) return { apiKey: c.ownKey };
  // The server's proxy adds the real key; the SDK still needs something in the header.
  if (c.mode === 'server') return { baseURL: new URL('api/anthropic', document.baseURI).href.replace(/\/$/, ''), apiKey: 'server-key' };
  return null;
}
