import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { fromCodeView, githubHref, languagesText } from './designFromCode';

/**
 * D782 (#2114) — Solution design's "From GitHub" part (`id="from-github"`),
 * under the features table, from the module read's `parts.from_code`:
 *
 *   - Built with: each chosen repository's languages by bytes and its topics,
 *     facts from the connection;
 *   - Proposed from code: each ADR file, and each README or docs section
 *     headed Architecture, Design or Decisions. Accept makes an architecture
 *     note citing the file; Dismiss keeps it away until its text changes.
 *     Nothing is written without Accept;
 *   - Architecture notes: what was accepted, with its file.
 *
 * Repository text is drawn as text. Nothing is drawn when GitHub has brought
 * nothing to this venture.
 */
export default function SolutionDesignFromCode({ part, projectId, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const view = fromCodeView(part);
  if (view.empty) return null;
  const decide = async (id, how) => {
    setBusy(id); setError('');
    try {
      await (how === 'accept' ? cyclesWrite.build.acceptDesignProposal : cyclesWrite.build.dismissDesignProposal)(projectId, id);
      reload?.();
    } catch (e) {
      setError(e?.message || (how === 'accept' ? 'That proposal could not be accepted.' : 'That proposal could not be dismissed.'));
    } finally { setBusy(null); }
  };
  return (
    <section id="from-github" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-from-code" aria-labelledby="from-github-title">
      <h2 id="from-github-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From GitHub</h2>
      {view.state === 'unreadable' ? (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="from-code-unreadable">{view.reason}</p>
      ) : (
        <>
          <BuiltWith stacks={view.builtWith} />
          <Proposals proposals={view.proposals} busy={busy} onDecide={decide} />
          {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="from-code-error">{error}</p>}
          <Notes notes={view.notes} />
        </>
      )}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
const LINK = 'text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300';

function BuiltWith({ stacks }) {
  if (!stacks.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="from-code-built-with">
      <h3 className={SUB}>Built with</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {stacks.map((s) => (
          <li key={s.repository} className="flex flex-col" data-testid={`built-with-${s.repository}`}>
            <span className={FAINT}>{s.repository} · {s.source_label || 'From GitHub'}</span>
            <span className={LINE}>{languagesText(s)}</span>
            {Array.isArray(s.topics) && s.topics.length > 0 && (
              <span className="mt-0.5 flex flex-wrap gap-1">
                {s.topics.map((t) => <span key={t} className="rounded-full bg-axal-ground px-2 py-0.5 text-[11px] text-axal-ink dark:bg-gray-800 dark:text-gray-200">{t}</span>)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Proposals({ proposals, busy, onDecide }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="from-code-proposals">
      <h3 className={SUB}>Proposed from code</h3>
      {proposals.length === 0 ? (
        <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="from-code-proposals-none">Nothing is waiting. Decision records, and README or docs sections headed Architecture, Design or Decisions, appear here after a sync.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {proposals.map((p) => {
            const href = githubHref(p.url);
            return (
              <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`design-proposal-${p.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{p.title}</p>
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>Open the file ↗</a>}
                </div>
                <span className={FAINT}>{p.repository}/{p.path} · Proposed by GitHub</span>
                {p.extract && <p className={LINE}>{p.extract}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={busy != null} onClick={() => onDecide(p.id, 'accept')} data-testid={`design-accept-${p.id}`}
                    className="rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50">{busy === p.id ? 'Saving…' : 'Accept'}</button>
                  <button type="button" disabled={busy != null} onClick={() => onDecide(p.id, 'dismiss')} data-testid={`design-dismiss-${p.id}`}
                    className="rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Dismiss</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Notes({ notes }) {
  if (!notes.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="from-code-notes">
      <h3 className={SUB}>Architecture notes</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {notes.map((n) => {
          const href = githubHref(n.source_url);
          return (
            <li key={n.id} className="flex flex-col border-b border-axal-ground pb-1.5 last:border-b-0 dark:border-gray-800" data-testid={`design-note-${n.id}`}>
              <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{n.title}</span>
              {n.body && <span className={LINE}>{n.body}</span>}
              {(href || n.source_path) && (
                <span className={FAINT}>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{n.source_path || 'The file'} ↗</a> : n.source_path}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
