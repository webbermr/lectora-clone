import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScormChat } from '../src/lib/scorm/agent';
import { applyProposal, objectAt, pageOverview, proposalProblem, runTool, sameChangeElsewhere, TOOLS } from '../src/lib/scorm/tools';
import { encodeText } from '../src/lib/text';

// A Lectora-style page (names invented).
const page = `<html><head><title>Welcome</title><script>
var pgID = 'page1';
function trivNextPage() {
    trivExitPage( 'a001_next.html', true )
}
function button9onUp() {
  trivExitPage('a001_next.html',true);
}
</script></head><body><script>
button9 = new ObjButton('button9', 'Next',954,629,30,30,1,1,'div','',1,0)
text5 = new ObjText('text5',null,320,9,505,25,1,79,null,'div',null,0 )
text5.addInnerText('<p>Copyright 2017 Example Co.</p>')
</script></body></html>`;

const files = () => ({
  'a001_welcome.html': encodeText(page),
  'a001_next.html': encodeText('<html><body>next</body></html>'),
  'images/logo.png': new Uint8Array([137, 80, 78, 71]),
});
const ctx = () => ({ files: files(), manifest: null, courseName: 'Test course' });

describe("SCORM's tools", () => {
  it('lists, reads and searches the package', async () => {
    expect((await runTool('list_files', { prefix: 'images/' }, ctx())).content).toContain('images/logo.png\t4');
    const read = await runTool('read_file', { path: 'a001_welcome.html' }, ctx());
    expect(read.content).toContain('new ObjButton');
    expect((await runTool('read_file', { path: 'images/logo.png' }, ctx())).isError).toBe(true);
    expect((await runTool('read_file', { path: 'nope.html' }, ctx())).isError).toBe(true);
    const found = await runTool('search_files', { pattern: 'copyright \\d+' }, ctx());
    expect(found.content).toMatch(/^1 matching lines \(1 different\)\. .*\na001_welcome\.html:\d+ \(offset \d+\): text5\.addInnerText/);
    expect((await runTool('search_files', { pattern: '(' }, ctx())).isError).toBe(true);
  });

  it("shows the text around a match deep in Lectora's long lines, and an inherited line once", async () => {
    // Lectora's styled text: hundreds of characters of markup before the words.
    const styles = '<div id=\\"text236596\\" style=\\"visibility:hidden;\\"><a id=\\"text236596anc\\"></a>'.repeat(6);
    const footer = (id: string) => `<html><body><script>\n${id}.addInnerText('${styles}<p><span>Copyright © 2017 The Example Association (TEA). All rights reserved.</span></p>')\n</script></body></html>`;
    const many: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 50; i++) many[`a001_page_${String(i).padStart(2, '0')}.html`] = encodeText(footer('text236596'));
    many['a001_chapter2.html'] = encodeText(footer('text236384'));
    const out = (await runTool('search_files', { pattern: 'Copyright' }, { files: many, manifest: null, courseName: 'C' })).content;
    expect(out).toMatch(/^51 matching lines \(1 different\)/);
    expect(out).toContain('Copyright © 2017 The Example Association (TEA). All rights reserved.');
    expect(out).toContain('(the same text is also in 50 more: a001_page_01.html:2, ');
    // The offset points read_file at the match.
    const at = Number(/a001_chapter2\.html:2 \(offset (\d+)\)/.exec(out)![1]);
    expect((await runTool('read_file', { path: 'a001_chapter2.html', offset: at }, { files: many, manifest: null, courseName: 'C' })).content.startsWith('Copyright © 2017')).toBe(true);
  });

  it('summarises a page: objects, text, where Next goes', () => {
    const o = pageOverview(files(), 'a001_welcome.html');
    expect(o).toContain('Title: Welcome');
    expect(o).toContain('Next page: a001_next.html');
    expect(o).toContain('Buttons that move on: button9');
    expect(o).toContain('ObjButton button9 "Next" 954,629 30×30');
    expect(o).toContain('ObjText text5 "" 320,9 505×25 — text: Copyright 2017 Example Co.');
  });

  it('proposes edits only when the text occurs exactly once, and never applies them itself', async () => {
    const c = ctx();
    const ok = await runTool('propose_edit', { path: 'a001_welcome.html', find: 'Copyright 2017', replace: 'Copyright 2026', summary: 'Update the year' }, c);
    expect(ok.isError).toBeFalsy();
    expect(ok.proposal).toMatchObject({ path: 'a001_welcome.html', find: 'Copyright 2017', replace: 'Copyright 2026' });
    expect(new TextDecoder().decode(c.files['a001_welcome.html'])).toContain('Copyright 2017'); // unchanged
    expect(applyProposal(c.files, ok.proposal!)).toContain('Copyright 2026 Example Co.');

    expect((await runTool('propose_edit', { path: 'a001_welcome.html', find: 'button9', replace: 'x', summary: 's' }, c)).content).toContain('more than once');
    expect((await runTool('propose_edit', { path: 'a001_welcome.html', find: 'missing', replace: 'x', summary: 's' }, c)).content).toContain("isn't in");
    expect((await runTool('propose_edit', { path: 'a001_welcome.html', find: 'Copyright' }, c)).content).toContain('INVALID_INPUT');
    expect(proposalProblem(c.files, { path: 'images/logo.png', find: 'a', replace: 'b' })).toContain("isn't a text file");
  });

  it('defines each tool with a schema the API accepts', () => {
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(Array.isArray(t.input_schema.required)).toBe(true);
    }
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });
});

