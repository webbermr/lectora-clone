import type { Issue } from '../lib/courseCheck';
import { store } from '../lib/store';

const ICON = { error: '⛔', warning: '⚠', info: 'ℹ' } as const;

/** Course-check findings, each linking to the file involved. */
export function CheckList({ issues, onOpen }: { issues: Issue[]; onOpen?: () => void }) {
  return (
    <ul className="check-list">
      {issues.map((i, n) => (
        <li key={n} className={'check-item ' + i.severity}>
          <span className="check-icon" aria-label={i.severity}>{ICON[i.severity]}</span>
          <div>
            <b>{i.kind}</b>
            {i.file && (
              <>
                {' · '}
                <button
                  className="linkish mono"
                  title="Open this file in Code view"
                  onClick={() => {
                    store.openPage(i.file!, null);
                    store.setView('code');
                    onOpen?.();
                  }}
                >
                  {i.file}
                </button>
              </>
            )}
            <div className="small">{i.message}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
