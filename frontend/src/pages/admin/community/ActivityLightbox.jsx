import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { communityApi } from '../../../lib/api';
import { BoxShell, CTRL, Failed, LINK, MONO, Pager, Reading, SUB, TAG, useBoxRead } from './CommunityLightbox';
import { ACTIVITY_KINDS, ACTIVITY_LINE, activityPage, activityQuery } from './lightboxModel';

/**
 * D934 (#2718) — CM6, Recent activity: D932's read,
 * `GET /api/admin/community/activity`, newest first, 25 rows a page, with the
 * kind, a date range and a title search. The Worker pages and filters, so
 * each change is a new read of one page.
 *
 * No member is named: an admin's act reads "An admin …", a member's reads as
 * the item or as a count, and the Worker sends no account. A source that
 * failed is named and its rows are absent; the others still answer. A row's
 * link opens the item's console.
 */

const blank = { kind: '', from: '', to: '', q: '', page: 1 };

export default function ActivityLightbox({ onClose }) {
  const [state, setState] = useState(blank);
  const query = useMemo(() => activityQuery(state), [state]);
  const dep = JSON.stringify(query);
  const { read, retry } = useBoxRead(() => communityApi.activity(query), 'box-activity', dep);
  const view = useMemo(() => (read.status === 'ready' ? activityPage(read.data, state.page) : null), [read, state.page]);
  const set = (patch) => setState((s) => ({ ...s, ...patch, page: 1 }));
  const id = 'community-box-activity';

  return (
    <BoxShell id={id} title="Recent activity" sub={ACTIVITY_LINE} onClose={onClose}>
      {(phone) => (
        <>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4" data-testid={`${id}-controls`}>
            <input type="search" aria-label="Search by item title" placeholder="Search by item title" value={state.q}
              onChange={(e) => set({ q: e.target.value })} className={`${CTRL} min-w-[180px] flex-1`} data-testid={`${id}-search`} />
            <select aria-label="Kind" value={state.kind} onChange={(e) => set({ kind: e.target.value })} className={CTRL} data-testid={`${id}-filter-kind`}>
              <option value="">Kind: All</option>
              {ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <label className={`${SUB} flex items-center gap-1.5`}>From
              <input type="date" value={state.from} onChange={(e) => set({ from: e.target.value })} className={CTRL} data-testid={`${id}-from`} />
            </label>
            <label className={`${SUB} flex items-center gap-1.5`}>To
              <input type="date" value={state.to} onChange={(e) => set({ to: e.target.value })} className={CTRL} data-testid={`${id}-to`} />
            </label>
          </div>
          {read.status === 'loading' && <Reading id={id} />}
          {(read.status === 'error' || view?.state === 'unreadable') && (
            <Failed id={id} reason="Community activity could not be read. That is not the same as nothing happening." onRetry={retry} />
          )}
          {view?.state === 'ready' && (
            <>
              {view.partial ? <p className="px-5 pt-3 text-[12.5px] text-axal-destructive dark:text-red-400" role="status" data-testid={`${id}-partial`}>{view.partial}</p> : null}
              {view.rows.length ? (
                <ul className="m-0 mt-3 flex list-none flex-col p-0" data-testid={`${id}-rows`}>
                  {view.rows.map((r) => (
                    <li key={r.key} className={`flex ${phone ? 'flex-col' : 'items-baseline justify-between'} gap-1.5 border-t border-axal-hairline px-5 py-2.5 dark:border-gray-800`} data-testid={`${id}-row`}>
                      <span className="flex min-w-0 items-baseline gap-2.5">
                        <span aria-hidden="true" className="font-bold text-axal-violet dark:text-violet-300">{r.icon}</span>
                        {r.href ? <Link to={r.href} className={`${LINK} text-[13px] font-medium leading-[1.45]`}>{r.sentence}</Link> : <span className="text-[13px] font-medium leading-[1.45]">{r.sentence}</span>}
                      </span>
                      <span className={`${MONO} flex items-center gap-2 whitespace-nowrap text-[12px] text-axal-muted dark:text-gray-400`}>
                        {r.lastChange ? <span className={TAG} title="Dated by the item's last change: this act writes no dated record.">Last change</span> : null}
                        {r.when}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className={`${SUB} px-5 py-6`} data-testid={`${id}-empty`}>Nothing matches.</p>}
              <Pager id={id} view={view} none="No activity" note={view.capped} onPage={(page) => setState((s) => ({ ...s, page }))} />
            </>
          )}
        </>
      )}
    </BoxShell>
  );
}