/** A streamed Messages API reply, as server-sent events. */
function sse(message: { content: unknown[]; stop_reason: string }): string {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
  ];
  message.content.forEach((block, index) => {
    const b = block as { type: string; text?: string; id?: string; name?: string; input?: unknown };
    if (b.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } }]);
    } else {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
  });
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
}

describe('a change to an object that is on other pages too', () => {
  // The copyright line: inherited by two pages (same id), copied into another chapter (another id), and on one
  // more page with different wording.
  const withCopyright = (id: string, text: string) =>
    encodeText(`<html><body><script>
button9 = new ObjButton('button9', 'Next',954,629,30,30,1,1,'div','',1,0)
${id} = new ObjText('${id}',null,203,41,395,15,1,71,null,'div',null,0 )
${id}.addInnerText('<p><span class="${id}Font1">${text}</span></p>')
</script></body></html>`);
  const course = () => ({
    'a001_intro_one.html': withCopyright('text236596', 'Copyright © 2016 The Example Association. All rights reserved.'),
    'a001_intro_two.html': withCopyright('text236596', 'Copyright © 2016 The Example Association. All rights reserved.'),
    'a001_reporting_one.html': withCopyright('text236384', 'Copyright © 2016 The Example Association. All rights reserved.'),
    'a001_old_page.html': withCopyright('text236000', 'Copyright © 2014 Someone Else.'),
  });

  it("finds the object's other pages, including a chapter's copy under another id", () => {
    const files = course();
    const html = new TextDecoder().decode(files['a001_intro_one.html']);
    expect(objectAt(html, html.indexOf('2016'))).toBe('text236596');
    const r = sameChangeElsewhere(files, 'a001_intro_one.html', 'text236596Font1">Copyright © 2016', 'text236596Font1">Copyright © 2025');
    expect(r.object).toEqual({ id: 'text236596', name: '' });
    expect(r.elsewhere).toEqual([
      { path: 'a001_intro_two.html', find: 'text236596Font1">Copyright © 2016', replace: 'text236596Font1">Copyright © 2025' },
      { path: 'a001_reporting_one.html', find: 'text236384Font1">Copyright © 2016', replace: 'text236384Font1">Copyright © 2025' },
    ]);
    for (const c of r.elsewhere!) expect(applyProposal(files, c)).toContain('Copyright © 2025 The Example Association');
  });

  it('offers the other pages with the proposal, and tells SCORM so', async () => {
    const out = await runTool('propose_edit', { path: 'a001_intro_one.html', find: 'Copyright © 2016', replace: 'Copyright © 2025', summary: 'Update the copyright year' }, { files: course(), manifest: null, courseName: 'C' });
    expect(out.proposal!.elsewhere!.map((e) => e.path)).toEqual(['a001_intro_two.html', 'a001_reporting_one.html']);
    expect(out.content).toContain('also on 2 other pages');
  });

  it('leaves out text that is not in a named object unless it is long enough to be the same thing', () => {
    const files = { 'a.html': encodeText('<html><body><p>Hello there</p></body></html>'), 'b.html': encodeText('<html><body><p>Hello there</p></body></html>') };
    expect(sameChangeElsewhere(files, 'a.html', 'Hello', 'Hi')).toEqual({});
    expect(sameChangeElsewhere(files, 'a.html', '<p>Hello there</p>', '<p>Hi there</p>').elsewhere!.map((e) => e.path)).toEqual(['b.html']);
  });
});

