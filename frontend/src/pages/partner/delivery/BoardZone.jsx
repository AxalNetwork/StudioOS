import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { ZoneBody, NoPartnerProfile, StatedLimit, isNoPartnerProfile } from '../kit';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import EngagementLifecycle from './EngagementLifecycle';
import EngagementSheet from './EngagementSheet';
import HealthPill from './HealthPill';
import MyTasks from '../../work/MyTasks.jsx';
import {
  boardCounts, defaultView, matchesView, modeValue, needsAttention, nextAction, primaryAction, progressText,
} from './boardAttention';

/**
 * Delivery · Board — `/delivery/board`, and since D4822 also `/delivery` itself: Board is Delivery's command
 * centre, so the bucket root renders it rather than a directory of the five zones (`PartnerBucketRoutes`).
 *
 * D4822 (#4822, canvas `Delivery v2`, boards DL01, DL01m, DL06, DL07) — ACTION FIRST. Each row answers, in this
 * order: which client, what to do next and why, its health, its progress in its own mode's measure, who owns it,
 * and its mode and value. The reasons are facts from the record (`boardAttention.js`): overdue milestones, open
 * blockers, recorded scope drift, no owner, a health the firm's read rated badly. "Not rated" is drawn dashed and
 * worded, never green, and an unrated row is not attention-worthy for that alone.
 *
 * ONE EMPTY STATE. With no engagement, the five zones used to show five zeros. Board now says the one true
 * thing — no active client work yet — and where it starts: Pipeline → Proposal → Engagement → Delivery.
 *
 * THE SHEET (PD6) opens from a row, keeps the selection in the URL (`?engagement=<uid>`) so a link lands on it,
 * and is built from the same row: no second read, no second data model.
 *
 * WHAT IS UNCHANGED: mode is derived from seats (D395's board), health is the Worker's one `healthFor`, progress is
 * two measures never averaged, a revoked seat stays visible, and the lifecycle and invoice ledger stay below.
 */

