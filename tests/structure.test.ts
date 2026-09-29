import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/lib/manifest';
import { readScormZip } from '../src/lib/package';
import { buildFileIndex, pageCount } from '../src/lib/structure';
import { decodeText } from '../src/lib/text';

describe('module file index', () => {
  it('assigns files to pages, sections and modules, following dependencies', async () => {
    const files = await readScormZip(readFileSync('samples/onboarding-modules-scorm2004.zip'));
    const m = parseManifest(decodeText(files['imsmanifest.xml']));
    const idx = buildFileIndex(m, Object.keys(files));

    expect(m.items.map((i) => i.title)).toEqual(['Module 1: Getting Started', 'Module 2: Policies']);
    expect(pageCount(m.items[1])).toBe(3);

    // A page owns its own files plus the shared dependency.
    expect(idx.itemFiles.get('I_P1')).toEqual(['common/scorm.js', 'common/style.css', 'images/logo.png', 'm1/team.png', 'm1/welcome.html']);
    // A section owns its pages' files; a module owns its sections'.
    expect(idx.itemFiles.get('SEC_TIMEOFF')).toContain('m2/time-off/sick.html');
    expect(idx.itemFiles.get('MOD2')).toContain('m2/conduct.html');
    expect(idx.itemFiles.get('MOD2')).not.toContain('m1/team.png');

    expect(idx.fileModules.get('m1/team.png')!.map((i) => i.identifier)).toEqual(['MOD1']);
    expect(idx.fileModules.get('common/style.css')!.map((i) => i.identifier)).toEqual(['MOD1', 'MOD2']);
    expect(idx.fileItems.get('common/style.css')!.length).toBe(5);

    expect(idx.unlisted).toEqual(['extras/notes.txt']);
  });
});
