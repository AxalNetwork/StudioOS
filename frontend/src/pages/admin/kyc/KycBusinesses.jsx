/**
 * D1234 (#3242) — Businesses (KYC6, KYC17a): every kind of business in one
 * queue, oldest first, from part 3's read (`GET /api/kyc/businesses`). The
 * tiles come from its counts by status; the chips are its kind and status
 * filters; each legal name opens the case at `/admin/kyc/businesses/:id`.
 * The Super Admin also sees Licensed studios, as the Worker returns them only
 * to them. A failed read is Unreadable with Try again, never an empty table.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { kybApi } from '../../../lib/api/kyb.js';
import { reportError } from '../../../lib/log';
import { useAuth } from '../../../hooks/useAuthSync';
import { isSuperAdminUser } from '../../../lib/shellRole';
import { ConsoleUnreadable, CONSOLE_LOADING } from '../consoles/shared';
import { StatusPill } from '../consoles/KycConsole';
import { STATUS_CHIPS, businessStatusWord, countText, kindChips, pillStatus, queueQuery, rowOf, tiles } from './businessModel';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const CHIP = 'inline-flex min-h-[30px] items-center rounded-full border px-3 text-[12.5px] font-semibold';
const CHIP_ON = `${CHIP} border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950 dark:text-violet-200`;
const CHIP_OFF = `${CHIP} border-axal-hairline bg-white text-axal-ink hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const BTN = 'rounded-lg border border-axal-hairline bg-white px-3 py-1.5 text-[13px] font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800';

/** A business's status pill; Dismissed, the one word People has not, keeps a muted pair. */
export function BusinessStatus({ status, testId }) {
  if (status === 'dismissed') return <span className="inline-flex w-fit rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200" data-testid={testId}>{businessStatusWord(status)}</span>;
  return <StatusPill status={pillStatus(status)} testId={testId} />;
}

function Chips({ options, value, onChange, testId }) {
  return (
    <div role="group" className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map(([k, label]) => (
        <button key={k || 'all'} type="button" aria-pressed={value === k} className={value === k ? CHIP_ON : CHIP_OFF} onClick={() => onChange(k)} data-testid={`${testId}-${k || 'all'}`}>{label}</button>
      ))}
    </div>
  );
}

