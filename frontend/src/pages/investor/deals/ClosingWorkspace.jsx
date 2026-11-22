// D6866 (#6866, canvas D6158 DX17 to DX26): one deal's closing workspace at /deals/closing?deal=<id> — Checklist, Paper, Conditions, Transfer and Audit tabs.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { closingsApi } from '../../../lib/api/closings';
import { dealStaffApi } from '../../../lib/api/dealStaff';
import { dealClosingHistoryApi } from '../../../lib/api/dealClosingHistory';
import { formatMinor } from '../../../lib/money';
import {
  LOADING, UNREADABLE, ok, UNAVAILABLE_WORD, DISCLAIMER,
  itemStatus, itemOwner, checklistSummary, paperRows, conditionRows,
  transferHold, transferRows, auditRows, closeRules, workspaceTabs, itemPatch,
  phoneCell, portfolioRows, companyHref,
} from './closingWorkspaceModel';

/**
 * THE WORKSPACE IS A VIEW OF READS THAT ALREADY EXIST. Every tab reads a
 * route main serves, each scoped at the route: the checklist and its history
 * (D6156), the deal's transfers and the transfer gate (D1155), the
 * decision-scoped conditions (D461), the signing archive and the closing
 * record (D1215). A read that fails says Unavailable in its own tab and
 * leaves the others standing; it is never 0 and never "nothing holds it".
 *
 * WHO ACTS. An Admin records transfers and reads the Audit tab; the round's
 * lead (role partner, the route's canMoveRound) or an Admin edits the
 * checklist; an investor reads, has no Audit tab and acts nowhere here.
 */

const today = () => new Date().toISOString().slice(0, 10);

const TONE = {
  done: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  executed: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  met: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  overdue: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  partly: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  blocked: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  rejected: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
  open: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
};
const NEUTRAL = 'border-gray-300 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';