/** Board v2's upstream-aware empty state (DL07): one condition, one next step. */
export function DeliveryEmpty() {
  return (
    <section className="rounded-xl border border-[#ececf1] bg-white p-6 dark:border-gray-800 dark:bg-[#111827]" data-testid="delivery-empty">
      <h2 className="text-[18px] font-extrabold text-[#18181b] dark:text-gray-100">No active client work yet</h2>
      <p className="mt-1 text-[14px] text-[#6b6577] dark:text-gray-400">Delivery begins when a proposal is accepted and becomes an engagement.</p>
      <ol className="mt-3 flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[#18181b] dark:text-gray-200" aria-label="How work reaches Delivery">
        {['Pipeline', 'Proposal', 'Engagement', 'Delivery'].map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-[#6b6577]">→</span>}
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <Link to="/pipeline/proposals"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-[#7c3aed] px-4 text-[14px] font-bold text-white hover:bg-[#6d28d9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]">
        Open Pipeline →
      </Link>
      <dl className="mt-5 grid gap-2 text-[14px] sm:grid-cols-2">
        {[
          ['Deliverables', 'Work handed to clients'],
          ['Capacity', 'Team commitments and room'],
          ['Status reports', 'Recurring client updates'],
          ['Health', 'Scope, milestones, blockers and renewal risk'],
        ].map(([zone, what]) => (
          <div key={zone}>
            <dt className="font-semibold text-[#18181b] dark:text-gray-100">{zone}</dt>
            <dd className="text-[#6b6577] dark:text-gray-400">{what}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function NextCell({ row }) {
  const next = nextAction(row);
  return (
    <span className={next?.quiet ? 'text-[#6b6577] dark:text-gray-400' : 'font-semibold text-[#18181b] dark:text-gray-100'}>
      {next?.text}
      {next?.why && <span className="block text-[13px] font-normal text-[#92400e] dark:text-amber-300">{next.why}</span>}
    </span>
  );
}

const notRecorded = <span className="text-[#6b6577] dark:text-gray-400">— Not recorded</span>;
const PRIMARY_BUTTON = 'inline-flex min-h-[44px] items-center rounded-lg bg-[#7c3aed] px-4 text-[14px] font-bold text-white hover:bg-[#6d28d9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7c3aed]';
// The filter table keeps the v1 artboard's labels (`profile_zone_filters` reads that canvas); Board v2 (DL01)
// orders them Attention first and names them as the v2 canvas does, each with its count.
const V2_CHIPS = [['Needs attention', 'attention', 'Attention'], ['All', 'all', 'All'], ['Project', 'project', 'Projects'], ['Embedded', 'embedded', 'Embedded']];

export default function PartnerDeliveryBoardZone() {
  // `error` is a failed FIRST read (the zone's own error state); `refreshError` a failed later read, which keeps the board.
  const [state, setState] = useState({ loading: true, refreshing: false, error: '', refreshError: '', data: null, readAt: null });
  const [view, setView] = useState(null); // null until the first read decides Attention or All
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();
  const tableRef = useRef(null);

  // The first read shows the loading state; a later one keeps the board on screen while it refreshes (D4698).
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: !s.data, refreshing: Boolean(s.data), error: '', refreshError: '' }));
    try {
      const r = await api.getPartnerDeliveryBoard();
      setState({ loading: false, refreshing: false, error: '', refreshError: '', data: r || {}, readAt: new Date() });
    } catch (e) {
      const msg = e?.message || 'The engagement board did not load.';
      setState((s) => (s.data
        ? { ...s, loading: false, refreshing: false, refreshError: msg }
        : { ...s, loading: false, refreshing: false, error: msg }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const items = useMemo(() => (Array.isArray(d?.items) ? d.items : []), [d]);
  const current = view ?? defaultView(items);
  const counts = boardCounts(items);
  const visible = items.filter((row) => matchesView(row, current, query));
  const primary = primaryAction(items);
  const selectedKey = params.get('engagement');
  const selected = selectedKey ? items.find((r) => String(r.engagement_uid || r.engagement_id) === selectedKey) : null;
  const open = (row) => setParams((p) => { const n = new URLSearchParams(p); n.set('engagement', String(row.engagement_uid || row.engagement_id)); return n; });
  const close = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete('engagement'); return n; }), [setParams]);

  const rowActions = partnerZoneActions('delivery/board', { view: { header: ['Client', 'Next action', 'Health', 'Progress', 'Owner', 'Mode', 'Value'], rows: visible, cells: (r) => [r.client, nextAction(r)?.text, r.health || 'not rated', progressText(r), r.owner_name, r.mode, r.price] } });

  // The gate (no partner profile) keeps the zone's own empty state underneath its notice rather than replacing it.
  const unlinked = isNoPartnerProfile(state.error);
  const v1 = partnerZoneFilters('delivery/board', { value: current, onChange: setView });
  const chips = V2_CHIPS.flatMap(([from, key, label]) => {
    const chip = v1.find((c) => c.label === from);
    return chip ? [{ ...chip, label: `${label} · ${counts[key]}` }] : [];
  });

  const reviewAttention = () => {
    setView('attention');
    tableRef.current?.focus();
  };

  return (
    <>
      {/* D1614 W8 (#3994): every task given to me, across my Teams. */}
      <div className="mb-4"><MyTasks licence="partner" testId="delivery-my-tasks" /></div>

      {/* D4822 — one contextual primary action, driven by the record's state. */}
      {!unlinked && !state.loading && primary && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3" data-testid="delivery-primary">
          <p className="text-[14px] text-[#6b6577] dark:text-gray-400">
            {counts.all === 0
              ? 'Delivery starts when work is won in Pipeline.'
              : counts.attention
                ? `${counts.attention} of ${counts.all} engagements need attention.`
                : 'Nothing needs attention right now.'}
          </p>
          {primary.to ? (
            <Link to={primary.to} className={PRIMARY_BUTTON}>{primary.label}{primary.key === 'pipeline' ? ' →' : ''}</Link>
          ) : (
            <button type="button" onClick={reviewAttention} className={PRIMARY_BUTTON}>{primary.label}</button>
          )}
        </div>
      )}

      {/* The header row also draws for an account with no firm (its actions, never its chips); an empty workspace
          has nothing to filter, so it shows only the one empty state. */}
      {(items.length > 0 || unlinked) && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <ZoneToolbar className="flex-1" role="partner" filters={unlinked ? [] : chips} actions={rowActions} />
          <label className="flex items-center gap-2 text-[14px] text-[#6b6577] dark:text-gray-400">
            <span className="sr-only">Find a client</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a client"
              className="min-h-[40px] rounded-lg border border-[#ececf1] bg-white px-3 text-[14px] text-[#18181b] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </label>
          <span className="text-[13px] text-[#6b6577] dark:text-gray-400" aria-live="polite">
            {state.refreshing ? 'Refreshing…' : state.readAt ? `Read ${state.readAt.toTimeString().slice(0, 5)}` : ''}
            {' '}<button type="button" onClick={load} disabled={state.refreshing} className="font-semibold text-[#7c3aed] underline-offset-2 hover:underline disabled:opacity-60 dark:text-[#a78bfa]">Refresh</button>
          </span>
        </div>
      )}

      {/* A refresh that fails keeps the last read on screen and says so (D4698): the board is not blanked. */}
      {state.refreshError && (
        <p role="alert" className="mb-3 text-[14px] text-[#b91c1c] dark:text-red-300">
          The board could not be refreshed; this is the last read.{' '}
          <button type="button" onClick={load} className="font-semibold underline">Retry</button>
        </p>
      )}
      <ZoneBody
        loading={state.loading}
        error={unlinked ? null : state.error}
        onRetry={load}
        notice={unlinked ? <NoPartnerProfile /> : null}
        isEmpty={unlinked || items.length === 0}
        empty={<DeliveryEmpty />}
      >
        <div className="space-y-5">
          {/* Desktop: a semantic table. */}
          <div ref={tableRef} tabIndex={-1} className="hidden overflow-hidden rounded-xl border border-[#ececf1] bg-white outline-none dark:border-gray-800 dark:bg-[#111827] md:block" data-testid="delivery-board">
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">{current === 'attention' ? 'Engagements that need attention' : 'Engagements'}</caption>
              <thead className="border-b border-[#ececf1] text-[12px] font-bold uppercase tracking-[0.06em] text-[#6b6577] dark:border-gray-800 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Client</th>
                  <th scope="col" className="px-4 py-2.5">Next action · why</th>
                  <th scope="col" className="px-4 py-2.5">Health</th>
                  <th scope="col" className="px-4 py-2.5">Progress</th>
                  <th scope="col" className="px-4 py-2.5">Owner</th>
                  <th scope="col" className="px-4 py-2.5">Mode · value</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.engagement_id} className={`border-t border-[#ececf1] align-top dark:border-gray-800 ${r.seat_state === 'revoked' ? 'opacity-60' : ''} ${selected === r ? 'bg-[#f4f0fe] dark:bg-violet-950/30' : ''}`} data-attention={needsAttention(r) ? 'yes' : 'no'}>
                    <th scope="row" className="px-4 py-3 font-bold">
                      <button type="button" onClick={() => open(r)} className="text-left text-[#18181b] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c3aed] dark:text-gray-100">
                        {r.client || 'Client not recorded'}
                      </button>
                    </th>
                    <td className="px-4 py-3"><NextCell row={r} /></td>
                    <td className="px-4 py-3"><HealthPill health={r.health} /></td>
                    <td className="px-4 py-3 font-mono tabular-nums">{progressText(r) || notRecorded}</td>
                    <td className="px-4 py-3">{r.owner_name || notRecorded}</td>
                    <td className="px-4 py-3 text-[13px] text-[#6b6577] dark:text-gray-400">{modeValue(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {current === 'attention' && counts.all > counts.attention && (
              <div className="flex items-center justify-between border-t border-[#ececf1] px-4 py-2.5 text-[13px] text-[#6b6577] dark:border-gray-800 dark:text-gray-400">
                <span>{counts.attention} of {counts.all} engagements need attention</span>
                <button type="button" onClick={() => setView('all')} className="font-semibold text-[#7c3aed] hover:underline dark:text-[#a78bfa]">Show all {counts.all}</button>
              </div>
            )}
          </div>

          {/* Phone: one card per engagement, next action before the metrics (DL01m). */}
          <div className="grid gap-3 md:hidden" data-testid="delivery-board-cards">
            {visible.map((r) => (
              <article key={r.engagement_id} className="rounded-xl border border-[#ececf1] bg-white p-4 dark:border-gray-800 dark:bg-[#111827]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[16px] font-bold text-[#18181b] dark:text-gray-100">{r.client || 'Client not recorded'}</h3>
                  <HealthPill health={r.health} />
                </div>
                <p className="mt-1 text-[13px] text-[#6b6577] dark:text-gray-400">{modeValue(r)}</p>
                <p className="mt-1 font-mono text-[14px] tabular-nums text-[#18181b] dark:text-gray-200">{progressText(r) || 'Progress not recorded'}</p>
                <p className="mt-1 text-[14px]"><NextCell row={r} /></p>
                <button type="button" onClick={() => open(r)} className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-[#ececf1] text-[14px] font-semibold text-[#18181b] dark:border-gray-700 dark:text-gray-100">
                  Open engagement
                </button>
              </article>
            ))}
          </div>

          {visible.length === 0 && (
            <p className="text-[14px] text-[#6b6577] dark:text-gray-400">
              {current === 'attention' && !query ? 'Nothing needs attention.' : 'No engagement matches.'} {counts.all} on the board in total.
            </p>
          )}

          <p className="text-[13px] text-[#6b6577] dark:text-gray-400">
            Not rated is not On track: an engagement with nothing recorded against it has no health yet. Rows open the engagement sheet.
          </p>

          <StatedLimit title="What this board does not claim">
            <p>Health is read from milestones, blockers, deliverables and retained hours; with none of those an engagement is not rated. Whether a client opened a deliverable is not tracked, and no reporting cadence is stored, so nothing here calls a report late.</p>
          </StatedLimit>

          {/* D395 — the lifecycle and the invoice ledger, over every row the board read. */}
          <EngagementLifecycle rows={items} onChanged={load} />

          <ZoneDraft
            surface="delivery/board"
            railOption="draft:board-read"
            label="Draft · board read"
            accept="Accept draft"
            run="Read the board"
            foot="Traces to engagement rows."
            empty="Which engagements carry risk and why — separating a client-facing problem from a capacity one, because the second is solved by adding people and the first is not."
            nothingToDraft="No engagement is on the board yet, so there is nothing to read."
          />
        </div>
      </ZoneBody>

      {selected && <EngagementSheet row={selected} onClose={close} />}
    </>
  );
}
