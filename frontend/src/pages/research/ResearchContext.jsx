/** D5157 part 6: recorded Research Project context, shared by the rail and phone sheet. */
import React from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet.jsx';
import { findingsView } from './researchFindings.js';
import { progressFractions, statusOf } from './researchProjects.js';
import { shortDate } from './researchHome.js';

const link = 'text-violet-700 underline dark:text-violet-300';
const muted = 'text-sm text-axal-muted dark:text-gray-400';

function ReadBlock({ read, retry, children }) {
  if (!read || read.status === 'loading') return <p role="status">Reading…</p>;
  if (read.status !== 'ok') return <p role="status">Could not be read. <button type="button" className={link} onClick={retry}>Retry</button></p>;
  return children;
}

export function ResearchContextBody({ data, findings, compared, retryFindings, retryCompared }) {
  const item = data.item;
  const base = `/research/projects/${encodeURIComponent(item.uid)}`;
  const coverage = Array.isArray(data.evidence) ? progressFractions(data).answerable : null;
  const saved = findingsView(findings).cards?.filter((card) => !card.proposal) ?? [];
  const sets = compared?.value?.comparisons;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 text-sm">
      <section>
        <h3 className="font-semibold">Active project</h3>
        <Link className={`${link} break-words`} to={base}>{item.title}</Link>
        <p className={muted}>{statusOf(item).label} · Saved {shortDate(item.updated_at)}</p>
      </section>
      <section>
        <h3 className="font-semibold">Evidence coverage</h3>
        <p className={muted}>{coverage ? `${coverage.n} of ${coverage.of} sources answerable in Ask` : 'Not recorded'}</p>
        <Link className={link} to={`${base}/evidence`}>Open Evidence</Link>
      </section>
      <section>
        <h3 className="font-semibold">Open questions</h3>
        <p className={muted}>Not recorded</p>
      </section>
      <section>
        <h3 className="font-semibold">Saved findings</h3>
        <ReadBlock read={findings} retry={retryFindings}>
          <p className={muted}>Source facts {saved.filter((card) => card.kind === 'source_fact').length} · Eadwyn {saved.filter((card) => card.kind === 'interpretation').length} · Yours {saved.filter((card) => card.kind === 'conclusion').length}</p>
          <Link className={link} to={`${base}/findings`}>Open Findings</Link>
        </ReadBlock>
      </section>
      <section>
        <h3 className="font-semibold">Comparison set</h3>
        <ReadBlock read={compared} retry={retryCompared}>
          {!Array.isArray(sets) ? <p className={muted}>Not recorded</p> : sets.length ? (
            <ul className="space-y-2">
              {sets.map((set) => (
                <li key={set.uid} className="break-words">
                  <Link className={link} to={`${base}/comparisons#cmp-${encodeURIComponent(set.uid)}`}>{set.title}</Link>
                  <p className={muted}>{set.members?.map((member) => member.name).join(' · ') || 'No entries in this set'}</p>
                </li>
              ))}
            </ul>
          ) : <p className={muted}>No saved comparisons yet.</p>}
        </ReadBlock>
      </section>
      <details>
        <summary className="cursor-pointer font-semibold">AI settings</summary>
        <Link className={link} to="/account/usage">Account usage</Link>
      </details>
    </div>
  );
}

export default function ResearchContext({ onClose, opener, overlay = false, ...data }) {
  const body = <ResearchContextBody {...data} />;
  if (overlay) return <Sheet title="Research context" onClose={onClose} returnFocusTo={opener} phone="sheet" testId="research-context-sheet">{body}</Sheet>;
  return (
    <aside className="rounded-lg border border-axal-hairline dark:border-gray-700" aria-label="Research context">
      <header className="flex items-center justify-between gap-2 border-b border-axal-hairline p-4 dark:border-gray-700">
        <h2 className="font-semibold">Research context</h2>
        <button type="button" className={link} onClick={() => { onClose(); opener.current?.focus(); }}>Collapse</button>
      </header>
      {body}
    </aside>
  );
}