/** A status as a word and a glyph, never colour alone. */
export function StatusWord({ status, testid }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[status.key] || NEUTRAL}`} data-testid={testid}>
      <i aria-hidden="true" className="not-italic">{status.glyph}</i>{status.word}
    </span>
  );
}

const NotRecorded = () => <span className="text-gray-500 dark:text-gray-400">Not recorded</span>;

function Unavailable({ what, onRetry, testid }) {
  return (
    <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300" role="alert" data-testid={testid}>
      {UNAVAILABLE_WORD}: {what} could not be read. That is not a claim that there is none.
      <button type="button" onClick={onRetry} className="ml-1 inline-flex min-h-[44px] items-center underline md:min-h-0">Try again</button>
    </p>
  );
}

const Reading = ({ testid }) => <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid={testid}>Reading…</p>;

const TH = 'border-b border-axal-hairline px-2 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400';
const TD = 'border-b border-axal-hairline px-2 py-2 align-top text-[12.5px] text-axal-ink dark:border-gray-800 dark:text-gray-200';

/**
 * An amount in its currency, through money.js. A transfer row carries no
 * currency of its own, so it takes the closing's, then the deal's; with
 * neither, the amount is not printed in a guessed currency.
 */
function money(cents, currency) {
  const s = currency ? formatMinor(cents, currency) : null;
  return s || 'Amount recorded, currency not recorded';
}

export default function ClosingWorkspace({ dealId, deal, user, onBack, onRecordTransfer }) {
  const role = user?.role;
  const investor = role === 'investor';
  const isAdmin = role === 'admin';
  const canEditChecklist = isAdmin || role === 'partner';
  const [tab, setTab] = useState('checklist');
  const [reads, setReads] = useState({ checklist: LOADING, envelopes: LOADING, conditions: LOADING, transfers: LOADING, gate: LOADING, events: LOADING, closing: LOADING });
  const [sheet, setSheet] = useState(null);
  const [auditFilter, setAuditFilter] = useState('All');

  const put = (k, v) => setReads((r) => ({ ...r, [k]: v }));
  const load = useCallback(() => {
    setReads({ checklist: LOADING, envelopes: LOADING, conditions: LOADING, transfers: LOADING, gate: LOADING, events: LOADING, closing: LOADING });
    api.dealClosingChecklist(dealId).then((r) => put('checklist', ok(r?.checklist || null)), () => put('checklist', UNREADABLE));
    api.esignList().then((r) => put('envelopes', ok(r?.envelopes || [])), () => put('envelopes', UNREADABLE));
    // Every status, so Met and Waived follow the open ones (DX18).
    api.icConditions().then((r) => put('conditions', ok(Array.isArray(r?.items) ? r.items : [])), () => put('conditions', UNREADABLE));
    api.dealTransfers(dealId).then((r) => put('transfers', ok(Array.isArray(r?.items) ? r.items : [])), () => put('transfers', UNREADABLE));
    // The gate is an Admin's read; anyone else is refused before it is asked.
    if (isAdmin) dealStaffApi.transferGate(dealId).then((r) => put('gate', ok(r || {})), () => put('gate', UNREADABLE));
    if (!investor) dealClosingHistoryApi.events(dealId).then((r) => put('events', ok(Array.isArray(r?.events) ? r.events : [])), () => put('events', UNREADABLE));
    closingsApi.list().then(async (r) => {
      const rows = Array.isArray(r?.closings) ? r.closings : Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
      const mine = rows.find((x) => Number(x.deal_id) === Number(dealId));
      if (!mine) return put('closing', ok(null));
      try { put('closing', ok(await closingsApi.read(mine.uid))); } catch { put('closing', UNREADABLE); }
    }, () => put('closing', UNREADABLE));
  }, [dealId, isAdmin, investor]);
  useEffect(() => { load(); }, [load]);

  const day = today();
  const checklist = useMemo(() => checklistSummary(reads.checklist, day), [reads.checklist, day]);
  const paper = useMemo(() => paperRows(reads.envelopes, dealId), [reads.envelopes, dealId]);
  const conditions = useMemo(() => conditionRows(reads.conditions, dealId), [reads.conditions, dealId]);
  const transfers = useMemo(() => transferRows(reads.transfers), [reads.transfers]);
  const hold = useMemo(() => transferHold(reads.gate, isAdmin), [reads.gate, isAdmin]);
  const closingRec = reads.closing.state === 'ready' ? reads.closing.value : null;
  const currency = closingRec?.currency || deal?.currency || null;
  const tabs = workspaceTabs({ investor, checklist, paper, conditions, transfers });
  const audit = useMemo(() => auditRows({ events: reads.events, transfers, paper, closing: reads.closing }), [reads.events, transfers, paper, reads.closing]);
  const rules = useMemo(() => closeRules(closingRec), [closingRec]);
  // D6889 (DX23 A): after close, each received line In Portfolio or not. Only
  // an admin's read carries the position, so only an admin reads the
  // positions list to find the venture's Portfolio page for the link.
  const portfolio = useMemo(() => portfolioRows(closingRec), [closingRec]);
  const [company, setCompany] = useState(LOADING);
  const needsCompany = isAdmin && portfolio.state === 'ready' && portfolio.rows.some((r) => r.positionUid);
  const projectId = closingRec?.project_id;
  useEffect(() => {
    if (!needsCompany) return undefined;
    let alive = true;
    setCompany(LOADING);
    api.positionsList().then((r) => { if (alive) setCompany(ok(companyHref(r, projectId))); }, () => { if (alive) setCompany(UNREADABLE); });
    return () => { alive = false; };
  }, [needsCompany, projectId]);
  const items = reads.checklist.state === 'ready' && reads.checklist.value ? reads.checklist.value.items || [] : [];
  const title = deal?.project_name || `Deal #${dealId}`;

  return (
    <section className="space-y-4" data-testid="closing-workspace" aria-label={`Closing workspace · ${title}`}>
      <button type="button" onClick={onBack} className="min-h-[44px] text-[12px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300 md:min-h-0" data-testid="closing-workspace-back">‹ Deals at closing</button>
      <header className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Closing workspace{investor ? ' · read only' : ''}</p>
        <h2 className="text-[19px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100" data-testid="closing-workspace-title">
          {title}{closingRec?.round_label ? ` · ${closingRec.round_label}` : ''}{closingRec?.instrument ? ` · ${closingRec.instrument}` : ''}
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-3" data-testid="closing-workspace-facts">
          <div><dt className="text-gray-500 dark:text-gray-400">Deadline</dt><dd>{closingRec?.deadline ? <span className="font-mono">{closingRec.deadline}</span> : <NotRecorded />}</dd></div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">{investor ? 'Round total' : 'Total committed'}</dt>
            <dd data-testid="closing-workspace-total">
              {reads.closing.state === 'unreadable' ? UNAVAILABLE_WORD
                : closingRec ? <><b className="font-mono">{money(closingRec.total_cents, currency)}</b> across {closingRec.line_count} line{closingRec.line_count === 1 ? '' : 's'}, withdrawn not counted</>
                  : reads.closing.state === 'loading' ? 'Reading…' : <span className="text-gray-500 dark:text-gray-400">No closing record is open on this deal</span>}
            </dd>
          </div>
          {investor && closingRec && Array.isArray(closingRec.lines) && closingRec.lines[0] ? (
            <div><dt className="text-gray-500 dark:text-gray-400">Your line</dt><dd><b className="font-mono">{money(Number(closingRec.lines[0].amount_cents) || 0, currency)}</b> · {closingRec.lines[0].status}</dd></div>
          ) : null}
        </dl>
        <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-800" role="tablist" aria-label="Closing workspace" data-testid="closing-workspace-tabs">
          {tabs.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              data-testid={`closing-tab-${t.key}`}
              className={`min-h-[44px] whitespace-nowrap border-b-2 px-3 text-[12.5px] font-semibold md:min-h-[36px] ${tab === t.key ? 'border-axal-violet-deep text-axal-ink dark:border-violet-300 dark:text-gray-100' : 'border-transparent text-gray-500 hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            >
              {t.label}{t.count ? <span className="ml-1.5 font-mono text-[11px] text-gray-500 dark:text-gray-400">{t.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="pt-4" role="tabpanel">
          {tab === 'checklist' && (
            checklist.state === 'loading' ? <Reading testid="checklist-loading" />
              : checklist.state === 'unreadable' ? <Unavailable what="The checklist" onRetry={load} testid="checklist-unavailable" />
                : checklist.state === 'none' ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="checklist-none">No checklist is applied to this deal yet. {canEditChecklist ? 'Apply a closing template from the list of deals at closing.' : 'The round’s lead applies one.'}</p>
                  : checklist.state === 'empty' ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="checklist-empty">The checklist is applied and has no items yet.</p>
                    : (
                      <div className="space-y-3">
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-700 dark:text-gray-300" data-testid="checklist-summary">
                          <span><b className="font-mono">{checklist.done}</b> of {checklist.total} items done</span>
                          <span><b className="font-mono">{checklist.pending + checklist.overdue}</b> pending{checklist.overdue ? `, ${checklist.overdue} of them overdue` : ''}</span>
                          <span><b className="font-mono">{checklist.blocked}</b> blocked</span>
                          <span><b className="font-mono">{checklist.skipped}</b> skipped</span>
                        </p>
                        {!canEditChecklist ? <p className="text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="checklist-read-only">Only the round’s lead or an Admin changes the checklist.</p> : null}
                        <div className="flex flex-col gap-4 lg:flex-row">
                          <div className="min-w-0 flex-1 overflow-x-auto">
                            <table className="w-full border-collapse" data-testid="checklist-table">
                              <thead><tr><th className={TH}>Item</th><th className={TH}>Status</th><th className={TH}>Owner</th><th className={TH}>Due</th><th className={`${TH} hidden md:table-cell`}>Done by</th></tr></thead>
                              <tbody>
                                {items.map((i) => {
                                  const st = itemStatus(i, day);
                                  return (
                                    <tr key={i.uid} className={sheet?.uid === i.uid ? 'bg-violet-50/60 dark:bg-violet-950/30' : ''}>
                                      <td className={TD}>
                                        {canEditChecklist
                                          ? <button type="button" className={`min-h-[44px] text-left font-semibold underline-offset-2 hover:underline md:min-h-0 ${i.state === 'skipped' ? 'line-through' : ''}`} onClick={() => setSheet({ uid: i.uid, state: i.state, owner: itemOwner(i) || '', due: String(i.due_date || '').slice(0, 10), note: i.note || '', busy: false, error: '' })} data-testid={`checklist-item-${i.uid}`}>{i.label}</button>
                                          : <b className={i.state === 'skipped' ? 'line-through' : ''}>{i.label}</b>}
                                        {i.note ? <div className="text-[11px] text-gray-600 dark:text-gray-400">{i.note}</div> : null}
                                      </td>
                                      <td className={TD}><StatusWord status={st} testid={`checklist-status-${i.uid}`} /></td>
                                      <td className={TD}>{itemOwner(i) || <NotRecorded />}</td>
                                      <td className={TD}>{i.due_date ? <span className="font-mono">{String(i.due_date).slice(0, 10)}</span> : <NotRecorded />}</td>
                                      <td className={`${TD} hidden md:table-cell`}>{i.done_by_name ? `${i.done_by_name} · ${String(i.done_at || '').slice(0, 10)}` : '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {sheet ? <ItemSheet dealId={dealId} item={items.find((i) => i.uid === sheet.uid)} sheet={sheet} setSheet={setSheet} onSaved={(list) => { put('checklist', ok(list)); setSheet(null); }} /> : null}
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">Overdue: a due date passed while Pending. Skipped items keep their reason in the note.</p>
                      </div>
                    )
          )}

          {tab === 'paper' && (
            paper.state === 'loading' ? <Reading testid="paper-loading" />
              : paper.state === 'unreadable' ? <Unavailable what="The signing archive" onRetry={load} testid="paper-unavailable" />
                : paper.rows.length === 0 ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="paper-empty">No envelope on this deal{investor ? ' is yours to read' : ''} yet.</p>
                  : (
                    <div className="space-y-3">
                      <p className="flex flex-wrap gap-x-4 text-[12px] text-gray-700 dark:text-gray-300" data-testid="paper-summary">
                        <span><b className="font-mono">{paper.executed}</b> of {paper.rows.length} envelopes executed</span>
                        {paper.partly ? <span><b className="font-mono">{paper.partly}</b> partly signed</span> : null}
                        {paper.voided || paper.rejected ? <span><b className="font-mono">{paper.voided}</b> voided · <b className="font-mono">{paper.rejected}</b> rejected</span> : null}
                        <span className="text-gray-500 dark:text-gray-400">{investor ? 'You see your own paper.' : 'Signatures are counted per envelope.'}</span>
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse" data-testid="paper-table">
                          <thead><tr><th className={TH}>Document</th><th className={TH}>State</th><th className={TH}>Signatures</th><th className={TH}>Sent</th><th className={TH}>Executed</th></tr></thead>
                          <tbody>{paper.rows.map((r) => (
                            <tr key={r.id}>
                              <td className={TD}><b>{r.title}</b>{r.type && r.type !== r.title ? <div className="text-[11px] text-gray-500 dark:text-gray-400">{r.type}</div> : null}</td>
                              <td className={TD}><StatusWord status={r.status} testid={`paper-status-${r.id}`} /></td>
                              <td className={`${TD} font-mono`}>{r.signatures || <NotRecorded />}</td>
                              <td className={`${TD} font-mono`}>{r.sent || <NotRecorded />}</td>
                              <td className={TD}>{r.executed ? <span className="font-mono">{r.executed}</span> : <span className="text-gray-500 dark:text-gray-400">Not yet executed</span>}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </div>
                  )
          )}

          {tab === 'conditions' && (
            conditions.state === 'loading' ? <Reading testid="conditions-loading" />
              : conditions.state === 'unreadable' ? <Unavailable what="The conditions" onRetry={load} testid="conditions-unavailable" />
                : (
                  <div className="space-y-3">
                    {conditions.open > 0 ? (
                      <div className="flex flex-col gap-2 rounded-[10px] border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/25 md:flex-row md:items-center" role="status" data-testid="conditions-hold">
                        <span aria-hidden="true" className="font-mono text-lg">‖</span>
                        <div className="flex-1"><b className="text-[13px]">{conditions.open} open condition{conditions.open === 1 ? ' holds' : 's hold'} every transfer on this deal.</b><div className="text-[11.5px] text-gray-700 dark:text-gray-300">Meet or waive {conditions.open === 1 ? 'it' : 'them'} in the Investment committee.</div></div>
                        {!investor ? <a href="/deals/commit" className="inline-flex min-h-[44px] items-center rounded-[7px] bg-axal-violet-deep px-4 text-[12px] font-bold text-white hover:bg-axal-violet dark:bg-violet-500 dark:hover:bg-violet-400 md:min-h-[32px]" data-testid="conditions-open-ic">Open in Investment committee</a> : null}
                      </div>
                    ) : null}
                    {conditions.rows.length === 0 ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="conditions-empty">No condition {investor ? 'you may see ' : ''}is recorded on this deal.</p> : (
                      <>
                        <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400" data-testid="conditions-groups">Open · {conditions.open} · then Met · {conditions.met} · Waived · {conditions.waived}</p>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse" data-testid="conditions-table">
                            <thead><tr><th className={TH}>Condition</th><th className={TH}>Decision</th><th className={TH}>Status</th><th className={TH}>Owner</th><th className={TH}>Raised by</th><th className={TH}>Resolved</th></tr></thead>
                            <tbody>{conditions.rows.map((r) => (
                              <tr key={r.uid} data-testid={`condition-${r.uid}`}>
                                <td className={TD}><b>{r.body}</b></td>
                                <td className={TD}>{r.decision || <NotRecorded />}</td>
                                <td className={TD}><StatusWord status={r.status} /></td>
                                <td className={TD}>{r.owner || <NotRecorded />}</td>
                                <td className={TD}>{r.raisedBy || <NotRecorded />}</td>
                                <td className={TD}>{r.resolvedBy ? `${r.resolvedBy} · ${r.resolvedAt || ''}` : <span className="text-gray-500 dark:text-gray-400">Not resolved</span>}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      </>
                    )}
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">Read only here. Mark met, waive and add conditions in the Investment committee.</p>
                  </div>
                )
          )}

          {tab === 'transfer' && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-testid="transfer-bar">
                <p className="text-[12px] text-gray-700 dark:text-gray-300" data-testid="transfer-disclaimer">{DISCLAIMER}</p>
                {hold.state === 'refused' ? <p className="text-[12px] text-gray-600 dark:text-gray-400" data-testid="transfer-refused">{hold.reason}</p> : (
                  <div className="flex flex-col items-start gap-1 md:items-end">
                    <button
                      type="button"
                      disabled={!hold.enabled}
                      aria-describedby={hold.enabled ? undefined : 'transfer-hold-reason'}
                      onClick={() => hold.enabled && onRecordTransfer && onRecordTransfer(dealId)}
                      data-testid="button-record-transfer"
                      className="min-h-[44px] rounded-[7px] bg-axal-violet-deep px-4 text-[12px] font-bold text-white hover:bg-axal-violet disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400 md:min-h-[32px]"
                    >Record transfer</button>
                    {hold.reason ? (
                      <span id="transfer-hold-reason" className="text-[11.5px] text-gray-700 dark:text-gray-300" data-testid={`transfer-hold-${hold.state}`}>
                        <b>{hold.reason}</b>
                        {hold.retry ? <button type="button" onClick={load} className="ml-1 underline">Try again</button> : null}
                        {hold.state === 'held' ? <button type="button" onClick={() => setTab('conditions')} className="ml-1 underline">See conditions</button> : null}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
              {transfers.state === 'loading' ? <Reading testid="transfers-loading" />
                : transfers.state === 'unreadable' ? <Unavailable what="The transfers" onRetry={load} testid="transfers-unavailable" />
                  : transfers.rows.length === 0 ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="transfers-empty">No transfer is recorded on this deal yet.</p>
                    : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse" data-testid="transfers-table">
                            <thead><tr><th className={TH}>Amount</th><th className={TH}>Reference</th><th className={TH}>Phone verified</th><th className={TH}>Recorded by</th><th className={TH}>Date</th><th className={TH}>Firm</th><th className={TH}>Note</th></tr></thead>
                            <tbody>{transfers.rows.map((t) => (
                              <tr key={t.uid}>
                                <td className={`${TD} font-mono`}>{money(t.cents, currency)}</td>
                                <td className={TD}>{t.reference ? <span className="font-mono">{t.reference}</span> : <NotRecorded />}</td>
                                <td className={TD} data-testid={`transfer-phone-${t.uid}`}>
                                  <StatusWord status={phoneCell(t)} />
                                  {t.phoneVerified ? <div className={`mt-0.5 text-[11px] ${t.phoneVerifiedBy ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>by {phoneCell(t).by}</div> : null}
                                </td>
                                <td className={TD}>{t.recordedBy || <NotRecorded />}</td>
                                <td className={`${TD} font-mono`}>{t.at || <NotRecorded />}</td>
                                <td className={TD}>{t.firm || <NotRecorded />}</td>
                                <td className={TD}>{t.note || <NotRecorded />}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                        <p className="text-[12px] text-gray-700 dark:text-gray-300" data-testid="transfers-total"><b className="font-mono">{transfers.count}</b> transfer{transfers.count === 1 ? '' : 's'} recorded · <b className="font-mono">{money(transfers.totalCents, currency)}</b>{currency ? ` in ${currency}` : ''}, all time on this deal</p>
                      </>
                    )}
            </div>
          )}

          {tab === 'audit' && !investor && (
            <div className="space-y-3" data-testid="audit-panel">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter">
                {['All', 'Checklist', 'Paper', 'Transfers', 'Closing'].map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={auditFilter === k} onClick={() => setAuditFilter(k)} data-testid={`audit-filter-${k}`}
                    className={`min-h-[36px] rounded-full border px-3 text-[11.5px] ${auditFilter === k ? 'border-violet-300 bg-violet-50 font-bold text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200' : NEUTRAL}`}>
                    {k}<span className="ml-1 font-mono text-gray-500">{audit.counts[k]}</span>
                  </button>
                ))}
              </div>
              {audit.unavailable.length ? <p className="text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="audit-partial">{UNAVAILABLE_WORD}: {audit.unavailable.join(', ')}. The rows below are partial.</p> : null}
              <ol className="space-y-1.5" data-testid="audit-list">
                {audit.rows.filter((r) => auditFilter === 'All' || r.kind === auditFilter).map((r, i) => (
                  <li key={i} className="grid grid-cols-1 gap-1 rounded-[8px] border border-axal-hairline p-2 text-[12px] dark:border-gray-800 md:grid-cols-[150px_90px_1fr_160px]">
                    <time className="font-mono text-gray-600 dark:text-gray-400">{String(r.at).slice(0, 16).replace('T', ' ')}</time>
                    <span className="font-semibold">{r.kind}</span>
                    <span>{r.what}{r.cents !== undefined ? ` · ${money(r.cents, currency)}` : ''}</span>
                    <span>{r.who || <span className="text-gray-500 dark:text-gray-400">{r.whoNote}</span>}</span>
                  </li>
                ))}
              </ol>
              {audit.rows.length === 0 && !audit.unavailable.length ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="audit-empty">Nothing is recorded on this deal yet.</p> : null}
            </div>
          )}
        </div>
      </header>

      {!investor && (
        <section className="rounded-[10px] border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900" data-testid="close-rules">
          <h3 className="text-[14px] font-extrabold text-axal-ink dark:text-gray-100">Close the closing</h3>
          {reads.closing.state === 'loading' ? <Reading testid="close-rules-loading" />
            : reads.closing.state === 'unreadable' ? <Unavailable what="The closing record" onRetry={load} testid="close-rules-unavailable" />
              : rules.state === 'none' ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="close-rules-none">No closing record is open on this deal, so there is nothing to close yet.</p>
                : rules.state === 'closed' ? (
                  <>
                    <p className="text-[12.5px]" data-testid="close-rules-closed"><StatusWord status={{ key: 'done', word: `Closed${rules.closedAt ? ` ${rules.closedAt}` : ''}`, glyph: '✓' }} /> Checklist, Paper, Conditions, Transfer and Audit stay readable.</p>
                    {portfolio.state === 'ready' ? <PortfolioTable portfolio={portfolio} isAdmin={isAdmin} company={company} currency={currency} /> : null}
                  </>
                )
                  : (
                    <>
                      <ul className="mt-2 space-y-1.5" id="close-rules-list">
                        {rules.rules.map((r) => (
                          <li key={r.key} className="flex gap-2 text-[12.5px]" data-testid={`close-rule-${r.key}`}>
                            <i aria-hidden="true" className="not-italic">{r.met ? '✓' : '✕'}</i>
                            <span><b>{r.title}</b> {r.detail}<span className="sr-only">{r.met ? ' Met.' : ' Not met.'}</span></span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[11.5px] text-gray-600 dark:text-gray-400" data-testid="close-rules-summary">{rules.canClose ? 'Every rule holds: the closing can be closed from the closing record.' : `${rules.unmet} rule${rules.unmet === 1 ? '' : 's'} not met yet. Close turns on when all three hold.`}</p>
                    </>
                  )}
        </section>
      )}
    </section>
  );
}

/**
 * After close (DX23 A, D6889): each received line, In Portfolio or not.
 * An admin's In Portfolio links to the venture's Portfolio page and names
 * the position; anyone else (the founder) reads the label only. Closing
 * creates no position: an Admin records one in Portfolio, naming the line.
 */
function PortfolioTable({ portfolio, isAdmin, company, currency }) {
  const href = company.state === 'ready' ? company.value : null;
  return (
    <div className="mt-3 space-y-2" data-testid="portfolio-lines">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-extrabold text-axal-ink dark:text-gray-100">Record in Portfolio</h4>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{isAdmin ? 'Admin · closing does not create positions' : 'Whether each line is in Portfolio'}</span>
      </div>
      {portfolio.rows.length === 0 ? <p className="text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="portfolio-lines-empty">No line was received on this closing.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className={TH}>Line</th><th className={`${TH} text-right`}>Amount</th><th className={TH}>Received</th><th className={TH}>In Portfolio</th></tr></thead>
            <tbody>{portfolio.rows.map((r) => (
              <tr key={r.uid} data-testid={`portfolio-line-${r.uid}`}>
                <td className={TD}><b>{r.name}</b>{r.route ? <div className="text-[11px] text-gray-500 dark:text-gray-400">{r.route.replace(/_/g, ' ')}</div> : null}</td>
                <td className={`${TD} whitespace-nowrap text-right font-mono`}>{money(r.cents, currency)}</td>
                <td className={`${TD} whitespace-nowrap font-mono`}>{r.received || <NotRecorded />}</td>
                <td className={TD}>
                  {isAdmin && r.positionUid && href
                    ? <a href={href} className="inline-flex min-h-[44px] items-center gap-1 font-semibold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300 md:min-h-0" data-testid={`portfolio-link-${r.uid}`}><StatusWord status={r.status} /><span className="sr-only">Open the position in Portfolio</span><span aria-hidden="true">›</span></a>
                    : <StatusWord status={r.status} testid={`portfolio-status-${r.uid}`} />}
                  {isAdmin && r.positionUid ? (
                    <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      Position <span className="break-all font-mono">{r.positionUid}</span>
                      {company.state === 'unreadable' ? ' · the Portfolio page could not be found' : company.state === 'ready' && !href ? ' · no Portfolio page lists this venture' : ''}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{isAdmin
        ? 'A line is In Portfolio when a position names it. Record a position in Portfolio and name the line it came from; a position that names no line is not matched by venture or amount.'
        : 'A line is In Portfolio when an Admin recorded a position that names it.'}</p>
    </div>
  );
}

/** The checklist item side sheet (DX21): status, owner, due date and note; Save sends only what changed. */
function ItemSheet({ dealId, item, sheet, setSheet, onSaved }) {
  if (!item) return null;
  const patch = itemPatch(item, sheet);
  const st = itemStatus({ ...item, state: sheet.state, due_date: sheet.due }, today());
  async function save() {
    if (!patch) return;
    setSheet({ ...sheet, busy: true, error: '' });
    try {
      const r = await api.dealClosingChecklistSetItem(dealId, item.uid, patch);
      onSaved(r?.checklist || null);
    } catch (cause) {
      // The route's own sentence; the typed fields stay as they were.
      setSheet({ ...sheet, busy: false, error: cause?.message || 'The item could not be saved. Your edits are kept.' });
    }
  }
  const field = 'w-full min-h-[44px] rounded-[7px] border border-axal-hairline bg-white px-2 text-[12.5px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 md:min-h-[34px]';
  return (
    <aside className="w-full shrink-0 space-y-3 rounded-[10px] border border-axal-hairline bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900 lg:w-[340px]" role="dialog" aria-modal="false" aria-labelledby="item-sheet-title" data-testid="checklist-sheet">
      <div className="flex items-start justify-between gap-2">
        <div><p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Checklist item</p><h4 id="item-sheet-title" className="text-[15px] font-extrabold">{item.label}</h4></div>
        <button type="button" aria-label="Close" onClick={() => setSheet(null)} className="min-h-[44px] min-w-[44px] text-gray-500 md:min-h-[28px] md:min-w-[28px]">✕</button>
      </div>
      <div>
        <p className="mb-1 text-[11.5px] font-semibold">Status</p>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Status">
          {['pending', 'done', 'blocked', 'skipped'].map((s) => (
            <button key={s} type="button" role="radio" aria-checked={sheet.state === s} onClick={() => setSheet({ ...sheet, state: s })} data-testid={`sheet-state-${s}`}
              className={`min-h-[44px] rounded-[7px] border px-3 text-[12px] capitalize md:min-h-[32px] ${sheet.state === s ? 'border-violet-400 bg-violet-50 font-bold text-violet-800 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-200' : NEUTRAL}`}>{s}</button>
          ))}
        </div>
        <div className="mt-1.5"><StatusWord status={st} testid="sheet-status-word" /></div>
      </div>
      <label className="block text-[11.5px] font-semibold">Owner
        <input className={field} value={sheet.owner} onChange={(e) => setSheet({ ...sheet, owner: e.target.value })} placeholder="A person on this deal, or “Founder”" data-testid="sheet-owner" />
      </label>
      <label className="block text-[11.5px] font-semibold">Due date
        <input type="date" className={field} value={sheet.due} onChange={(e) => setSheet({ ...sheet, due: e.target.value })} data-testid="sheet-due" />
      </label>
      <label className="block text-[11.5px] font-semibold">Note <span className="font-normal text-gray-500">· optional</span>
        <textarea className={`${field} min-h-[64px] py-1.5`} value={sheet.note} onChange={(e) => setSheet({ ...sheet, note: e.target.value })} data-testid="sheet-note" />
      </label>
      {sheet.error ? <p className="text-[11.5px] text-red-700 dark:text-red-300" role="alert" data-testid="sheet-error">{sheet.error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setSheet(null)} className={`min-h-[44px] rounded-[7px] border px-3 text-[12px] md:min-h-[32px] ${NEUTRAL}`}>Cancel</button>
        <button type="button" disabled={!patch || sheet.busy} onClick={save} data-testid="sheet-save"
          className="min-h-[44px] rounded-[7px] bg-axal-violet-deep px-4 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-violet-500 md:min-h-[32px]">{sheet.busy ? 'Saving…' : 'Save'}</button>
      </div>
    </aside>
  );
}
