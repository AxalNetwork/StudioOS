import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { api } from '../../../lib/api';
import { Card, EmptyState, Pill, SectionLabel, Skeleton, Unreadable, Unrecorded, WorkerRail } from '../../../ui';
import WorkspaceShell from '../../../workspaces/WorkspaceShell';
import ZoneNav from '../../../workspaces/ZoneNav';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { Field, StatedLimit, inputClass } from '../kit';
import {
  COMMISSION_STATUS, EARNINGS_AREA, PAYOUT_CURRENCY_GAP, PAYOUT_METHODS, PAYOUT_MIN_CENTS, PAYOUT_STATUS, PERIODS,
  dayOf, destinationCheck, destinationLine, filterCommissions, formatMoney, payoutDetails, payoutOptions, payoutRequestBody,
  payoutClaims, payoutsInFlight, sourceLabel, sourcesIn, statusOf, totalsByStatus,
} from '../../../lib/partnerEarnings';
import {
  ConfirmPanel, Money, MoneyLines, Panel, PayoutMoney, RowTable, StatusPill, UnreadableValue, WriteNote, ghostButton, primaryButton,
} from './parts';

/**
 * Partner · Earnings — `/partner/earnings` (canvas `pe-earnings`, D569).
 *
 * TWO READS, EACH WITH ITS OWN STATES. `GET /network/commissions/me` is the
 * ledger and `GET /network/payouts/me` the payout history; a failed history
 * never blanks the ledger, and the reverse.
 *
 * WHAT "PAID" MEANS HERE IS THE ROUTE'S, AND THE PAGE SAYS SO. A payout
 * request marks the commissions it claims `paid`, with `paid_at` set to the
 * moment of the request, before any money moves. The payout's own status —
 * requested, processing, completed, failed — is what says whether it settled.
 *
 * THE FORM OFFERS ONLY WHAT THE ROUTE ACCEPTS. See `payoutOptions`: the route
 * claims whole commissions, oldest first, and refuses anything under 1000
 * cents, so a free amount box would mostly produce refusals.
 */

const PAGE = 25;

/** A tile in the totals strip: label, the figure, one line under it. */
function Tile({ label, children, note, testid }) {
  return (
    <Card padding="sm" data-testid={testid}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1.5 min-h-[24px]">{children}</div>
      {note ? <div className="mt-1 text-[11px] leading-snug text-axal-muted dark:text-gray-400">{note}</div> : null}
    </Card>
  );
}

/**
 * The three totals. Per status, per currency, from the rows themselves — not
 * from the route's `balance_cents`, which adds cents across currencies.
 */
export function EarningsTotals({ commissions, payouts }) {
  if (commissions.status === 'loading') {
    return <div className="grid gap-3 sm:grid-cols-3" aria-busy="true"><Skeleton h={78} /><Skeleton h={78} /><Skeleton h={78} /></div>;
  }
  const rows = Array.isArray(commissions.data?.commissions) ? commissions.data.commissions : [];
  const { statuses } = totalsByStatus(rows);
  const accrued = statuses.find((s) => s.key === 'accrued');
  const paid = statuses.find((s) => s.key === 'paid');
  const flight = payouts.status === 'ready' ? payoutsInFlight(Array.isArray(payouts.data) ? payouts.data : []) : null;
  const unread = commissions.status === 'unreadable';
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="earnings-totals">
      <Tile label="Accrued" testid="tile-accrued" note="Yours to request as a payout">
        {unread ? <UnreadableValue reason="The commissions could not be read." testid="total-accrued-unreadable" />
          : <MoneyLines sums={accrued?.sums} none="Nothing accrued" testid="total-accrued" />}
      </Tile>
      <Tile label="Paid" testid="tile-paid" note="Claimed by a payout request">
        {unread ? <UnreadableValue reason="The commissions could not be read." testid="total-paid-unreadable" />
          : <MoneyLines sums={paid?.sums} none="Nothing paid yet" testid="total-paid" />}
      </Tile>
      <Tile label="In payout requests" testid="tile-in-flight" note="Requested or processing, not yet completed">
        {payouts.status === 'loading' ? <Skeleton h={22} w="60%" />
          : payouts.status === 'unreadable' ? <UnreadableValue reason="The payout history could not be read." testid="total-in-flight-unreadable" />
            : flight?.count ? (
              <span className="flex flex-col gap-0.5" data-testid="total-in-flight">
                {flight.sums.length ? <MoneyLines sums={flight.sums} testid="total-in-flight-sums" /> : null}
                <span className={flight.sums.length ? 'text-[11.5px] tabular-nums text-axal-muted dark:text-gray-400' : 'text-[17px] font-semibold tabular-nums text-axal-ink dark:text-gray-100'}>
                  {flight.count} request{flight.count === 1 ? '' : 's'}
                </span>
                {flight.apart ? (
                  <span className="text-[11px] leading-snug text-axal-muted dark:text-gray-400" data-testid="total-in-flight-apart">
                    {flight.apart === flight.count ? 'Not added up' : `${flight.apart} not added up`}: <Unrecorded reason={PAYOUT_CURRENCY_GAP}>requested before payouts recorded their currency</Unrecorded>
                  </span>
                ) : null}
              </span>
            ) : <span className="text-[12.5px] text-axal-muted" data-testid="total-in-flight">No request open</span>}
      </Tile>
    </div>
  );
}

