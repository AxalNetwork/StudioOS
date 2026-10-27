import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { api } from '../../../lib/api';
import { referralPartnersApi } from '../../../lib/api/referralPartners';
import {
  BlockFailed, Card, ChartBlock, Chip, INPUT, LINK, Skeleton, SUB, TD, TH, Tile,
} from './parts';
import { useRead } from './useProgramReads';
import { countLine } from './programPagesModel';
import { HQ_READS_COMMISSIONS, NOT_READ_YET, isFailed, isLoading, isReady } from './programsModel';
import {
  NO_EVENT_YET, PAGE, PARTNERS_EMPTY, QUEUE_EMPTY, QUEUE_WHO, RULES_LOCK, RULES_NOTE, SEGMENTS, SEGMENT_ONE, SORTS,
  TERMS_FILTERS, TERMS_WORD, commissionChart, contractLabel, dayLabel, introductionsChart, listParams, moneyReadable,
  partnerTiles, rowActions, rowMoney, ruleLine, termsSentence,
} from './referralPartnersModel';

/**
 * D953 (#2371) — Referral partners (PG7). D963 (#2796, part 10) draws it on
 * part 5's reads (D958): Overview's segment chips, four tiles, Introductions
 * by outcome, Commission by month, the Standard rules card and the partners
 * table with its row menu; the Queue of terms sent to HQ. Each block reads
 * alone and draws its own state. Every write opens a dialog
 * (`ReferralTermsDialogs.jsx`), which this page opens through `open`.
 *
 * Partner deals, `PART-` codes and redemptions stay on Partner invitations
 * (D923, D953 §5), so Overview links D923's tabs. Commissions is `hqOnly`, so
 * its door is the Super Admin's. Every door is a literal `to="…"` for the
 * reachability walk.
 */

/** A value that settles `ms` after it last changed: one request per search. */
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The header's action: New invitation lives on Partner invitations. */
export function InvitePartner({ className }) {
  return <Link to="/admin/partner-invitations" className={className} data-testid="programs-partners-invite">Invite a partner</Link>;
}

/** Where partner deals live: D923's tabs, and Commissions for a Super Admin. */
function DealsLinks({ superAdmin }) {
  return (
    <Card title="Where partner deals live" testId="programs-partners-overview">
      <p className="m-0 text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100">Partner deals, their codes and the sign-ups with them are on Partner invitations.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link to="/admin/partner-invitations/deals" className={LINK}>Partner deals</Link>
        <Link to="/admin/partner-invitations/referrals" className={LINK}>Partner referrals</Link>
        {superAdmin ? <Link to="/admin/commissions" className={LINK} data-testid="programs-partners-commissions">Commissions and payouts</Link> : null}
      </div>
      {superAdmin ? null : <p className={`m-0 ${SUB}`} data-testid="programs-partners-hq">{HQ_READS_COMMISSIONS}</p>}
    </Card>
  );
}

/**
 * The standard rules (`dc:398`): what a referral code earns without custom
 * terms. The rules read is the Super Admin's (`requireSuperAdmin`, N15), so an
 * Admin reads the lock and "HQ sets the standard rules."; a Super Admin reads
 * each rule, "No event pays this yet" where nothing fires it (OD4), and Edit.
 */
