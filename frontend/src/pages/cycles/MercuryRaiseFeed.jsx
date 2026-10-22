import { useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import { SECTION_LABELS, isEmptyView, mercuryView } from './mercuryRaise';
import ConnectMercury from './ConnectMercury';

/**
 * D840 part 2 (#2347) — a Raise module's "From Mercury" part (`id="from-mercury"`),
 * from the module read's `parts.mercury`, which only the founder's own read
 * carries:
 *
 *   - Measured: the facts a sync wrote (the runway, the spend by category),
 *     each with its source and a Delete that a re-sync never undoes;
 *   - Proposed from Mercury: a mapping, a statement, a SAFE or a credit, each
 *     written to the module only on Accept; Dismiss keeps it away;
 *   - Figures to cite: the narrative's and the deck's, with their source.
 *     They are never typed into the text.
 *
 * Sync reads Mercury again. With no part, nothing is drawn. D882: with no
 * usable sign-in, the part says so with "Connect Mercury" and offers no Sync.
 */
export default function MercuryRaiseFeed({ slug, part, projectId, reload }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [sections, setSections] = useState({});
  if (!part) return null;
  const view = mercuryView(slug, part);
  const run = async (key, fn, fail) => {
    setBusy(key); setError('');
    try { await fn(); reload?.(); } catch (e) { setError(e?.message || fail); } finally { setBusy(null); }
  };
  const w = cyclesWrite.raise;
  const accept = (p) => run(p.id, () => w.acceptMercuryProposal(projectId, p.id, p.kind === 'fund_mapping' ? { section: sections[p.id] ?? p.section ?? null } : null), 'That proposal could not be accepted.');
  return (
    <section id="from-mercury" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-mercury" aria-labelledby="from-mercury-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="from-mercury-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">From Mercury</h2>
        {view.state !== 'connect' && !view.connection && <button type="button" disabled={busy != null} onClick={() => run('sync', () => w.mercurySync(projectId), 'Mercury could not be read.')} data-testid="mercury-sync"
          className="rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">{busy === 'sync' ? 'Reading…' : 'Sync from Mercury'}</button>}
      </div>
      <span className={FAINT}>Your own Mercury, read-only. Only you see this.</span>
      {view.state === 'unreadable' && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mercury-unreadable">Unreadable: {view.reason}</p>}
      {view.state === 'connect' && <ConnectMercury reason={view.reason} connection={view.connection} />}
      {view.state === 'ok' && view.connection && <ConnectMercury reason={view.connection.sentence} connection={view.connection} />}
      {view.state === 'ok' && !view.connection && isEmptyView(view) && <p className={MUTED} data-testid="mercury-empty">Nothing from Mercury yet. Sync to read it.</p>}
      {view.state === 'ok' && view.facts.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="mercury-facts">
          <h3 className={SUB}>Measured</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {view.facts.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2" data-testid={`mercury-fact-${f.id}`}>
                <span className="flex flex-col">
                  <span className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{f.text}</span>
                  <span className={FAINT}>{[f.evidence, f.section, f.source].filter(Boolean).join(' · ')}</span>
                  {f.replaces && <span className={FAINT} data-testid={`mercury-fact-replaces-${f.id}`}>{f.replaces}</span>}
                </span>
                <button type="button" disabled={busy != null} onClick={() => run(`f${f.id}`, () => w.deleteMercuryFact(projectId, f.id), 'That figure could not be deleted.')} data-testid={`mercury-fact-delete-${f.id}`}
                  className="text-[11.5px] font-bold text-axal-muted underline disabled:opacity-50 dark:text-gray-400">Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.state === 'ok' && view.proposals.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="mercury-proposals">
          <h3 className={SUB}>{view.title || 'Proposed from Mercury'}</h3>
          {view.note && <p className={LINE}>{view.note}</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {view.proposals.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`mercury-proposal-${p.id}`}>
                <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{p.text}</p>
                {p.action && <span className={FAINT}>{p.action}</span>}
                {p.kind === 'fund_mapping' && (
                  <label className={FAINT}>Section{' '}
                    <select value={sections[p.id] ?? p.section ?? ''} onChange={(e) => setSections({ ...sections, [p.id]: e.target.value || null })} data-testid={`mercury-section-${p.id}`}
                      className="rounded border border-axal-hairline bg-white px-1 py-0.5 text-[12px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                      <option value="">Choose a section</option>
                      {Object.entries(SECTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" disabled={busy != null} onClick={() => accept(p)} data-testid={`mercury-accept-${p.id}`}
                    className="rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50">{busy === p.id ? 'Saving…' : 'Accept'}</button>
                  <button type="button" disabled={busy != null} onClick={() => run(p.id, () => w.dismissMercuryProposal(projectId, p.id), 'That proposal could not be dismissed.')} data-testid={`mercury-dismiss-${p.id}`}
                    className="rounded-md border border-axal-hairline px-3 py-1 text-[12px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.state === 'ok' && view.figures.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="mercury-figures">
          <h3 className={SUB}>Figures you can cite</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {view.figures.map((f) => (
              <li key={f.key} className={LINE} data-testid={`mercury-figure-${f.key}`}>{f.label}: <strong>{f.value}</strong> <span className={FAINT}>({f.source})</span></li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="mercury-error">{error}</p>}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
