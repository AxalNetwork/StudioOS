import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEAL_STAGE_LABEL, dealStage, dealMoneyExact } from '../../lib/dealFlow';
import {
  INVITE_STATUS, ROOM_ACCESS_REQUIRED, ROOM_ACCESS_UNREADABLE, ROOM_FILTERS, ROOM_FILTER_EMPTY, STATES,
  roomAccess, roomFilterCounts, roomResult,
} from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, INPUT, BTN } from './DealRoomKit';
import { useDealroomQuota, QuotaLine, JoinNote, JoinLeaveButton } from './DealRoomJoin';

/**
 * D630 (#1388) — canvas `dr-pipeline`: the deal rooms an investor can join.
 *
 * WHERE IT LIVES. At `/deals/rooms`, its own route (D4815, #4815, the owner's
 * pick B on 2026-11-09), linked from Deal flow's "Other deal activity" line.
 * It WAS on `/deals`, collapsed under that line. The shell draws the page's
 * heading ("Deal rooms") and its intro, so the list draws neither.
 *
 * Deal flow's Mine stays the investor's own work board (only the deals they
 * are invited to or committed on, `scope=mine`); joining is about the deals
 * they are NOT yet in, so this list is the unscoped one, with the Worker's
 * `is_member` deciding Join or Leave.
 *
 * THE ROOM VIEW is the deal page, `/deals/:id` (DX4): a row whose access the
 * Worker returned as `can_read: true` opens it, by its name and by Open deal.
 * A refused row offers Request an invitation; an unreadable one, Try again.
 *
 * `is_member` and the quota's `member_deal_ids` both narrow by the active
 * firm; the quota's count is every firm's, because that is what the join
 * refuses on (D630).
 */
export default function DealRoomsPanel() {
  const [dealsState, setDealsState] = useState({ loading: true, error: false, deals: null });
  const [quotaState, reloadQuota] = useDealroomQuota();

  const loadDeals = useCallback(async () => {
    setDealsState((s) => ({ ...s, loading: true, error: false }));
    try {
      const rows = await api.listDeals();
      setDealsState({ loading: false, error: false, deals: Array.isArray(rows) ? rows : [] });
    } catch {
      setDealsState({ loading: false, error: true, deals: null });
    }
  }, []);
  useEffect(() => { loadDeals(); }, [loadDeals]);

  const onChanged = useCallback(async () => { await Promise.all([loadDeals(), reloadQuota()]); }, [loadDeals, reloadQuota]);

  return (
    <DealRoomsList
      dealsState={dealsState}
      quotaState={quotaState}
      onRetryDeals={loadDeals}
      onRetryQuota={reloadQuota}
      onChanged={onChanged}
    />
  );
}

/** The page's body, from its two reads. Rendered directly by the tests. */
export function DealRoomsList({ dealsState, quotaState, onRetryDeals, onRetryQuota, onChanged, initialFilter = 'all' }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [result, setResult] = useState(null);
  const live = useMemo(
    () => (dealsState.deals || []).filter((d) => dealStage(d) !== null),
    [dealsState.deals],
  );
  // Counts only from a list that was read; an unread list has no count, never 0.
  const counts = useMemo(
    () => (dealsState.error || !dealsState.deals ? null : roomFilterCounts(live)),
    [dealsState.error, dealsState.deals, live],
  );
  const view = ROOM_FILTERS.find((f) => f.key === filter) || ROOM_FILTERS[0];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inView = live.filter(view.test);
    if (!q) return inView;
    return inView.filter((d) => `${d.project_name || ''} ${d.project_sector || ''}`.toLowerCase().includes(q));
  }, [live, query, view]);
  const empty = query.trim() || filter === 'all' ? STATES.pipeline.empty : ROOM_FILTER_EMPTY[filter];

  return (
    <section className="flex flex-col gap-3 rounded-[12px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" aria-label="Deal rooms" data-testid="dr-pipeline">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <JoinNote />
        <QuotaLine state={quotaState} onRetry={onRetryQuota} />
      </div>

      {result && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-900 px-3 py-2 text-[13px] text-white dark:bg-gray-100 dark:text-gray-900" role="status" data-testid="dr-result">
          <span>{result}</span>
          <button type="button" className="ml-auto min-h-[44px] underline md:min-h-0" onClick={() => setResult(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Show" data-testid="dr-filters">
          {ROOM_FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold md:min-h-0 md:py-1 ${filter === f.key
                ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200'
                : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-200'}`}
              data-testid={`dr-filter-${f.key}`}>
              {f.label}
              {counts && <span className="font-mono tabular-nums" data-testid={`dr-filter-${f.key}-count`}>{counts[f.key]}</span>}
            </button>
          ))}
        </nav>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies…"
          className={`${INPUT} min-h-[44px] md:min-h-0 md:max-w-xs`}
          aria-label="Search companies"
        />
      </div>

      <div>
        {dealsState.loading && !dealsState.deals ? (
          <Loading what="the pipeline" />
        ) : dealsState.error ? (
          <Unreadable onRetry={onRetryDeals}>{STATES.pipeline.unread}</Unreadable>
        ) : visible.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="dr-pipeline-rows">
            {visible.map((d) => {
              const member = Boolean(Number(d.is_member));
              const access = roomAccess(d);
              const round = dealMoneyExact(d.target_raise || d.amount);
              const name = d.project_name || `Deal #${d.id}`;
              return (
                <li key={d.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between" data-testid="dr-pipeline-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {access === 'open' ? (
                        <Link to={`/deals/${d.id}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">{name}</Link>
                      ) : (
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{name}</span>
                      )}
                      <StatusPill tone={dealStage(d) === 'diligence' ? 'violet' : 'grey'}>{DEAL_STAGE_LABEL[dealStage(d)]}</StatusPill>
                      {member && <StatusPill tone="ok" testid="dr-member">{INVITE_STATUS.requested}</StatusPill>}
                    </div>
                    {access !== 'open' && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" data-testid="dr-access-required">
                      {access === 'refused' ? ROOM_ACCESS_REQUIRED : ROOM_ACCESS_UNREADABLE}
                    </p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{d.project_sector || 'No sector recorded'}</span>
                      <span aria-hidden="true">·</span>
                      {round ? <span className="font-mono">{round}</span> : <NotRecorded reason={STATES.pipeline.nrRound} />}
                    </div>
                  </div>
                  {/* D4815 (canvas DX1b): access that could not be read is not access refused,
                      so it never offers Request an invitation; it offers Try again. A readable
                      room opens the deal page, which is the room view (DX4). */}
                  <div className="flex flex-wrap items-start gap-2 md:justify-end">
                    {access === 'open' && (
                      <Link to={`/deals/${d.id}`} className={`${BTN.primary} min-h-[44px] justify-center md:min-h-0`} data-testid="dr-open">Open deal</Link>
                    )}
                    {access === 'unreadable'
                      ? <button type="button" onClick={onRetryDeals} className="min-h-[44px] rounded-[9px] border border-axal-hairline px-3 text-[13px] font-semibold md:min-h-0 md:py-1.5 dark:border-gray-700" data-testid="dr-access-retry">Try again</button>
                      : (access === 'refused' || member) && (
                        <JoinLeaveButton dealId={d.id} member={member} quotaState={quotaState} onChanged={onChanged} compact
                          onDone={(kind) => setResult(roomResult(kind, name))} />
                      )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