export default function KycBusinesses({ now = Date.now() }) {
  const superAdmin = isSuperAdminUser(useAuth()?.user ?? null);
  const [f, setF] = useState({ q: '', status: '', kind: '' });
  const [draft, setDraft] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(async () => {
    setState((s) => ({ status: 'loading', data: s.data }));
    try { setState({ status: 'ready', data: await kybApi.list(queueQuery(f, page)) }); } catch (e) {
      reportError('KycBusinesses:list', e);
      setState({ status: 'unreadable', data: null, error: e });
    }
  }, [f, page]);
  useEffect(() => { load(); }, [load]);
  const change = (patch) => { setPage(1); setF((x) => ({ ...x, ...patch })); };
  const read = state.data;
  const t = state.status === 'ready' ? tiles(read, now) : null;
  const rows = state.status === 'ready' ? (read.items || []).map((b) => rowOf(b, now)) : [];
  const pages = Math.max(1, Math.ceil((Number(read?.total) || 0) / (Number(read?.limit) || 25)));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="kyc-businesses">
      {state.status === 'unreadable' ? (
        <div data-testid="kyc-businesses-unreadable">
          <ConsoleUnreadable what="The businesses waiting" onRetry={load} />
          {state.error?.status === 400 ? <p className={`m-0 text-[12.5px] ${MUTED}`}>Those filters were refused. Clear them and try again.</p> : null}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kyc-biz-tiles">
            {(t || [{ key: 'w', label: 'Waiting' }, { key: 'n', label: 'Needs documents' }, { key: 'a', label: 'Approved' }, { key: 'r', label: 'Rejected' }]).map((x) => (
              <div key={x.key} className={`${CARD} flex flex-col gap-1 px-4 py-3`} data-testid={`kyc-biz-tile-${x.key}`}>
                <span className={EYE}>{x.label}</span>
                <span className="font-mono text-[20px] font-bold tabular-nums">{t ? x.value : <span className={`text-[13px] ${MUTED}`}>Reading…</span>}</span>
                {t ? <span className={`text-[11.5px] ${MUTED}`}>{x.note}</span> : null}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Chips options={kindChips(superAdmin)} value={f.kind} onChange={(kind) => change({ kind })} testId="kyc-biz-kind" />
            <Chips options={STATUS_CHIPS} value={f.status} onChange={(status) => change({ status })} testId="kyc-biz-status" />
          </div>
          <form className="flex flex-wrap items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); change({ q: draft }); }} data-testid="kyc-biz-search">
            <input className="min-w-[260px] flex-1 rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[13px] dark:border-gray-700 dark:bg-gray-900" type="search" maxLength={120}
              value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search legal name or full registration number" data-testid="kyc-biz-q" />
            <button type="submit" className={BTN}>Search</button>
            <span className={`ml-auto font-mono text-[12px] ${MUTED}`} data-testid="kyc-biz-count">{state.status === 'ready' ? countText(read) : ''}</span>
          </form>
          <section className={`${CARD} overflow-x-auto`}>
            {state.status === 'loading' && !read ? <div className="py-10 text-center text-gray-600 dark:text-gray-300">{CONSOLE_LOADING}</div>
              : rows.length === 0 ? <p className="m-0 px-4 py-6 text-[13px]" data-testid="kyc-biz-empty">{f.q || f.status || f.kind ? 'No business matches this search and these filters.' : 'Nothing is waiting. New businesses appear here, oldest first.'}</p>
                : (
                  <table className="w-full min-w-[820px] border-collapse text-[13px]" data-testid="kyc-biz-table">
                    <thead><tr className={`border-b border-axal-hairline text-left dark:border-gray-800 ${EYE}`}>
                      <th className="px-4 py-2">Business</th><th className="px-3 py-2">Kind · jurisdiction</th><th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Waiting</th><th className="px-3 py-2">Owners</th><th className="px-4 py-2">Reviewed</th>
                    </tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.uid} className="border-b border-axal-hairline last:border-b-0 dark:border-gray-800" data-testid="kyc-biz-row">
                          <td className="px-4 py-2.5">
                            <Link to={`/admin/kyc/businesses/${encodeURIComponent(r.uid)}`} className="font-semibold text-violet-700 hover:underline dark:text-violet-300" data-testid={`kyc-biz-open-${r.uid}`}>{r.name}</Link>
                            <span className={`block font-mono text-[11.5px] ${MUTED}`}>{r.sub}</span>
                          </td>
                          <td className="px-3 py-2.5">{r.kind}<span className={`block text-[12px] ${MUTED}`}>{r.jurisdiction}{r.highRisk ? ' · high-risk country' : ''}</span></td>
                          <td className="px-3 py-2.5"><BusinessStatus status={r.status} /></td>
                          <td className="px-3 py-2.5 font-mono">{r.waiting}</td>
                          <td className={`px-3 py-2.5 ${r.ownersWarn ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>{r.owners}</td>
                          <td className={`px-4 py-2.5 font-mono text-[12px] ${MUTED}`}>{r.reviewed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
          </section>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="kyc-biz-prev">Previous</button>
              <button type="button" className={BTN} disabled={page >= pages} onClick={() => setPage(page + 1)} data-testid="kyc-biz-next">Next</button>
            </div>
          )}
          <p className={`m-0 text-[12px] ${MUTED}`}>HQ’s own entities and funds are not checked here. Fund admin records them. Who a case is assigned to is not read here yet.</p>
        </>
      )}
    </div>
  );
}
