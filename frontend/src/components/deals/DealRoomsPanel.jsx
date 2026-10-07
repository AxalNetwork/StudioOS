import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEAL_STAGE_LABEL, dealStage, dealMoneyExact } from '../../lib/dealFlow';
import { STATES } from './dealRoomCopy';
import { Loading, Empty, Unreadable, NotRecorded, StatusPill, INPUT } from './DealRoomKit';
import { useDealroomQuota, QuotaLine, JoinNote, JoinLeaveButton } from './DealRoomJoin';

/**
 * D630 (#1388) — canvas `dr-pipeline`: the deal rooms an investor can join,
 * on `/deals`.
 *
 * WHERE IT LIVES. `/deals` already serves the investor's Deals bucket board
 * (`InvestorDealsRoutes`), so this is a panel under the board rather than a
 * new address. `/deals/pipeline` stays the investor's own work board (only
 * the deals they are invited to or committed on, `scope=mine`); joining is
 * about the deals they are NOT yet in, so this list is the unscoped one, with
 * the Worker's `is_member` deciding Join or Leave.
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

/** The panel's body, from its two reads. Rendered directly by the tests. */
export function DealRoomsList({ dealsState, quotaState, onRetryDeals, onRetryQuota, onChanged }) {
  const [query, setQuery] = useState('');
  const live = useMemo(
    () => (dealsState.deals || []).filter((d) => dealStage(d) !== null),
    [dealsState.deals],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return live;
    return live.filter((d) => `${d.project_name || ''} ${d.project_sector || ''}`.toLowerCase().includes(q));
  }, [live, query]);

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="dr-pipeline">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Deal rooms</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Join a deal room to follow a company in your portfolio and research views, and to open a diligence case on it.
          </p>
        </div>
        <QuotaLine state={quotaState} onRetry={onRetryQuota} />
      </div>
      <div className="mt-2"><JoinNote /></div>

      <div className="mt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies…"
          className={`${INPUT} md:max-w-xs`}
          aria-label="Search companies"
        />
      </div>

      <div className="mt-3">
        {dealsState.loading && !dealsState.deals ? (
          <Loading what="the pipeline" />
        ) : dealsState.error ? (
          <Unreadable onRetry={onRetryDeals}>{STATES.pipeline.unread}</Unreadable>
        ) : visible.length === 0 ? (
          <Empty>{STATES.pipeline.empty}</Empty>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="dr-pipeline-rows">
            {visible.map((d) => {
              const member = Boolean(Number(d.is_member));
              const round = dealMoneyExact(d.target_raise || d.amount);
              return (
                <li key={d.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between" data-testid="dr-pipeline-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/deals/${d.id}`} className="font-semibold text-gray-900 hover:underline dark:text-gray-100">
                        {d.project_name || `Deal #${d.id}`}
                      </Link>
                      <StatusPill tone={dealStage(d) === 'diligence' ? 'violet' : 'grey'}>{DEAL_STAGE_LABEL[dealStage(d)]}</StatusPill>
                      {member && <StatusPill tone="ok" testid="dr-member">Member</StatusPill>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{d.project_sector || 'No sector recorded'}</span>
                      <span aria-hidden="true">·</span>
                      {round ? <span className="font-mono">{round}</span> : <NotRecorded reason={STATES.pipeline.nrRound} />}
                    </div>
                  </div>
                  <JoinLeaveButton dealId={d.id} member={member} quotaState={quotaState} onChanged={onChanged} compact />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
