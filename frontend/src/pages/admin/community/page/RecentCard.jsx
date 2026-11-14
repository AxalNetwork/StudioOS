/**
 * #4717 package 6 — Recent activity (CM1 row 7): the ten newest, with the kind chips; its own read.
 * Split out of AdminCommunity.jsx; nothing here decides anything.
 */
import React, { useEffect, useState } from 'react';
import { communityApi } from '../../../../lib/api/community';
import { reportError } from '../../../../lib/log';
import { RECENT_ROWS } from '../communityModel';
import { ACTIVITY_KINDS, activityKindCounts, activityPage } from '../lightboxModel';
import { Card, DomainActions, LINK, MONO, SUB, idle } from './parts';
import { Link } from 'react-router-dom';

export const CHIPS = [{ value: '', label: 'All' }, ...ACTIVITY_KINDS];

/** CM1 row 7: the ten newest, with the filter chips. Its own read, so a chip reads again only this card. */
/** D4820 part 2: `rows` is how many it lists (CM09: four on a phone). */
export function RecentCard({ refresh, onOpen, span = 7, rows = RECENT_ROWS }) {
  const [kind, setKind] = useState('');
  const [tick, setTick] = useState(0);
  const [read, setRead] = useState(idle);
  useEffect(() => {
    let live = true;
    setRead(idle);
    communityApi.activity({ limit: rows, ...(kind ? { kind } : {}) }).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (e) => { reportError('admin-community:recent', e); if (live) setRead({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [kind, tick, refresh, rows]);
  const view = read.status === 'ready' ? activityPage(read.data, 1) : null;
  // D4820 part 6 (CM01): each chip carries the read's own count (`by_kind`, sent with no kind chosen), kept for the
  // refresh it was read under, so a count is never stale; Admin actions carries none.
  const scope = `${refresh}|${tick}`;
  const [counts, setCounts] = useState(null);
  if (read.status === 'ready' && !kind && (!counts || counts.data !== read.data)) setCounts({ scope, data: read.data, n: activityKindCounts(read.data) });
  const shown = counts && counts.scope === scope ? counts.n : null;
  const state = read.status === 'loading' ? 'loading' : (read.status === 'error' || view?.state !== 'ready') ? 'unreadable' : 'ready';
  return (
    <Card id="recent" title="Recent activity" span={span} state={state} onRetry={() => setTick((t) => t + 1)}
      reason="Community activity could not be read. That is not the same as nothing happening."
      foot={<DomainActions box="activity" onOpen={onOpen} />}>
      {() => (<>
        <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5" data-testid="community-recent-chips">
          {CHIPS.map((c) => (
            <button key={c.value || 'all'} type="button" aria-pressed={kind === c.value} onClick={() => setKind(c.value)}
              className={`min-h-[32px] max-md:min-h-[44px] rounded-full border px-2.5 py-1 text-[12px] font-bold ${kind === c.value ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}
              data-testid={`community-recent-chip-${c.value || 'all'}`}>
              {c.label}
              {shown && shown[c.value || 'all'] != null ? <span className={`${MONO} ml-1.5 text-[11px]`} data-testid={`community-recent-chip-${c.value || 'all'}-count`}>{shown[c.value || 'all'].toLocaleString('en-US')}</span> : null}
            </button>
          ))}
        </div>
        {view.partial ? <span className="text-[12.5px] text-axal-destructive dark:text-red-400" role="status">{view.partial}</span> : null}
        {view.rows.length ? (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="community-recent">
            {view.rows.slice(0, rows).map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800">
                <span className="flex min-w-0 items-baseline gap-2.5">
                  <span aria-hidden="true" className="font-bold text-axal-violet dark:text-violet-300">{r.icon}</span>
                  {r.href ? <Link to={r.href} className={`${LINK} text-[13px] font-medium leading-[1.45]`}>{r.sentence}</Link> : <span className="text-[13px] font-medium leading-[1.45] text-axal-ink dark:text-gray-100">{r.sentence}</span>}
                </span>
                <span className={`${MONO} whitespace-nowrap text-[12px] text-axal-muted dark:text-gray-400`}>{r.when}</span>
              </li>
            ))}
          </ul>
        ) : <span className={SUB}>{kind ? 'Nothing of this kind has happened yet.' : 'Nothing has happened yet.'}</span>}
      </>)}
    </Card>
  );
}
