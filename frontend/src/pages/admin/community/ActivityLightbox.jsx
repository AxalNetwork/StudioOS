import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { communityApi } from '../../../lib/api/community';
import { BoxShell, CTRL, Failed, LINK, MONO, Pager, Reading, SUB, TAG, useBoxRead, MANAGE } from './CommunityLightbox';
import { ACTIVITY_KINDS, ACTIVITY_LINE, activityKindCounts, activityPage, activityQuery, dayHeading } from './lightboxModel';

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
 *
 * D4820 part 5 (#4820, CM08): the kinds are chips with their counts, and the
 * rows are grouped by day with the time first and an Open › link. A chip's
 * count is the read's own `by_kind` for the same dates and search; it is shown
 * only while those match, so a count is never stale, and Admin actions carries
 * none (the read does not count them).
 */

const blank = { kind: '', from: '', to: '', q: '', page: 1 };

const CHIPS = [{ value: '', label: 'All' }, ...ACTIVITY_KINDS];

export default function ActivityLightbox({ onClose, now: at }) {
  const [now] = useState(() => at ?? Date.now());
  const chipRefs = useRef({});
  const [state, setState] = useState(blank);
  const query = useMemo(() => activityQuery(state), [state]);
  const dep = JSON.stringify(query);
  const { read, retry } = useBoxRead(() => communityApi.activity(query), 'box-activity', dep);
  const view = useMemo(() => (read.status === 'ready' ? activityPage(read.data, state.page) : null), [read, state.page]);
  const set = (patch) => setState((s) => ({ ...s, ...patch, page: 1 }));
  const id = 'community-box-activity';
  // The chips' counts come from the last read with no kind chosen, kept with the dates and search it was made for.
  const scope = `${query.from || ''}|${query.to || ''}|${query.q || ''}`;
  const [counts, setCounts] = useState(null);
  if (read.status === 'ready' && !state.kind && (!counts || counts.scope !== scope || counts.data !== read.data)) {
    setCounts({ scope, data: read.data, n: activityKindCounts(read.data) });
  }
  const shown = counts && counts.scope === scope ? counts.n : null;
  const chipKeys = (e) => {
    const i = CHIPS.findIndex((c) => c.value === state.kind);
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % CHIPS.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + CHIPS.length) % CHIPS.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? CHIPS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    set({ kind: CHIPS[to].value });
    chipRefs.current[CHIPS[to].value || 'all']?.focus();
  };

  return (
    <BoxShell id={id} title="Recent activity" sub={ACTIVITY_LINE} onClose={onClose} manage={<Link to="/admin/approvals" className={MANAGE}>Open Approvals →</Link>}>
      {(phone) => (
        <>
          <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5 px-5 pt-4" onKeyDown={chipKeys} data-testid={`${id}-chips`}>
            {CHIPS.map((c) => {
              const n = shown ? shown[c.value || 'all'] : null;
              const on = state.kind === c.value;
              return (
                <button key={c.value || 'all'} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  ref={(el) => { chipRefs.current[c.value || 'all'] = el; }} onClick={() => set({ kind: c.value })} data-testid={`${id}-chip-${c.value || 'all'}`}
                  className={`inline-flex min-h-[32px] max-lg:min-h-[44px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-bold ${on ? 'border-axal-violet bg-axal-lavender text-axal-violet dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-300' : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>
                  {c.label}
                  {n !== null && n !== undefined ? <span className={`${MONO} text-[11px]`} data-testid={`${id}-chip-${c.value || 'all'}-count`}>{n.toLocaleString('en-US')}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3" data-testid={`${id}-controls`}>
            <input type="search" aria-label="Search by item title" placeholder="Search by item title" value={state.q}
              onChange={(e) => set({ q: e.target.value })} className={`${CTRL} min-w-[180px] flex-1`} data-testid={`${id}-search`} />
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
                <div className="mt-3 flex flex-col" data-testid={`${id}-rows`}>
                  {view.groups.map((g) => (
                    <section key={g.day || 'undated'} aria-label={dayHeading(g.day, now)} data-testid={`${id}-day`}>
                      <h3 className="m-0 px-5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-ink dark:text-gray-100">{dayHeading(g.day, now)}</h3>
                      <ul className="m-0 flex list-none flex-col p-0">
                        {g.rows.map((r) => (
                          <li key={r.key} className={`grid ${phone ? 'grid-cols-[56px_minmax(0,1fr)]' : 'grid-cols-[56px_76px_minmax(0,1fr)_auto]'} items-baseline gap-x-2.5 gap-y-1 border-t border-axal-hairline px-5 py-2.5 dark:border-gray-800`} data-testid={`${id}-row`}>
                            <span className={`${MONO} text-[12px] text-axal-muted dark:text-gray-400`} title={r.when}>{r.time}</span>
                            {phone ? null : <span className={TAG}>{r.kind || 'Other'}</span>}
                            <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                              <span aria-hidden="true" className="font-bold text-axal-violet dark:text-violet-300">{r.icon}</span>
                              <span className="text-[13px] font-medium leading-[1.45]">{r.sentence}</span>
                              {r.lastChange ? <span className={TAG} title="Dated by the item's last change: this act writes no dated record.">Last change</span> : null}
                            </span>
                            {r.href ? <Link to={r.href} className={`${LINK} whitespace-nowrap text-[12.5px] ${phone ? 'col-start-2' : ''}`} aria-label={`Open: ${r.sentence}`}>Open ›</Link> : <span />}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : <p className={`${SUB} px-5 py-6`} data-testid={`${id}-empty`}>Nothing matches.</p>}
              <Pager id={id} view={view} none="No activity" note={view.capped} onPage={(page) => setState((s) => ({ ...s, page }))} />
            </>
          )}
        </>
      )}
    </BoxShell>
  );
}
