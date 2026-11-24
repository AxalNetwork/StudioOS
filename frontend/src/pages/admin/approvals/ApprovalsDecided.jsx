/**
 * D5882 (#5882): Decided (D4814), moved out of AdminApprovals.jsx unchanged: the audit trail of what was decided.
 */
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Skeleton } from '../../../ui';
import { HQ_LANES, LANES } from './approvalsModel';
import { OUTCOME_FILTERS, decidedNotes, decidedPageLine, decidedQueryOf, decidedRows } from './inboxModel';
import { aboutHistory, decidedFilterCount, decidedItemPath, noteKind } from './lanesDecidedModel';
import { BTN, BTN_SM, CARD, EYE, FailedCard, H2, MONO, PILL, SELECT, SUB, TD, TH } from './approvalsUi';
import { DressedDoor } from './approvalDoors';

/**
 * Decided (APR10). D4814 (AP-07): an audit trail — filters for lane, outcome,
 * decided by and a date range, and Include HQ lanes (a Super Admin's; shown
 * but off for an Admin); each row when, the request, the outcome, who
 * decided, the wait (a dash when not recorded), whether the person saw the
 * note, and Open ↗ to the page that decides that lane; About this history
 * after the log.
 */
export function Decided({ decided, superAdmin }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const f = decidedQueryOf(loc.search);
  const setParams = (patch) => {
    const p = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('page' in patch)) p.delete('page');
    const s = p.toString();
    navigate({ pathname: '/admin/approvals/decided', search: s ? `?${s}` : '' }, { replace: true });
  };
  const clear = () => setParams({ lane: null, outcome: null, decided_by: null, from: null, to: null, hq: null });
  if (decided.status === 'error') {
    return <FailedCard title="We could not load what was decided." line="The Inbox and each lane’s own page still work." error={decided.error} onRetry={decided.reload} testId="approvals-decided-failed" />;
  }
  const reply = decided.status === 'ready' ? decided.reply : null;
  const rows = decidedRows(reply);
  const notes = decidedNotes(reply);
  const deciders = Array.isArray(reply?.deciders) ? reply.deciders : null;
  const size = Number(reply?.page_size) || 25;
  const more = reply && (reply.total === null || reply.total === undefined ? rows.length === size : f.page * size < reply.total) && f.page < 40;
  const lanes = superAdmin && f.hq !== '0' ? [...LANES, ...HQ_LANES] : LANES;
  const nFilters = decidedFilterCount(f);
  return (
    <div className="flex flex-col gap-3.5" data-testid="approvals-decided">
      <div className="flex flex-col gap-0.5">
        <h2 className={H2}>Decided</h2>
        <p className={`m-0 ${SUB}`}>Recorded admin decisions across approval lanes.</p>
      </div>
      {notes.unreadable.length ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="approvals-decided-unread">{notes.unreadable.join(', ')} could not be read, so {notes.unreadable.length === 1 ? 'its decisions are' : 'their decisions are'} missing below.</p> : null}
      <section className={`${CARD} min-w-0`} aria-label="Decision log">
        <div className="flex flex-wrap items-end gap-3 border-b border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="approvals-decided-filters">
          <label className="flex flex-col gap-1">
            <span className={EYE}>Lane</span>
            <select className={SELECT} value={f.lane || ''} onChange={(e) => setParams({ lane: e.target.value || null })} data-testid="approvals-decided-lane">
              <option value="">All</option>
              {lanes.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={EYE}>Outcome</span>
            <select className={SELECT} value={f.outcome || ''} onChange={(e) => setParams({ outcome: e.target.value || null })} data-testid="approvals-decided-outcome">
              {OUTCOME_FILTERS.map((o) => <option key={o.label} value={o.key || ''}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={EYE}>Decided by</span>
            <select className={SELECT} value={f.decided_by || ''} disabled={!deciders} title={deciders ? undefined : reply?.deciders_reason} onChange={(e) => setParams({ decided_by: e.target.value || null })} data-testid="approvals-decided-by">
              <option value="">Anyone</option>
              {(deciders || []).map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={EYE}>From</span><input type="date" className={SELECT} value={f.from || ''} onChange={(e) => setParams({ from: e.target.value || null })} data-testid="approvals-decided-from" /></label>
          <label className="flex flex-col gap-1"><span className={EYE}>To</span><input type="date" className={SELECT} value={f.to || ''} onChange={(e) => setParams({ to: e.target.value || null })} data-testid="approvals-decided-to" /></label>
          <label className={`ml-auto flex min-h-[44px] items-center gap-2 text-[12.5px] sm:min-h-0 ${superAdmin ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}`}>
            <input type="checkbox" disabled={!superAdmin} checked={superAdmin && f.hq !== '0'} onChange={(e) => setParams({ hq: e.target.checked ? null : '0', ...(f.lane && HQ_LANES.some((l) => l.key === f.lane) ? { lane: null } : {}) })} data-testid="approvals-decided-hq" />
            Include HQ lanes <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${PILL.plain}`}>Super Admin</span>
          </label>
        </div>
        {!reply ? <div className="px-3 py-3"><Skeleton.Table rows={6} cols={6} /></div>
          : rows.length ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                  <th scope="col" className={TH}>Decided ↓</th><th scope="col" className={TH}>Request</th><th scope="col" className={TH}>Outcome</th><th scope="col" className={TH}>Decided by</th><th scope="col" className={`${TH} text-right`}>Wait</th><th scope="col" className={TH}>Note</th><th scope="col" className={TH}><span className="sr-only">Open</span></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const kind = noteKind(r);
                    return (
                      <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`approvals-decided-${r.key}`}>
                        <td className={`${TD} whitespace-nowrap`}><span className={MONO}>{r.when}</span></td>
                        <td className={TD}><b>{r.who}</b><div className={SUB}>{r.lane}</div></td>
                        <td className={TD}><span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${PILL[r.outcome.tone] || PILL.plain}`}>{r.outcome.word}</span></td>
                        <td className={TD}>{r.by}</td>
                        <td className={`${TD} text-right`}>{r.waitKnown ? <span className={MONO}>{r.wait}</span> : <span className={SUB} title="This lane does not record when the item arrived, so the wait is not known." data-testid={`approvals-decided-wait-${r.key}`}>—</span>}</td>
                        <td className={TD} data-testid={`approvals-decided-note-${r.key}`}>
                          {kind === 'none' ? <span className={SUB}>No note</span>
                            : kind === 'shown' ? <>{r.note}<div className={SUB}>👁 Shown to them</div></>
                              : <>{r.note}<div className={SUB}>🔒 Internal note</div></>}
                        </td>
                        <td className={`${TD} text-right`}>
                          {/* D4814 part 6: a native board's row opens the item itself; any other lane opens its own page. */}
                          {decidedItemPath(r) ? <Link to={decidedItemPath(r)} className={BTN_SM} data-testid={`approvals-decided-open-${r.key}`}>Open ↗</Link>
                            : <DressedDoor lane={r.laneKey} before="Open in " after=" ↗" className={BTN_SM} plain={SUB} testId={`approvals-decided-open-${r.key}`} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div role="status" className="flex flex-col items-center gap-2 px-4 py-10 text-center" data-testid="approvals-decided-empty">
              <b className="text-[14px] text-axal-ink dark:text-gray-100">No recorded decisions match these filters.</b>
              {nFilters ? <button type="button" className={BTN} onClick={clear} data-testid="approvals-decided-clear">Clear filters</button> : null}
            </div>
          )}
        {rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-3 py-2 dark:border-gray-700">
            <span className={`${SUB} ${MONO}`} data-testid="approvals-decided-count">{`${decidedPageLine(reply)} · newest first`}</span>
            <div className="flex gap-2">
              <button type="button" className={BTN} disabled={f.page <= 1} onClick={() => setParams({ page: f.page > 2 ? String(f.page - 1) : null })}>Previous</button>
              <button type="button" className={BTN} disabled={!more} onClick={() => setParams({ page: String(f.page + 1) })}>Next</button>
            </div>
          </div>
        ) : null}
      </section>
      {reply && rows.length ? (
        <section className="flex flex-col gap-1.5 rounded-[12px] border border-dashed border-axal-hairline px-4 py-3 dark:border-gray-700" data-testid="approvals-decided-about">
          <h2 className="m-0 text-[13px] font-extrabold text-axal-ink dark:text-gray-100">About this history</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {aboutHistory(notes).map((t) => <li key={t} className={SUB}>{`· ${t}`}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
