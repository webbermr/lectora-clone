import { useState } from 'react';
import { categoryHeading, courseRules, reportText, type CourseRule, type RuleCategory, type RulesReport } from '../lib/courseRules';
import { basename } from '../lib/paths';
import { store, useStore } from '../lib/store';

/** Sidebar tab: what the course does on its own (timers, lockouts, advance rules, test settings…). */
export function RulesPanel() {
  const s = useStore();
  const [report, setReport] = useState<RulesReport | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const scan = async () => {
    const p = store.project!;
    setProgress('Scanning…');
    setCopied(false);
    const r = await courseRules(p.files, p.manifest, async (done, total) => {
      setProgress(`Scanning ${done} of ${total} pages…`);
      await new Promise((res) => setTimeout(res, 0));
    });
    setReport(r);
    setProgress('');
  };

  const copy = async () => {
    if (!report) return;
    const text = reportText(report, s.project?.name ?? 'course');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked: offer the text as a file instead.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'course-rules.txt';
      a.click();
    }
  };

  const byCategory = new Map<RuleCategory, CourseRule[]>();
  for (const r of report?.rules ?? []) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);

  return (
    <div className="panel-body rules-panel">
      <div className="mini-toolbar">
        <button className="primary" onClick={() => void scan()} disabled={!!progress}>
          {progress || (report ? '⟳ Scan again' : '🔎 Scan course rules')}
        </button>
        {report && <button onClick={() => void copy()} title="Copy the report as text, to paste into an email or chat">{copied ? '✓ Copied' : '📋 Copy report'}</button>}
      </div>
      <p className="hint">
        Reads every page's own scripts and lists what the course does by itself: timers and timeouts, what happens when
        narration ends, conditions on buttons (like lockouts for skipping), what each page checks when it opens, test
        settings, and anything saved in the LMS. Rules that repeat on many pages are listed once.
      </p>
      {report && (
        <p className="small muted">
          {report.rules.length} rules found in {report.pagesScanned} pages.
        </p>
      )}
      {[...byCategory].map(([cat, rules]) => (
        <details key={cat} className="section rules-group" open={cat !== 'variable' && cat !== 'click'}>
          <summary>
            {categoryHeading(cat)} <span className="count">{rules.length}</span>
          </summary>
          <ul className="rules-list">
            {rules.map((r, i) => (
              <Rule key={i} rule={r} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Rule({ rule }: { rule: CourseRule }) {
  return (
    <li className={'rule' + (rule.category === 'password' ? ' warn' : '')}>
      <div className="rule-title">{rule.title}</div>
      <ul className="rule-details">
        {rule.details.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {rule.pages.length > 0 && (
        <details className="rule-pages">
          <summary>
            on {rule.pages.length} page{rule.pages.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {rule.pages.map((p) => (
              <li key={p}>
                <button className="link" title={`Open ${p}`} onClick={() => store.openPage(p, null)}>
                  {basename(p)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