describe("SCORM's conversation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends what is on screen, runs the tools Claude asks for, keeps proposals for review, and streams the answer', async () => {
    const replies = [
      sse({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'page_overview', input: { path: 'a001_welcome.html' } },
          { type: 'tool_use', id: 'toolu_2', name: 'propose_edit', input: { path: 'a001_welcome.html', find: 'Copyright 2017', replace: 'Copyright 2026', summary: 'Update the year' } },
        ],
      }),
      sse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'The copyright year is **2017**; I proposed 2026.' }] }),
    ];
    const bodies: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      bodies.push({ url: String(url), headers, body: JSON.parse(String(init.body)) });
      return new Response(replies.shift()!, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } });
    });
    const chat = new ScormChat({ apiKey: 'server-key', baseURL: 'http://editor.test/api/anthropic' });
    await chat.ask('What year is the copyright?', { courseName: 'Test course', view: 'Live edit', page: 'a001_welcome.html', pageTitle: 'Welcome', selected: { id: 'text5', name: '' } }, ctx);

    // Through the editor's server, with the server's placeholder key, the right model and every tool.
    expect(bodies[0].url).toBe('http://editor.test/api/anthropic/v1/messages?beta=true');
    expect(bodies[0].headers['x-api-key']).toBe('server-key');
    expect(bodies[0].body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', cache_control: { type: 'ephemeral' } });
    expect((bodies[0].body.tools as { name: string; eager_input_streaming: boolean }[]).map((t) => t.name)).toContain('propose_edit');
    const first = (bodies[0].body.messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(first).toContain('View: Live edit');
    expect(first).toContain('Page on screen: a001_welcome.html — "Welcome"');
    expect(first).toContain('Selected object: text5');
    expect(first.endsWith('What year is the copyright?')).toBe(true);

    // Both tool results go back together, after the assistant turn exactly as it came.
    const second = bodies[1].body.messages as { role: string; content: { type: string; tool_use_id?: string; content?: string }[] }[];
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[2].content.map((c) => c.tool_use_id)).toEqual(['toolu_1', 'toolu_2']);
    expect(second[2].content[0].content).toContain('Next page: a001_next.html');

    expect(chat.items.map((i) => i.kind)).toEqual(['user', 'tool', 'tool', 'proposal', 'assistant']);
    expect(chat.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'The copyright year is **2017**; I proposed 2026.' });
    expect(chat.items[3]).toMatchObject({ kind: 'proposal', state: 'pending' });
    expect(chat.busy).toBe(false);

    // What the person did with the proposal goes with the next question.
    chat.settle((chat.items[3] as { proposal: { id: string } }).proposal.id, 'applied');
    replies.push(sse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }));
    await chat.ask('Thanks', { courseName: 'Test course', view: 'Edit', page: 'a001_welcome.html' }, ctx);
    const third = bodies[2].body.messages as { content: { text?: string }[] }[];
    expect(third.at(-1)!.content[0].text).toMatch(/Proposal p\d+ \(Update the year\): applied by the person\./);
  });

  it('explains a rejected key in plain words', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const chat = new ScormChat({ apiKey: 'sk-ant-wrong' });
    await chat.ask('Hello', { courseName: 'C', view: 'Edit', page: null }, ctx);
    expect(chat.items.at(-1)).toMatchObject({ kind: 'error' });
    expect((chat.items.at(-1) as { text: string }).text).toContain('API key was not accepted');
  });
});