const COMMISSION_COLS = 'md:grid-cols-[120px_minmax(0,2fr)_150px_96px_104px_110px]';

/** One commission row's cells, in the canvas's column order. */
function commissionCells(c) {
  const status = statusOf(COMMISSION_STATUS, c?.status);
  const source = sourceLabel(c?.source_type);
  const accrued = dayOf(c?.created_at);
  const paidDay = dayOf(c?.paid_at);
  let paid;
  if (status.key === 'paid') {
    paid = paidDay ? <span className="tabular-nums text-axal-muted">{paidDay}</span>
      : <Unrecorded reason="Marked paid with no date on the row.">Not recorded</Unrecorded>;
  } else {
    paid = <Unrecorded reason="This commission is accrued and no payout request has claimed it.">Not paid yet</Unrecorded>;
  }
  return [
    source ? <Pill tone="neutral">{source}</Pill> : <Unrecorded>Source not recorded</Unrecorded>,
    String(c?.description ?? '').trim()
      ? <span className="text-axal-ink dark:text-gray-100">{c.description}</span>
      : <Unrecorded>No description</Unrecorded>,
    <Money cents={c?.amount_cents} currency={c?.currency} />,
    <StatusPill status={status} />,
    accrued ? <span className="tabular-nums text-axal-muted">{accrued}</span> : <Unrecorded>Not recorded</Unrecorded>,
    paid,
  ];
}

/**
 * The ledger, with its four states. `rows` is the filtered list and `total`
 * how many the route returned, so an empty filter is told apart from an empty
 * ledger.
 */
export function CommissionsList({ state, rows, total, shown = PAGE, onMore, onRetry, filters }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Table rows={4} cols={5} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="Your commissions" claim="This is not a claim that you have none." onRetry={onRetry} /></div>;
  } else if (total === 0) {
    body = (
      <div className="p-4">
        <EmptyState
          size="sm"
          icon={CircleDollarSign}
          title="No commissions yet"
          body="They appear when an introduction or referral you made converts."
          cta={{ label: 'See referrals', to: '/partner/referrals' }}
          data-testid="empty-commissions"
        />
      </div>
    );
  } else {
    const visible = rows.slice(0, shown);
    body = (
      <>
        <RowTable
          testid="table-commissions"
          cols={COMMISSION_COLS}
          head={['Source', 'Description', 'Amount', 'Status', 'Accrued', 'Paid']}
          rows={visible.map((c) => ({ key: c.id, testid: `row-commission-${c.id}`, cells: commissionCells(c) }))}
          empty={<p className="text-[12.5px] text-axal-muted" data-testid="empty-filtered">No commission matches these filters.</p>}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12px] text-axal-muted">
          <span className="tabular-nums" data-testid="text-commission-count">
            {rows.length === total ? `${total} commission${total === 1 ? '' : 's'}` : `${rows.length} of ${total} commissions`}
            {visible.length < rows.length ? ` · showing ${visible.length}` : ''}
          </span>
          {visible.length < rows.length && onMore
            ? <button type="button" className={ghostButton} onClick={onMore} data-testid="button-more-commissions">Show {Math.min(PAGE, rows.length - visible.length)} more</button>
            : null}
        </div>
      </>
    );
  }
  return (
    <Panel title="Commissions" meta={state === 'ready' ? 'Newest first, as the ledger stores them' : null} testid="panel-commissions">
      {filters}
      {body}
    </Panel>
  );
}

