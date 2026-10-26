/**
 * D1235 (#3243) — KYC9, Renewals: what is about to lapse, expired first, then
 * the soonest, with the four counts, the warnings sent and the chart; and
 * KYC17c, how long a check lasts, which HQ can change in a dialog that says
 * existing dates do not move. Over part 4's reads (D1232):
 * `GET /api/kyc/admin/renewals` and `GET|PUT /api/kyc/admin/periods`.
 *
 * The two reads are two blocks: one failing never blanks the other. A count
 * the read did not return says "Not recorded", never 0.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { kycGovernanceApi } from '../../../lib/api/kycGovernance.js';
import { reportError } from '../../../lib/log';
import { Lightbox, actionGhost, actionPrimary } from '../../../ui';
import { personHref } from './kycModel';
import {
  PERIOD_CODE, PERIOD_MAX, PERIOD_MIN, PERIOD_NOTE, PERIOD_TOLD, RENEWAL_FILTERS, changeLine, governanceRefusal,
  monthBars, monthLead, periodChanges, periodRow, rangeLine, renewalChipCount, renewalRow, renewalTiles, warnedLine,
} from './governanceModel';
import { BTN, CARD, Chip, EYE, FIELD, MUTED, Pager, Tile, TwoColumns, Unreadable } from './KycParts';
import { StatusPill } from '../consoles/KycConsole';

/* ------------------------------------------------------------------ periods */

