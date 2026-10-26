/**
 * D1235 (#3243) — KYC10, Audit: every look and decision in a window, with
 * looks and decisions per day, filters by action, admin and case, and search.
 * Export is HQ's (KYC17d): a Super Admin at HQ gets the button and its
 * dialog; an Admin reads one sentence instead (KYC14b). Over part 4's reads
 * (D1232): `GET /api/kyc/admin/audit` and `POST /api/kyc/admin/audit/export`.
 *
 * Names and actions only: the Worker never returns a reason's text or a shown
 * value, and this page draws nothing more than it returns.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { kycGovernanceApi } from '../../../lib/api/kycGovernance.js';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { personHref } from './kycModel';
import {
  AUDIT_WINDOWS, EXPORT_NOTE, EXPORT_ONLY_HQ, EXPORT_REASON_MAX, EXPORT_SCOPE, actionOptions, auditLead, auditParams,
  auditRow, canExport, dayBars, exportProblem, exportedLine, governanceRefusal, rangeLine, windowDates,
} from './governanceModel';
import { BTN, CARD, Chip, EYE, FIELD, MUTED, Pager, TwoColumns, ReadFailed } from './KycParts';

/**
 * Hand the browser the CSV the Worker made. A blob, never a new tab. Returns
 * whether the browser took it: the export is already recorded by then, so a
 * file the browser refused is said as that, never as a refused export. The
 * BOM is written as an escape, as `lib/csvExport.js` explains.
 */
export function saveCsv(filename, csv) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  try {
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch (e) {
    reportError('KycAudit:save', e);
    return false;
  }
}

