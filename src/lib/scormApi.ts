/**
 * A minimal in-browser LMS so previewed content finds a SCORM API.
 * Exposes window.API (SCORM 1.2) and window.API_1484_11 (SCORM 2004) on the
 * app window, which is the parent of the preview iframe.
 */

export interface ScormLogEntry {
  time: number;
  call: string;
  args: string[];
  result: string;
}

type Listener = (entry: ScormLogEntry) => void;

export class PreviewLms {
  data: Record<string, string> = {};
  log: ScormLogEntry[] = [];
  private listeners = new Set<Listener>();
  private lastError = '0';

  constructor() {
    this.reset();
  }

  reset() {
    this.data = {
      'cmi.core.student_id': 'preview',
      'cmi.core.student_name': 'Preview, Author',
      'cmi.core.lesson_status': 'not attempted',
      'cmi.core.entry': 'ab-initio',
      'cmi.core.lesson_mode': 'normal',
      'cmi.core.credit': 'credit',
      'cmi.launch_data': '',
      'cmi.suspend_data': '',
      'cmi.learner_id': 'preview',
      'cmi.learner_name': 'Preview, Author',
      'cmi.completion_status': 'unknown',
      'cmi.success_status': 'unknown',
      'cmi.entry': 'ab-initio',
      'cmi.mode': 'normal',
      'cmi.credit': 'credit',
      'cmi.interactions._count': '0',
      'cmi.objectives._count': '0',
    };
    this.log = [];
    this.lastError = '0';
  }

  onLog(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private record(call: string, args: unknown[], result: string): string {
    const entry = { time: Date.now(), call, args: args.map(String), result };
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    this.listeners.forEach((l) => l(entry));
    return result;
  }

  private get(key: string): string {
    if (key in this.data) {
      this.lastError = '0';
      return this.data[key];
    }
    // Collection counts that were never set are simply zero.
    if (key.endsWith('._count')) return '0';
    this.lastError = '0';
    return '';
  }

  private set(key: string, value: string): string {
    this.data[key] = String(value);
    // Keep interaction/objective counts in step with indexed writes.
    const m = /^(cmi\.(?:interactions|objectives))\.(\d+)\./.exec(key);
    if (m) {
      const count = Number(this.data[`${m[1]}._count`] ?? 0);
      if (Number(m[2]) >= count) this.data[`${m[1]}._count`] = String(Number(m[2]) + 1);
    }
    this.lastError = '0';
    return 'true';
  }

  install(win: Window) {
    const r = this.record.bind(this);
    const api12 = {
      LMSInitialize: (a = '') => r('LMSInitialize', [a], 'true'),
      LMSFinish: (a = '') => r('LMSFinish', [a], 'true'),
      LMSGetValue: (k: string) => r('LMSGetValue', [k], this.get(k)),
      LMSSetValue: (k: string, v: string) => r('LMSSetValue', [k, v], this.set(k, v)),
      LMSCommit: (a = '') => r('LMSCommit', [a], 'true'),
      LMSGetLastError: () => this.lastError,
      LMSGetErrorString: (c: string) => (c === '0' ? 'No error' : 'General error'),
      LMSGetDiagnostic: (c: string) => `Preview LMS diagnostic for ${c}`,
    };
    const api2004 = {
      Initialize: (a = '') => r('Initialize', [a], 'true'),
      Terminate: (a = '') => r('Terminate', [a], 'true'),
      GetValue: (k: string) => r('GetValue', [k], this.get(k)),
      SetValue: (k: string, v: string) => r('SetValue', [k, v], this.set(k, v)),
      Commit: (a = '') => r('Commit', [a], 'true'),
      GetLastError: () => this.lastError,
      GetErrorString: (c: string) => (c === '0' ? 'No error' : 'General error'),
      GetDiagnostic: (c: string) => `Preview LMS diagnostic for ${c}`,
    };
    Object.assign(win, { API: api12, API_1484_11: api2004 });
  }

  /** Human-readable status for the preview toolbar. */
  summary(): string {
    const used2004 = this.log.some((l) => l.call === 'Initialize');
    const status = used2004
      ? `${this.data['cmi.completion_status']} / ${this.data['cmi.success_status']}`
      : this.data['cmi.core.lesson_status'];
    const score = this.data['cmi.core.score.raw'] ?? this.data['cmi.score.raw'] ?? this.data['cmi.score.scaled'];
    return `status: ${status}${score ? ` · score: ${score}` : ''}`;
  }
}

export const previewLms = new PreviewLms();