/** The search box and the two selects above the ledger. */
function LedgerFilters({ query, setQuery, source, setSource, period, setPeriod, sources }) {
  return (
    <div className="grid gap-2 border-b border-axal-hairline px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] dark:border-gray-700">
      <label className="block">
        <span className="sr-only">Search commissions</span>
        <input className={inputClass} type="search" value={query} placeholder="Search commissions…"
          onChange={(e) => setQuery(e.target.value)} data-testid="input-search-commissions" />
      </label>
      <label className="block">
        <span className="sr-only">Source</span>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} data-testid="select-source">
          <option value="all">Every source</option>
          {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="sr-only">Period</span>
        <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="select-period">
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
    </div>
  );
}

/** The words for one payout option in the amount select. */
export function optionLabel(option, isAll) {
  const money = `${formatMoney(option.cents, option.currency)}${option.currency ? ` ${option.currency}` : ''}`;
  const n = `${option.count} commission${option.count === 1 ? '' : 's'}`;
  return isAll ? `All accrued · ${money} (${n})` : `Oldest ${option.count} · ${money}`;
}

/**
 * The request form, stateless: the page owns the draft so a test can put
 * every stage through it.
 *
 *   stage `form`     amount, method and an optional note
 *   stage `confirm`  what will be written and what happens to the commissions
 *
 * `plan` is `payoutOptions(rows)`. With no option the form says why rather
 * than offering an amount the route would refuse.
 */