function StandardRules({ superAdmin, tick, open }) {
  const rules = useRead('partners:rules', 'rules', tick, superAdmin, () => api.adminCommissionRules().then((r) => {
    if (!Array.isArray(r)) throw new Error('The commission rules did not come back as a list.');
    return r;
  }));
  return (
    <Card title="Standard rules" testId="programs-partners-rules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={SUB}>{RULES_NOTE}</span>
        {superAdmin ? null : (
          <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <Lock size={11} aria-hidden="true" />Set by HQ
          </span>
        )}
      </div>
      {superAdmin && isLoading(rules) ? <Skeleton lines={3} /> : null}
      {superAdmin && isFailed(rules) ? <BlockFailed what="The standard rules" onRetry={open.reload} testId="programs-partners-rules-unreadable" /> : null}
      {superAdmin && isReady(rules) ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rules.data.map((r) => {
            const l = ruleLine(r);
            return (
              <li key={l.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={`programs-partners-rule-${l.key}`}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{l.text}</span>
                  {l.fires ? null : <span className={SUB} data-testid={`programs-partners-rule-${l.key}-nofire`}>{NO_EVENT_YET}</span>}
                  {l.off ? <span className={SUB}>Switched off.</span> : null}
                </span>
                <button type="button" className="text-[12.5px] font-bold text-axal-violet dark:text-violet-300" onClick={() => open.dialog({ kind: 'rule', rule: r })} data-testid={`programs-partners-rule-${l.key}-edit`}>Edit</button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={`m-0 ${SUB}`} data-testid="programs-partners-rules-foot">{RULES_LOCK}</p>
    </Card>
  );
}

const SELECT = `${INPUT} min-h-[36px]`;

/** The partners table (`dc:399`): server search, filters, sort, pages and the exact total. */
function PartnersTable({ segment, superAdmin, tick, open }) {
  const [q, setQ] = useState('');
  const [terms, setTerms] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('added');
  const [page, setPage] = useState(0);
  const needle = useDebounced(q);
  useEffect(() => { setPage(0); }, [needle, segment, terms, status, sort]);
  const params = listParams({ q: needle, segment, terms, status, sort, page });
  const list = useRead('partners:list', JSON.stringify(params), tick, true, () => referralPartnersApi.list(params).then((r) => {
    if (!Array.isArray(r?.items) || !Number.isFinite(Number(r?.total))) throw new Error('The partners did not come back with a total.');
    return r;
  }));
  const rows = isReady(list) ? list.data.items : [];
  const total = isReady(list) ? Number(list.data.total) : 0;
  const filtered = Boolean(params.q || segment || terms || status);
  return (
    <Card title="Partners" meta={isReady(list) ? total.toLocaleString('en-US') : null} testId="programs-partners-table">
      <div className="flex flex-wrap items-center gap-2" data-testid="programs-partners-toolbar">
        <input className={`${INPUT} min-h-[36px] w-full sm:w-64`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code" aria-label="Search name or code" data-testid="programs-partners-search" />
        <select className={SELECT} value={terms} onChange={(e) => setTerms(e.target.value)} aria-label="Terms" data-testid="programs-partners-filter-terms">
          <option value="">Terms: all</option>
          {TERMS_FILTERS.map((t) => <option key={t} value={t}>{TERMS_WORD[t]}</option>)}
        </select>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" data-testid="programs-partners-filter-status">
          <option value="">Status: all</option>
          <option value="active">Active account</option>
          <option value="inactive">Deactivated account</option>
        </select>
        <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" data-testid="programs-partners-sort">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{`Sort: ${s.label}`}</option>)}
        </select>
      </div>
      {q.trim().length === 1 ? <span className={SUB}>Search starts at two characters.</span> : null}
      {isLoading(list) ? <Skeleton lines={4} testId="programs-partners-table-loading" /> : null}
      {isFailed(list) ? <BlockFailed what="The partners" onRetry={open.reload} testId="programs-partners-table-unreadable" /> : null}
      {isReady(list) && !rows.length ? (
        <p className={`m-0 ${SUB}`} data-testid="programs-partners-table-empty">{filtered ? 'No partner matches these filters.' : PARTNERS_EMPTY}</p>
      ) : null}
      {isReady(list) && rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left" data-testid="programs-partners-rows">
            <thead>
              <tr>{['Partner', 'Terms', 'Code', 'Intros', 'Converted', 'Accrued', 'Paid', 'Last activity', ''].map((h) => <th key={h || 'menu'} scope="col" className={TH}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-t border-axal-hairline dark:border-gray-700" data-testid={`programs-partner-row-${r.user_id}`}>
                  <td className={TD}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-bold text-axal-ink dark:text-gray-100">{r.name || 'Name not recorded'}</span>
                      <span className={SUB}>{SEGMENT_ONE[r.segment] || r.segment_label}{r.active ? '' : ' · deactivated'}</span>
                    </span>
                  </td>
                  <td className={TD} data-testid={`programs-partner-row-${r.user_id}-state`}>{TERMS_WORD[r.terms_state] || r.terms_state}</td>
                  <td className={`${TD} font-mono`}>{r.code || '—'}</td>
                  <td className={`${TD} font-mono`}>{Number(r.introductions).toLocaleString('en-US')}</td>
                  <td className={`${TD} font-mono`}>{Number(r.converted).toLocaleString('en-US')}</td>
                  {moneyReadable(r.money) ? (
                    <>
                      <td className={`${TD} font-mono`} data-testid={`programs-partner-row-${r.user_id}-accrued`}>{rowMoney(r.money.accrued)}</td>
                      <td className={`${TD} font-mono`}>{rowMoney(r.money.paid)}</td>
                    </>
                  ) : (
                    <td colSpan={2} className={`${TD} text-[12px] italic text-axal-muted dark:text-gray-400`} data-testid={`programs-partner-row-${r.user_id}-accrued`}>{NOT_READ_YET}</td>
                  )}
                  <td className={`${TD} font-mono`}>{dayLabel(r.last_activity)}</td>
                  <td className={TD}><RowMenu row={r} superAdmin={superAdmin} open={open} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {isReady(list) && rows.some((r) => !moneyReadable(r.money)) ? <p className={`m-0 ${SUB}`} data-testid="programs-partners-money-hq">{rows.find((r) => !moneyReadable(r.money))?.money?.message || 'HQ reads these figures.'}</p> : null}
      {isReady(list) && total ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="programs-partners-count">{countLine(page * PAGE, rows.length, total)}</span>
          <span className="flex gap-2">
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)} data-testid="programs-partners-next">Next</button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/** A row's ⋯ menu: Set custom terms, and what its terms state allows. No Pause (OD-PAUSE). */
function RowMenu({ row, superAdmin, open }) {
  const [shown, setShown] = useState(false);
  const actions = rowActions(row, superAdmin);
  return (
    <div className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={shown} aria-label={`More for ${row.name || 'this partner'}`} onClick={() => setShown((v) => !v)}
        className="h-[36px] w-[36px] rounded-[9px] border border-axal-hairline text-[14px] font-bold dark:border-gray-700" data-testid={`programs-partner-row-${row.user_id}-menu`}>⋯</button>
      {shown ? (
        <div role="menu" className="absolute right-0 top-10 z-20 flex w-48 flex-col rounded-xl border border-axal-hairline bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          {actions.map((a) => (
            <button key={a.key} type="button" role="menuitem" onClick={() => { setShown(false); open.dialog({ kind: a.key, partner: row }); }}
              className="rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`programs-partner-row-${row.user_id}-${a.key}`}>{a.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Overview (`dc:395-399`). The segment chips filter the reads that take a
 * segment: Introductions by outcome and the partners table. The tiles and
 * Commission by month cover every segment, and say so.
 */
export function PartnersOverview({ superAdmin, tick, open }) {
  const [segment, setSegment] = useState('');
  const [currency, setCurrency] = useState(null);
  const summary = useRead('partners:summary', 'summary', tick, true, () => referralPartnersApi.summary());
  const series = useRead('partners:series', 'series', tick, true, () => referralPartnersApi.series());
  const tiles = partnerTiles(summary);
  const intros = introductionsChart(series, segment);
  const commission = commissionChart(series, currency);
  return (
    <div className="flex flex-col gap-4" data-testid="programs-partners-overview-tab">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Segment" data-testid="programs-partners-segments">
        {SEGMENTS.map((s) => <Chip key={s.key || 'all'} on={segment === s.key} onClick={() => setSegment(s.key)} testId={`programs-partners-segment-${s.key || 'all'}`}>{s.label}</Chip>)}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => <Tile key={t.key} t={t} onRetry={open.reload} />)}
      </div>
      {segment ? <p className={`m-0 ${SUB}`} data-testid="programs-partners-segment-note">The tiles and Commission by month cover every segment.</p> : null}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartBlock b={intros} shape="bars" onRetry={open.reload} testId="programs-partners-intros" />
        <ChartBlock b={commission} shape="lines" onRetry={open.reload} testId="programs-partners-commission">
          {commission.currencies?.length > 1 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Currency" data-testid="programs-partners-currency">
              {commission.currencies.map((c) => <Chip key={c} on={c === commission.currency} onClick={() => setCurrency(c)} testId={`programs-partners-currency-${c}`}>{c}</Chip>)}
            </div>
          ) : null}
        </ChartBlock>
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <StandardRules superAdmin={superAdmin} tick={tick} open={open} />
        <DealsLinks superAdmin={superAdmin} />
      </div>
      <PartnersTable segment={segment} superAdmin={superAdmin} tick={tick} open={open} />
    </div>
  );
}

/** The Queue tab's count: the terms sent to HQ, amber above zero. */
export function useQueueCount(tick) {
  const read = useRead('partners:queue-count', 'queue-count', tick, true, () => referralPartnersApi.terms({ status: 'submitted', limit: 1 }));
  const n = isReady(read) && Number.isFinite(Number(read.data?.total)) ? Number(read.data.total) : null;
  return n === null ? null : { text: n.toLocaleString('en-US'), amber: n > 0, title: 'Terms waiting for HQ' };
}

/** The Queue: terms sent to HQ and not yet decided, oldest first. */
export function PartnersQueue({ superAdmin, tick, open }) {
  const [page, setPage] = useState(0);
  const read = useRead('partners:queue', `queue:${page}`, tick, true, () => referralPartnersApi.terms({ status: 'submitted', limit: PAGE, offset: page * PAGE }).then((r) => {
    if (!Array.isArray(r?.items) || !Number.isFinite(Number(r?.total))) throw new Error('The queue did not come back with a total.');
    return r;
  }));
  const rows = isReady(read) ? read.data.items : [];
  const total = isReady(read) ? Number(read.data.total) : 0;
  return (
    <Card title="Queue" meta={isReady(read) ? total.toLocaleString('en-US') : null} testId="programs-partners-queue">
      {isLoading(read) ? <Skeleton lines={3} /> : null}
      {isFailed(read) ? <BlockFailed what="The terms sent to HQ" onRetry={open.reload} testId="programs-partners-queue-unreadable" /> : null}
      {isReady(read) && !rows.length ? (
        <div className="flex flex-col gap-1" data-testid="programs-partners-queue-empty">
          <p className="m-0 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{QUEUE_EMPTY}</p>
          <p className={`m-0 ${SUB}`}>{QUEUE_WHO}</p>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((t) => (
            <li key={t.uid} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700" data-testid={`programs-partners-queue-${t.uid}`}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{`${t.partner_name || 'Name not recorded'} · ${SEGMENT_ONE[t.segment] || t.segment_label}`}</span>
                <span className="text-[12.5px] leading-snug text-axal-ink dark:text-gray-100">{termsSentence(t.partner_name, t)}</span>
                <span className={SUB}>{`${contractLabel(t.contract_slug)} · sent to HQ ${dayLabel(t.submitted?.at)}`}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => open.dialog({ kind: 'terms', partner: { user_id: t.partner_user_id, name: t.partner_name, segment: t.segment } })}
                  className="min-h-[36px] rounded-[9px] border border-axal-hairline px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800" data-testid={`programs-partners-queue-${t.uid}-open`}>Open</button>
                {superAdmin ? (
                  <button type="button" onClick={() => open.dialog({ kind: 'approve', terms: t })}
                    className="min-h-[36px] rounded-[9px] bg-axal-violet px-3 text-[12.5px] font-bold text-white hover:opacity-90 dark:bg-violet-600" data-testid={`programs-partners-queue-${t.uid}-approve`}>Approve</button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {isReady(read) && rows.length && !superAdmin ? <p className={`m-0 ${SUB}`} data-testid="programs-partners-queue-hq">The Super Admin approves terms.</p> : null}
      {isReady(read) && total > PAGE ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{countLine(page * PAGE, rows.length, total)}</span>
          <span className="flex gap-2">
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="text-[12.5px] font-bold text-axal-violet disabled:opacity-40 dark:text-violet-300" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </span>
        </div>
      ) : null}
    </Card>
  );
}