function ExportDialog({ window: w, nowMs, onClose, onDone }) {
  const start = windowDates(w, nowMs);
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const problem = exportProblem({ from, to, reason });
  const close = () => { if (!lock.current) onClose(); };
  const go = async () => {
    if (lock.current || problem) return;
    lock.current = true; setBusy(true); setRefusal('');
    try {
      const out = await kycGovernanceApi.kycAuditExport({ from, to, reason: reason.trim() });
      onDone(out.rows, saveCsv(out.filename, out.csv));
    } catch (e) {
      reportError('KycAudit:export', e);
      setRefusal(governanceRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label="Export the audit record" title="Export the audit record" onClose={close} width={560} testId="kyc-export-dialog"
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="kyc-export-dialog-refused">{refusal}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={go} disabled={Boolean(problem) || busy} data-testid="kyc-export-dialog-go">{busy ? 'Exporting…' : 'Export CSV'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="font-semibold">From</span>
            <input type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="kyc-export-from" /></label>
          <label className="flex flex-col gap-1"><span className="font-semibold">To</span>
            <input type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} data-testid="kyc-export-to" /></label>
        </div>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{EXPORT_SCOPE} Format: CSV.</p>
        <label className="flex flex-col gap-1"><span className="font-semibold">Reason <span className={MUTED}>(recorded with the export)</span></span>
          <textarea className={`${FIELD} min-h-[64px]`} maxLength={EXPORT_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="kyc-export-reason" /></label>
        {problem && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="kyc-export-problem">{problem}</p>}
        <p className="m-0 rounded-lg bg-violet-50 p-2.5 text-[12.5px] text-violet-900 dark:bg-violet-950 dark:text-violet-100">{EXPORT_NOTE}</p>
      </div>
    </Lightbox>
  );
}

/** KYC10's right of the bar: Export for HQ, one sentence for anyone else (KYC14b). */
function ExportDoor({ me, window: w, nowMs }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  if (!canExport(me)) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${MUTED}`} data-testid="kyc-export-hq-only">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>{EXPORT_ONLY_HQ}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {done && <span className={`text-[12.5px] ${MUTED}`} data-testid="kyc-export-done">{done}</span>}
      <button type="button" className={`${BTN} border-violet-600 text-violet-800 dark:text-violet-200`} onClick={() => { setDone(''); setOpen(true); }} data-testid="kyc-export-open">Export…</button>
      {open && <ExportDialog window={w} nowMs={nowMs} onClose={() => setOpen(false)}
        onDone={(rows, saved) => { setOpen(false); setDone(exportedLine(rows, saved)); }} />}
    </span>
  );
}

export default function KycAudit({ me: meProp, nowMs: nowProp }) {
  const auth = useAuth();
  const me = meProp || auth?.user || null;
  const nowMs = nowProp ?? Date.now();
  const [f, setF] = useState({ window: '30', action: '', admin: '', case: null, q: '', page: 1 });
  const [typed, setTyped] = useState('');
  const [st, setSt] = useState({ kind: 'loading', data: null });
  const patch = (p) => setF((x) => ({ ...x, page: 1, ...p }));
  const load = useCallback(async () => {
    setSt((s) => ({ kind: s.data ? 'ok' : 'loading', data: s.data }));
    try { setSt({ kind: 'ok', data: await kycGovernanceApi.kycAudit(auditParams(f, nowMs)) }); } catch (e) {
      reportError('KycAudit:read', e);
      setSt({ kind: 'failed', data: null, detail: e?.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.window, f.action, f.admin, f.case?.id, f.q, f.page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.q === typed.trim() ? x : { ...x, q: typed.trim(), page: 1 })), 300);
    return () => clearTimeout(t);
  }, [typed]);

  const d = st.data;
  const bars = dayBars(d?.per_day);
  const rows = (d?.items || []).map(auditRow);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-audit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`m-0 text-[12.5px] ${MUTED}`}>Every look and every decision on KYC, under the name of who made it.</p>
        <ExportDoor me={me} window={f.window} nowMs={nowMs} />
      </div>
      {st.kind === 'failed' ? (
        <section className={`${CARD} p-4`}><ReadFailed what="The audit record" detail={st.detail} onRetry={load} testId="kyc-audit-failed" /></section>
      ) : (
        <>
          <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="kyc-audit-chart">
            <h3 className="m-0 text-[14px] font-bold">Looks and decisions per day</h3>
            {!d ? <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p> : (
              <>
                <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="kyc-audit-chart-lead">{auditLead(d.per_day, nowMs)}</p>
                <TwoColumns rows={bars} testId="kyc-audit-chart-bars"
                  a={{ key: 'looks', word: 'looks', legend: 'Looks: lists, cases, values and documents opened', cls: 'rounded-t bg-violet-600 dark:bg-violet-400' }}
                  b={{ key: 'decisions', word: 'decisions', legend: 'Decisions', cls: 'bg-sky-400 dark:bg-sky-500' }} />
                <p className={`m-0 text-[11.5px] ${MUTED}`}>Assignments and notes are listed below and counted as neither.</p>
              </>
            )}
          </section>
          <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="kyc-audit-list">
            <div className="flex flex-wrap items-center gap-2">
              <select className={FIELD} value={f.action} onChange={(e) => patch({ action: e.target.value })} aria-label="Action" data-testid="kyc-audit-action">
                <option value="">Action: any</option>
                {actionOptions(d?.actions).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <select className={FIELD} value={f.admin} onChange={(e) => patch({ admin: e.target.value })} aria-label="Admin" data-testid="kyc-audit-admin">
                <option value="">Admin: any</option>
                {(d?.admins || []).map((a) => <option key={a.id} value={String(a.id)}>{a.name || `Account ${a.id}`}</option>)}
              </select>
              {f.case ? (
                <Chip on onClick={() => patch({ case: null })} testId="kyc-audit-case-clear">Case: {f.case.name} ✕</Chip>
              ) : <span className={`text-[12.5px] ${MUTED}`}>Case: any — choose one from a row</span>}
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="When">
                {AUDIT_WINDOWS.map((w) => <Chip key={w.key} on={f.window === w.key} onClick={() => patch({ window: w.key })} testId={`kyc-audit-window-${w.key}`}>{w.label}</Chip>)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" className={`${FIELD} min-w-[220px] flex-1`} placeholder="Search case, admin or detail" aria-label="Search case, admin or detail"
                value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="kyc-audit-search" />
              <span className={`text-[12.5px] ${MUTED}`} data-testid="kyc-audit-range">{d ? rangeLine(d.total, d.page, d.page_size) : ''}</span>
              <span className={`text-[12.5px] ${MUTED}`}>Newest first</span>
            </div>
            {d && rows.length === 0 && <p className={`m-0 text-[13px] ${MUTED}`} data-testid="kyc-audit-empty">Nothing in this window matches.</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className={`border-b border-gray-200 text-left dark:border-gray-800 ${EYE}`}>
                      <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Admin</th><th className="py-2 pr-3">Action</th><th className="py-2 pr-3">Case</th><th className="py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800" data-testid="kyc-audit-row">
                        <td className="whitespace-nowrap py-2 pr-3 font-mono text-[12px]">{r.when}</td>
                        <td className="py-2 pr-3">{r.admin}</td>
                        <td className="py-2 pr-3 font-semibold">{r.word}</td>
                        <td className="py-2 pr-3">
                          {r.case ? (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <Link to={personHref(r.case.id)} className="text-axal-ink underline-offset-2 hover:underline dark:text-gray-100">{r.case.name}</Link>
                              <button type="button" className={`text-[11.5px] underline ${MUTED}`} onClick={() => patch({ case: r.case })} data-testid={`kyc-audit-only-${r.id}`}>Only this case</button>
                            </span>
                          ) : <span className={MUTED}>—</span>}
                        </td>
                        <td className={`py-2 ${MUTED}`}>{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d && <Pager page={d.page} pageSize={d.page_size} total={d.total} onPage={(page) => setF((x) => ({ ...x, page }))} testId="kyc-audit-pager" />}
            <p className={`m-0 text-[12px] ${MUTED}`}>HQ can see this record too.</p>
          </section>
        </>
      )}
    </div>
  );
}
