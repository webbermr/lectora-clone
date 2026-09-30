import { afterEach, describe, expect, it } from 'vitest';
import { store } from '../src/lib/store';
import { readForSyncRequest } from '../src/lib/syncRead';
import { encodeText } from '../src/lib/text';

const base = 'https://editor.example/app/';

describe("course pages' synchronous file requests", () => {
  afterEach(() => {
    store.project = null;
  });

  it('answers from the open project, whatever the case of the name', () => {
    store.project = { id: 'p1', name: 'x', manifest: null, files: { '_tobj3566.txt': encodeText('U2FsdGVkX1abc'), 'data/My File.xml': encodeText('<a/>') } };
    expect(readForSyncRequest(`${base}vfs/p1/_tobj3566.txt?x=1`, base)).toEqual({ text: 'U2FsdGVkX1abc', type: expect.stringMatching(/text\/plain/) });
    expect(readForSyncRequest(`${base}vfs/p1/_TOBJ3566.txt`, base)?.text).toBe('U2FsdGVkX1abc');
    expect(readForSyncRequest(`${base}vfs/p1/data/My%20File.xml`, base)?.type).toMatch(/xml/);
  });

  it('leaves anything else to the network', () => {
    store.project = { id: 'p1', name: 'x', manifest: null, files: { 'a.txt': encodeText('a') } };
    expect(readForSyncRequest(`${base}vfs/p1/missing.txt`, base)).toBeNull();
    expect(readForSyncRequest(`${base}vfs/other/a.txt`, base)).toBeNull();
    expect(readForSyncRequest('https://lms.example/api', base)).toBeNull();
    store.project = null;
    expect(readForSyncRequest(`${base}vfs/p1/a.txt`, base)).toBeNull();
  });
});