export function PayoutRequestForm({ state, plan, draft, stage = 'form', busy, result, onDraft, onReview, onConfirm, onCancel, formRef }) {
  const options = plan?.options || [];
  const fallback = plan?.defaultIndex ?? options.length - 1;
  const chosen = options[draft?.optionIndex ?? fallback] || null;
  const held = (plan?.currencies || []).filter((c) => c.options.length);
  const method = PAYOUT_METHODS.find((m) => m.value === draft?.method) || null;
  const dest = destinationCheck({ label: draft?.destLabel, last4: draft?.destLast4 });
  const destBad = dest.state !== 'none' && dest.state !== 'ok';
  let body;
  if (state === 'loading') body = <Skeleton.Text lines={3} />;
  else if (state === 'unreadable') {
    body = <p className="text-[12.5px] text-axal-muted">The form needs your commissions to know what you can request, and they could not be read.</p>;
  } else if (!plan?.accruedCount) {
    body = <p className="text-[12.5px] text-axal-muted" data-testid="text-nothing-accrued">Nothing is accrued, so there is nothing to request.</p>;
  } else if (!options.length) {
    body = (
      <p className="text-[12.5px] leading-relaxed text-axal-muted" data-testid="text-no-option">
        {plan.stoppedAt === 'amount'
          ? 'One of your oldest accrued commissions has no readable amount, and a request claims them oldest first, so none can be built past it.'
          : plan.currencies?.length > 1
            ? `In each currency you hold (${plan.currencies.map((c) => c.currency || 'one not recorded').join(', ')}), your accrued commissions do not yet reach the minimum a request takes.`
            : `Your accrued commissions do not yet reach the minimum a request takes: ${formatMoney(PAYOUT_MIN_CENTS, plan.currency)}${plan.currency ? ` ${plan.currency}` : ''}.`}
      </p>
    );
  } else if (stage === 'confirm' && chosen && method) {
    const money = <Money cents={chosen.cents} currency={chosen.currency} />;
    body = (
      <ConfirmPanel
        testid="confirm-payout"
        title="Confirm the request"
        rows={[
          ['Amount', money],
          ['Method', method.label],
          ['Sent to', dest.state === 'ok' ? `${dest.label} ···· ${dest.last4}` : 'Not named: the admin confirms where with you'],
          ['Claims', `the ${chosen.count === 1 ? 'oldest accrued commission' : `${chosen.count} oldest accrued commissions`}${held.length > 1 && chosen.currency ? ` in ${chosen.currency}` : ''}`],
          ...(String(draft?.note ?? '').trim() ? [['Note', String(draft.note).trim()]] : []),
        ]}
        consequence={`The ${chosen.count === 1 ? 'commission it claims is' : `${chosen.count} commissions it claims are`} marked Paid as soon as the request is recorded. The payout stays Requested until an admin processes it, and nothing on this page sends money.`}
        confirmLabel="Confirm request"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <Field
          label="Amount"
          hint={held.length > 1
            ? 'A request claims one currency, and whole commissions in it, oldest first. These are the amounts it can take in each.'
            : 'A request claims whole commissions, oldest first, so these are the amounts it can take.'}
        >
          <select className={inputClass} value={String(draft?.optionIndex ?? fallback)}
            onChange={(e) => onDraft?.({ optionIndex: Number(e.target.value) })} data-testid="select-payout-amount">
            {held.length > 1
              ? held.map((c) => (
                <optgroup key={c.currency || 'none'} label={c.currency || 'Currency not recorded'}>
                  {c.options.map((o) => {
                    const i = options.indexOf(o);
                    return <option key={`${o.currency}-${o.count}`} value={String(i)}>{optionLabel(o, o.all)}</option>;
                  })}
                </optgroup>
              ))
              : options.map((o, i) => <option key={`${o.currency}-${o.count}`} value={String(i)}>{optionLabel(o, o.all)}</option>)}
          </select>
        </Field>
        <Field label="Method">
          <select className={inputClass} value={draft?.method || ''} onChange={(e) => onDraft?.({ method: e.target.value })} data-testid="select-payout-method">
            <option value="">Choose a method</option>
            {PAYOUT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Sent to" hint="Optional. Name the account or wallet as you would recognise it, and give only its last 4 characters. The full details stay with the admin, out of band, and are never stored here.">
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} min-w-0 flex-1`} value={draft?.destLabel || ''} maxLength={60}
              placeholder="Main business account" aria-label="Destination name"
              onChange={(e) => onDraft?.({ destLabel: e.target.value })} data-testid="input-payout-dest-label" />
            <input className={`${inputClass} w-24`} value={draft?.destLast4 || ''} maxLength={4}
              placeholder="Last 4" aria-label="Last 4 characters"
              onChange={(e) => onDraft?.({ destLast4: e.target.value })} data-testid="input-payout-dest-last4" />
          </div>
          {destBad ? <p className="mt-1 text-[11.5px] text-red-700 dark:text-red-300" data-testid="text-payout-dest-error">{dest.message}</p> : null}
        </Field>
        <Field label="Note for the admin" hint="Optional: a reference. Leave out full account numbers; the admin confirms the details with you.">
          <input className={inputClass} value={draft?.note || ''} maxLength={500}
            onChange={(e) => onDraft?.({ note: e.target.value })} data-testid="input-payout-note" />
        </Field>
        {plan.stoppedAt === 'amount' ? (
          <p className="text-[11.5px] leading-relaxed text-axal-muted" data-testid="text-amount-stop">
            One of your accrued commissions has no readable amount, so the amounts stop before it.
          </p>
        ) : null}
        <div className="flex justify-end">
          <button type="button" className={primaryButton('partner')} disabled={!chosen || !method || destBad || busy}
            onClick={onReview} data-testid="button-review-payout">Review request</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={formRef}>
      <Panel title="Request payout" testid="panel-request-payout">
        <div className="space-y-3 px-4 py-3.5">
          {body}
          <WriteNote note={result} testid="note-payout-request" />
        </div>
      </Panel>
    </div>
  );
}

/** The payout history, newest first, with the four states. */
export function PayoutHistory({ state, rows, onRetry }) {
  let body;
  if (state === 'loading') body = <div className="p-4"><Skeleton.Text lines={3} /></div>;
  else if (state === 'unreadable') {
    body = <div className="p-4"><Unreadable what="Your payout history" claim="This is not a claim that nothing was requested or paid." onRetry={onRetry} /></div>;
  } else if (!rows.length) {
    body = <p className="px-4 py-4 text-[12.5px] text-axal-muted" data-testid="empty-payouts">No payout requested yet.</p>;
  } else {
    body = (
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-payouts">
        {rows.map((p) => {
          const status = statusOf(PAYOUT_STATUS, p?.status);
          const method = PAYOUT_METHODS.find((m) => m.value === p?.payout_method)?.label || String(p?.payout_method || '').trim();
          const details = payoutDetails(p?.payout_details);
          const requested = dayOf(p?.created_at);
          const completed = dayOf(p?.completed_at);
          const failed = dayOf(p?.failed_at);
          const claims = payoutClaims(p);
          return (
            <li key={p.id} className="space-y-1 px-4 py-2.5" data-testid={`row-payout-${p.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
                <span className="flex flex-wrap items-center gap-2">
                  <PayoutMoney payout={p} />
                  {method ? <span className="text-axal-muted">{method}</span> : <Unrecorded>Method not recorded</Unrecorded>}
                  {destinationLine(p)
                    ? <span className="text-axal-muted" data-testid={`text-payout-dest-${p.id}`}>to {destinationLine(p)}</span>
                    : <Unrecorded reason="No destination was named on this request, or it was made before destinations were stored.">destination not named</Unrecorded>}
                  <StatusPill status={status} />
                </span>
                <span className="text-[11.5px] tabular-nums text-axal-muted">
                  {requested ? `Requested ${requested}` : <Unrecorded>Request date not recorded</Unrecorded>}
                  {status.key === 'completed'
                    ? <> · {completed ? `completed ${completed}` : <Unrecorded>completion date not recorded</Unrecorded>}</>
                    : null}
                  {status.key === 'failed'
                    ? <> · {failed ? `failed ${failed}` : <Unrecorded reason="Failed before payouts recorded the day they failed.">the day it failed is not recorded</Unrecorded>}</>
                    : null}
                </span>
              </div>
              {status.key === 'failed' ? (
                <p className="text-[12px] text-red-700 dark:text-red-300" data-testid={`text-payout-reason-${p.id}`}>
                  {String(p?.failure_reason ?? '').trim() || <Unrecorded>No reason recorded</Unrecorded>}
                  <span className="text-axal-muted" data-testid={`text-payout-returned-${p.id}`}>
                    {claims
                      ? ` · ${claims.length === 1 ? 'its commission went' : `its ${claims.length} commissions went`} back to Accrued when it failed`
                      : ' · requested before payouts recorded their commissions, so none went back to Accrued'}
                  </span>
                </p>
              ) : null}
              {details ? (
                <p className="text-[11.5px] text-axal-muted">
                  {Array.isArray(details) ? details.map(([k, v]) => `${k === 'note' ? 'Note' : k}: ${v}`).join(' · ') : `Note: ${details}`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  return <Panel title="Payout history" meta={state === 'ready' && rows.length ? `${rows.length} request${rows.length === 1 ? '' : 's'}` : null} testid="panel-payout-history">{body}</Panel>;
}

export default function PartnerEarnings() {
  const [commissions, setCommissions] = useState({ status: 'loading', data: null });
  const [payouts, setPayouts] = useState({ status: 'loading', data: null });
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [period, setPeriod] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [draft, setDraft] = useState({ optionIndex: null, method: '', note: '', destLabel: '', destLast4: '' });
  const [stage, setStage] = useState('form');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const formRef = useRef(null);

  const loadCommissions = useCallback(() => {
    setCommissions({ status: 'loading', data: null });
    api.commissionsMe()
      .then((data) => setCommissions({ status: 'ready', data }))
      .catch(() => setCommissions({ status: 'unreadable', data: null }));
  }, []);
  const loadPayouts = useCallback(() => {
    setPayouts({ status: 'loading', data: null });
    api.payoutsMe()
      .then((data) => setPayouts({ status: 'ready', data: Array.isArray(data) ? data : [] }))
      .catch(() => setPayouts({ status: 'unreadable', data: null }));
  }, []);
  useEffect(() => { loadCommissions(); loadPayouts(); }, [loadCommissions, loadPayouts]);

  const rows = useMemo(
    () => (Array.isArray(commissions.data?.commissions) ? commissions.data.commissions : []),
    [commissions.data],
  );
  const payoutRows = Array.isArray(payouts.data) ? payouts.data : [];
  const sources = useMemo(() => sourcesIn(rows), [rows]);
  const visible = useMemo(
    () => filterCommissions(rows, { status, source, period, query }),
    [rows, status, source, period, query],
  );
  const plan = useMemo(() => payoutOptions(rows), [rows]);
  useEffect(() => { setShown(PAGE); }, [status, source, period, query]);

  const chosen = plan.options[draft.optionIndex ?? plan.defaultIndex ?? plan.options.length - 1] || null;
  const review = () => { setResult(null); setStage('confirm'); };
  const cancel = () => setStage('form');
  const confirm = async () => {
    if (!chosen || !draft.method) return;
    setBusy(true); setResult(null);
    try {
      await api.payoutRequest(payoutRequestBody(chosen, draft.method, draft.note, { label: draft.destLabel, last4: draft.destLast4 }));
      const amount = [formatMoney(chosen.cents, chosen.currency), chosen.currency].filter(Boolean).join(' ');
      setResult({ ok: true, text: `Requested ${amount}. It reads Requested until an admin processes it.` });
      setDraft({ optionIndex: null, method: '', note: '', destLabel: '', destLast4: '' });
      setStage('form');
      loadCommissions(); loadPayouts();
    } catch (e) {
      setResult({ ok: false, text: e?.message || 'The request was refused.' });
      setStage('form');
    } finally { setBusy(false); }
  };

  const statusChips = [['all', 'All'], ['accrued', 'Accrued'], ['paid', 'Paid']].map(([key, label]) => (
    commissions.status === 'ready'
      ? { label, testid: `chip-status-${key}`, active: status === key, onSelect: () => setStatus(key) }
      : { label, testid: `chip-status-${key}`, disabled: true, title: 'The commissions have not been read, so there is nothing to narrow.' }
  ));

  const coverage = [
    commissions.status === 'ready' ? `${rows.length} commission${rows.length === 1 ? '' : 's'} read` : null,
    payouts.status === 'ready' ? `${payoutRows.length} payout request${payoutRows.length === 1 ? '' : 's'} read` : null,
  ].filter(Boolean);

  return (
    <WorkspaceShell
      role="partner"
      title="Earnings"
      intro="Commissions on introductions and referrals, as the ledger stores them: accrued, then paid once a payout request claims them. Request a payout when you want one."
      rail={(
        <WorkerRail
          workspace="Earnings"
          role="partner"
          stance="Stored records only"
          note="This rail reports what the page read. It requests no payout and drafts nothing: a request is sent only by your confirmed click."
          coverage={coverage}
          coverageNote={coverage.length ? undefined : 'Nothing has been read yet, so there is nothing to report.'}
          unavailable={[
            ['Statement drafting', 'Eadwyn drafts no statement of your commissions yet: no draft surface reads them.'],
          ]}
        />
      )}
    >
      <ZoneNav bucket={EARNINGS_AREA} role="partner" />
      <ZoneToolbar
        role="partner"
        filters={statusChips}
        actions={[{
          label: 'Request payout',
          testid: 'button-request-payout',
          onClick: () => formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }),
        }]}
        className="mb-3"
      />
      <div className="space-y-3">
        <EarningsTotals commissions={commissions} payouts={payouts} />
        <CommissionsList
          state={commissions.status}
          rows={visible}
          total={rows.length}
          shown={shown}
          onMore={() => setShown((n) => n + PAGE)}
          onRetry={loadCommissions}
          filters={commissions.status === 'ready' && rows.length ? (
            <LedgerFilters query={query} setQuery={setQuery} source={source} setSource={setSource}
              period={period} setPeriod={setPeriod} sources={sources} />
          ) : null}
        />
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <PayoutRequestForm
            formRef={formRef}
            state={commissions.status}
            plan={plan}
            draft={draft}
            stage={stage}
            busy={busy}
            result={result}
            onDraft={(patch) => { setResult(null); setDraft((d) => ({ ...d, ...patch })); }}
            onReview={review}
            onConfirm={confirm}
            onCancel={cancel}
          />
          <PayoutHistory state={payouts.status} rows={payoutRows} onRetry={loadPayouts} />
        </div>
        <StatedLimit title="What this page does not claim">
          <p><strong>Paid means claimed by a payout request.</strong> The ledger marks a commission Paid the moment a request claims it, before any money moves. The payout’s own status says whether it was settled.</p>
          <p className="mt-2"><strong>Older payouts recorded less.</strong> A payout requested before payouts recorded their currency and their commissions shows no currency, and if it fails, none of its commissions go back to Accrued. Since then, a failed payout returns them.</p>
          <p className="mt-2"><strong>Totals are per currency.</strong> Amounts in different currencies are never added together, and a request covers one currency.</p>
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
