import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The part of public/vfs-sync.js that stops pages starting by themselves in Live edit.
const helper = readFileSync('public/vfs-sync.js', 'utf8');
type EditorWindow = Window & { __lcStage?: string; __lcLastGesture?: number; __lcPageStart?: number; __lcOnHeld?: (what: string) => void; trivExitPage?: (url: string) => void };

describe('Live edit: nothing on a page starts by itself', () => {
  afterEach(() => {
    vi.useRealTimers();
    const w = window as EditorWindow;
    delete w.__lcStage;
    delete w.trivExitPage;
    delete w.__lcLastGesture;
    delete w.__lcPageStart;
    document.body.innerHTML = '';
  });

  const load = (stage: string) => {
    const w = window as EditorWindow;
    w.__lcStage = stage;
    const held: string[] = [];
    w.__lcOnHeld = (what) => held.push(what);
    (0, eval)(helper);
    return held;
  };
  const audio = () => {
    const a = document.createElement('audio');
    document.body.appendChild(a);
    let paused = 0;
    a.pause = () => void paused++;
    return { a, paused: () => paused };
  };

  it('pauses narration that starts without a click, and lets a click start it', () => {
    vi.useFakeTimers();
    const held = load('live');
    const n = audio();
    n.a.dispatchEvent(new Event('play'));
    expect(n.paused()).toBe(1);
    expect(held).toEqual(['narration']);
    vi.advanceTimersByTime(10); // the click comes after the page started
    window.dispatchEvent(new Event('pointerdown'));
    n.a.dispatchEvent(new Event('play'));
    expect(n.paused()).toBe(1);
  });

  it('holds back a move to another page that nobody clicked for, and allows a clicked one', () => {
    vi.useFakeTimers();
    const held = load('live');
    const went: string[] = [];
    (window as EditorWindow).trivExitPage = (url) => went.push(url);
    vi.advanceTimersByTime(300); // the page's own trivExitPage is wrapped once it exists
    (window as EditorWindow).trivExitPage!('a001_timeout.html');
    expect(went).toEqual([]);
    expect(held).toEqual(['a001_timeout.html']);
    window.dispatchEvent(new Event('mousedown'));
    (window as EditorWindow).trivExitPage!('a001_next.html');
    expect(went).toEqual(['a001_next.html']);
    // The click that moved on doesn't let the next thing start by itself.
    (window as EditorWindow).trivExitPage!('a001_after.html');
    expect(went).toEqual(['a001_next.html']);
  });

  it("doesn't act on Lectora's timers (session timeout, counters) when they run out", () => {
    vi.useFakeTimers();
    const held = load('live');
    const w = window as unknown as Record<string, unknown>;
    // Like trivantis-progress.js and a page's script: the timer object keeps its own reference to onDone.
    function ObjProgress(this: { onDone: () => void }) {
      this.onDone = () => {};
    }
    const fired: string[] = [];
    w.ObjProgress = ObjProgress;
    w.progress19923onDone = () => fired.push('timeout warning');
    const timerObj = new (ObjProgress as unknown as new () => { onDone: () => void })();
    timerObj.onDone = w.progress19923onDone as () => void;
    w.progress19923 = timerObj;
    vi.advanceTimersByTime(300);
    timerObj.onDone(); // the timer runs out
    (w.progress19923onDone as () => void)();
    expect(fired).toEqual([]);
    expect(held).toContain('timer');
    // Back in Preview the same timer acts as the course made it.
    (window as EditorWindow).__lcStage = 'preview';
    timerObj.onDone();
    expect(fired).toEqual(['timeout warning']);
    delete w.ObjProgress;
    delete w.progress19923;
    delete w.progress19923onDone;
  });

  it('leaves Preview alone', () => {
    vi.useFakeTimers();
    load('preview');
    const n = audio();
    n.a.dispatchEvent(new Event('play'));
    expect(n.paused()).toBe(0);
    const went: string[] = [];
    (window as EditorWindow).trivExitPage = (url) => went.push(url);
    vi.advanceTimersByTime(300);
    (window as EditorWindow).trivExitPage!('a001_next.html');
    expect(went).toEqual(['a001_next.html']);
  });
});
