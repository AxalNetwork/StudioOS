import React, { useState } from 'react';
import { rankRefusal, rankedLine } from '../lib/rankByFit';

/**
 * #3938 (D1478 task 4, part 8): "Rank by fit", the page button for every
 * match-row press (RA11, LE10, IN10, GR17, NE1). `run(query)` is the page's
 * client call; `onRanked(answer)` hands the Worker's `{ rows }` to the page,
 * which reorders its own list with `applyRank` (`lib/rankByFit.js`), and
 * `onRanked(null)` puts it back. Nothing is saved: a ranking is a view of the
 * list the page already shows, and the press is the member's own, charged as
 * a run. `ranked` and `total` are the page's counts for the line below.
 *
 * `needsQuery`: the press refuses without words of the member's own (GR17's
 * need), so the button waits for them.
 */
export default function RankByFit({ run, onRanked, ranked = null, total = 0, label = 'What are you looking for? (optional)', needsQuery = false, testid = 'rank-by-fit' }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const press = async () => {
    setBusy(true); setError('');
    try { onRanked(await run(query.trim())); } catch (e) { setError(rankRefusal(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text" maxLength={300} aria-label={label} placeholder={label} value={query} onChange={(e) => setQuery(e.target.value)}
          className="min-h-[32px] w-56 rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          data-testid={`${testid}-query`}
        />
        <button
          type="button" disabled={busy || (needsQuery && !query.trim())} onClick={press}
          className="inline-flex min-h-[32px] items-center justify-center rounded-lg border border-violet-300 bg-axal-lavender px-3 text-[12px] font-bold text-violet-800 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
          data-testid={`${testid}-run`}
        >{busy ? 'Ranking…' : 'Rank by fit'}</button>
        {ranked != null && (
          <button type="button" className="text-[12px] font-semibold text-axal-muted underline dark:text-gray-400" onClick={() => onRanked(null)} data-testid={`${testid}-clear`}>Usual order</button>
        )}
      </div>
      <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">Eadwyn ranks this list by meaning and writes one line where it can. It is a view: nothing is saved, and each press uses AI tokens.</p>
      {ranked != null && <p className="m-0 text-[12px] font-semibold text-axal-ink dark:text-gray-100" role="status" data-testid={`${testid}-done`}>{rankedLine(ranked, total)}</p>}
      {error && <p className="m-0 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid={`${testid}-error`}>{error}</p>}
    </div>
  );
}