function PeriodsDialog({ changes, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const lock = useRef(false);
  const close = () => { if (!lock.current) onClose(); };
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setRefusal('');
    try {
      await kycGovernanceApi.kycSetPeriods(Object.fromEntries(changes.map((c) => [c.key, c.to])));
      onSaved();
    } catch (e) {
      reportError('KycRenewals:periods', e);
      setRefusal(governanceRefusal(e));
    } finally { lock.current = false; setBusy(false); }
  };
  return (
    <Lightbox label="Change how long checks last?" title="Change how long checks last?" onClose={close} width={560} testId="kyc-periods-dialog"
      footer={(
        <div className="flex flex-col gap-2">
          {refusal && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="kyc-periods-dialog-refused">{refusal}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={actionGhost} onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className={actionPrimary} onClick={save} disabled={busy} data-testid="kyc-periods-dialog-go">{busy ? 'Saving…' : 'Save periods'}</button>
          </div>
        </div>
      )}>
      <div className="flex flex-col gap-3 text-[13px]">
        {changes.map((c) => <p key={c.key} className="m-0" data-testid={`kyc-periods-change-${c.key}`}>{changeLine(c)}</p>)}
        <p className="m-0 rounded-lg bg-violet-50 p-2.5 text-[12.5px] text-violet-900 dark:bg-violet-950 dark:text-violet-100" data-testid="kyc-periods-note">{PERIOD_NOTE}</p>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{PERIOD_TOLD}</p>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{PERIOD_CODE}</p>
      </div>
    </Lightbox>
  );
}

/** KYC17c — the card beside the chart; editable only when the Worker says so (`can_change`). */
export function PeriodsCard() {
  const [st, setSt] = useState({ kind: 'loading', data: null });
  const [draft, setDraft] = useState(null);
  const [asking, setAsking] = useState(null);
  const [saved, setSaved] = useState('');
  const load = useCallback(async () => {
    setSt({ kind: 'loading', data: null });
    try { setSt({ kind: 'ok', data: await kycGovernanceApi.kycPeriods() }); } catch (e) {
      reportError('KycRenewals:periods-read', e);
      setSt({ kind: 'failed', data: null, detail: e?.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const periods = st.data?.periods || [];
  const check = draft ? periodChanges(periods, draft) : null;
  return (
    <section className={`${CARD} flex flex-col gap-2 p-4`} data-testid="kyc-periods">
      <h3 className="m-0 text-[14px] font-bold">How long a check lasts</h3>
      {st.kind === 'loading' && <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>}
      {st.kind === 'failed' && <Unreadable what="How long checks last" detail={st.detail} onRetry={load} testId="kyc-periods-failed" />}
      {st.kind === 'ok' && (
        <>
          {periods.map((p) => {
            const row = periodRow(p);
            return (
              <div key={row.key} className="flex flex-col gap-0.5 border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800" data-testid={`kyc-period-${row.key}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px]">{row.label}</span>
                  {draft ? (
                    <span className="inline-flex items-center gap-2">
                      <input type="number" min={PERIOD_MIN} max={PERIOD_MAX} step={1} inputMode="numeric" aria-label={`${row.label}, months`}
                        className={`${FIELD} w-[72px] text-center font-mono`} value={draft[row.key] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))} data-testid={`kyc-period-input-${row.key}`} />
                      <span className={`text-[12.5px] ${MUTED}`}>months</span>
                    </span>
                  ) : (
                    <span className="font-mono text-[13px]" data-testid={`kyc-period-months-${row.key}`}>{row.months == null ? 'Not recorded' : `${row.months} months`}</span>
                  )}
                </div>
                <span className={`text-[11.5px] ${MUTED}`}>{row.source}</span>
                {row.unused && <span className={`text-[11.5px] ${MUTED}`} data-testid={`kyc-period-unused-${row.key}`}>{row.unused}</span>}
              </div>
            );
          })}
          {st.data.can_change ? (
            draft ? (
              <div className="flex flex-col gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                {check?.error && <p className={`m-0 text-[12px] ${MUTED}`} data-testid="kyc-periods-problem">{check.error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" className={BTN} onClick={() => setDraft(null)} data-testid="kyc-periods-cancel">Cancel</button>
                  <button type="button" className={`${BTN} border-violet-600 text-violet-800 dark:text-violet-200`} disabled={Boolean(check?.error)}
                    onClick={() => setAsking(check.changes)} data-testid="kyc-periods-save">Save…</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                <span className={`text-[12.5px] ${MUTED}`} data-testid="kyc-periods-saved">{saved || 'You can change these for HQ.'}</span>
                <button type="button" className={BTN} onClick={() => { setSaved(''); setDraft(Object.fromEntries(periods.map((p) => [p.key, String(p.months ?? '')]))); }} data-testid="kyc-periods-edit">Change…</button>
              </div>
            )
          ) : (
            <p className={`m-0 border-t border-gray-100 pt-2 text-[12.5px] dark:border-gray-800 ${MUTED}`} data-testid="kyc-periods-hq">HQ sets these periods.</p>
          )}
        </>
      )}
      {asking && (
        <PeriodsDialog changes={asking} onClose={() => setAsking(null)}
          onSaved={() => { setAsking(null); setDraft(null); setSaved('Saved. Existing dates did not move.'); load(); }} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ renewals */

function Warned({ warned }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={warnedLine(warned)} title={warnedLine(warned)}>
      {warned.map((w) => (
        <span key={w.days} className={`inline-flex h-[18px] min-w-[26px] items-center justify-center rounded-full border px-1 font-mono text-[10.5px] ${w.sent
          ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200'
          : 'border-dashed border-gray-300 text-gray-400 dark:border-gray-600'}`}>{w.days}</span>
      ))}
    </span>
  );
}

export default function KycRenewals() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  const [st, setSt] = useState({ kind: 'loading', data: null });
  const load = useCallback(async () => {
    setSt((s) => ({ kind: s.data ? 'ok' : 'loading', data: s.data, reading: true }));
    try {
      setSt({ kind: 'ok', data: await kycGovernanceApi.kycRenewals({ filter, q, page: page > 1 ? page : undefined }) });
    } catch (e) {
      reportError('KycRenewals:read', e);
      setSt({ kind: 'failed', data: null, detail: e?.message });
    }
  }, [filter, q, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  const d = st.data;
  const reading = st.kind === 'loading';
  const tiles = renewalTiles(d?.counts);
  const bars = monthBars(d?.months);
  const rows = (d?.items || []).map(renewalRow);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-renewals">
      {st.kind === 'failed' ? (
        <section className={`${CARD} p-4`}><Unreadable what="The renewals" detail={st.detail} onRetry={load} testId="kyc-renewals-failed" /></section>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kyc-renewals-tiles">
          {tiles.map((t) => <Tile key={t.key} t={t} reading={reading} testId={`kyc-renewal-tile-${t.key}`} />)}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`${CARD} flex min-w-0 flex-col gap-2 p-4`} data-testid="kyc-renewals-chart">
          <h3 className="m-0 text-[14px] font-bold">Checks expiring per month</h3>
          {reading && <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>}
          {st.kind === 'failed' && <p className={`m-0 text-[12.5px] ${MUTED}`}>Not drawn: the renewals could not be read.</p>}
          {st.kind === 'ok' && (
            <>
              <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="kyc-renewals-chart-lead">{monthLead(d.months)}</p>
              <TwoColumns rows={bars} testId="kyc-renewals-chart-bars"
                a={{ key: 'people', word: 'people', legend: 'People', cls: 'rounded-t bg-violet-600 dark:bg-violet-400' }}
                b={{ key: 'businesses', word: 'businesses', legend: 'Businesses', cls: 'bg-sky-400 dark:bg-sky-500' }} />
            </>
          )}
        </section>
        <PeriodsCard />
      </div>
      {st.kind !== 'failed' && (
        <section className={`${CARD} flex min-w-0 flex-col gap-3 p-4`} data-testid="kyc-renewals-list">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which renewals">
            {RENEWAL_FILTERS.map((f) => {
              const n = renewalChipCount(d?.counts, f.key);
              return (
                <Chip key={f.key} on={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }} testId={`kyc-renewal-chip-${f.key}`}>
                  {f.label}{n != null && <span className="font-mono">{n}</span>}
                </Chip>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" className={`${FIELD} min-w-[220px] flex-1`} placeholder="Search name or business" aria-label="Search name or business"
              value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="kyc-renewals-search" />
            <span className={`text-[12.5px] ${MUTED}`} data-testid="kyc-renewals-range">{d ? rangeLine(d.total, d.page, d.page_size) : ''}</span>
            <span className={`text-[12.5px] ${MUTED}`}>Expired first, then the soonest</span>
          </div>
          {reading && !d && <p className={`m-0 text-[13px] ${MUTED}`}>Reading…</p>}
          {d && rows.length === 0 && (
            <p className={`m-0 text-[13px] ${MUTED}`} data-testid="kyc-renewals-empty">
              {q ? `No check matches “${q}” here.` : filter === 'soon' ? 'No check expires in the next 30 days.' : filter === 'expired' ? 'No check has expired.' : 'No check expires in the next 12 months.'}
            </p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className={`border-b border-gray-200 text-left dark:border-gray-800 ${EYE}`}>
                    <th className="py-2 pr-3">Who</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">What expires</th>
                    <th className="py-2 pr-3">Expires</th><th className="py-2 pr-3">Member warned</th><th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800" data-testid="kyc-renewal-row">
                      <td className="py-2 pr-3 font-semibold">
                        {r.personId ? <Link to={personHref(r.personId)} className="text-axal-ink underline-offset-2 hover:underline dark:text-gray-100">{r.name}</Link> : r.name}
                      </td>
                      <td className="py-2 pr-3">{r.kind}</td>
                      <td className="py-2 pr-3">{r.what}</td>
                      <td className="py-2 pr-3">
                        <div className="font-mono text-[12.5px]">{r.expires}</div>
                        <div className={`text-[11.5px] ${r.expired ? 'font-semibold text-red-700 dark:text-red-300' : MUTED}`} data-testid={`kyc-renewal-when-${r.id}`}>{r.when}</div>
                      </td>
                      <td className="py-2 pr-3"><Warned warned={r.warned} /></td>
                      <td className="py-2">
                        {r.statusKey ? <StatusPill status={r.statusKey} /> : <span className="text-[12.5px] font-semibold">{r.status}</span>}
                        {r.recheck && <div className={`text-[11.5px] ${MUTED}`}>{r.recheck}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d && <Pager page={d.page} pageSize={d.page_size} total={d.total} onPage={setPage} testId="kyc-renewals-pager" />}
        </section>
      )}
    </div>
  );
}
