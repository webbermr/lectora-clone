import { describe, expect, it } from 'vitest';
import { applyToText, findInFile, flexiblePattern } from '../src/lib/sourceMatch';

function replaceOnce(path: string, source: string, oldText: string, newText: string) {
  const matches = findInFile(path, source, flexiblePattern(oldText)!);
  expect(matches.length).toBe(1);
  return applyToText(source, matches, newText);
}

describe('flexible matching', () => {
  it('finds text in a single-quoted JS string with escapes and markup', () => {
    const src = `text38.write('<p><span style="font-size:18px">It\\'s time to learn &amp; grow</span></p>');`;
    const out = replaceOnce('page.js', src, "It's time to learn & grow", "Let's learn & grow <fast>");
    expect(out).toBe(`text38.write('<p><span style="font-size:18px">Let\\'s learn &amp; grow &lt;fast&gt;</span></p>');`);
  });

  it('keeps double-quote escaping inside double-quoted strings', () => {
    const src = `var t = "Say \\"hi\\" to the team";`;
    const out = replaceOnce('a.js', src, 'Say "hi" to the team', 'Say "hello" now');
    expect(out).toBe(`var t = "Say \\"hello\\" now";`);
  });

  it('matches \\u escapes and re-encodes non-ASCII the same way (Storyline-style JSON)', () => {
    const src = `{"text":"Caf\\u00e9 safety \\u2014 rules"}`;
    const out = replaceOnce('data.json', src, 'Café safety — rules', 'Café rules — updated');
    expect(out).toBe(`{"text":"Caf\\u00e9 rules \\u2014 updated"}`);
  });

  it('matches HTML entities and whitespace across line breaks in HTML', () => {
    const src = `<div id="t1">Don&rsquo;t   forget\n    your&nbsp;badge</div>`;
    const out = replaceOnce('p.html', src, 'Don’t forget your badge', 'Don’t lose it');
    expect(out).toBe(`<div id="t1">Don&rsquo;t lose it</div>`);
  });

  it('matches legacy escape() encoding', () => {
    const src = `unescape('Hello%20there%21')`;
    const out = replaceOnce('x.js', src, 'Hello there!', 'Bye now!');
    expect(out).toBe(`unescape('Bye%20now%21')`);
  });

  it('does not match inside identifiers', () => {
    const src = `function goNext(){}; label = 'Next';`;
    const matches = findInFile('a.js', src, flexiblePattern('Next')!);
    expect(matches.length).toBe(1);
    expect(src.slice(matches[0].index - 1, matches[0].index)).toBe("'");
  });

  it('knows script blocks inside HTML are JS', () => {
    const src = `<p>Intro</p><script>var s = 'Intro';</script>`;
    const matches = findInFile('p.html', src, flexiblePattern('Intro')!);
    expect(matches.map((m) => m.context)).toEqual(['html', 'js']);
  });
});
