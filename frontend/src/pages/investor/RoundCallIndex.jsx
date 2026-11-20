/**
 * D6160 (#6160), canvas DCA16, DCA17, DCA20 and DCA21 (D6159): the investor's
 * round calls at `/round-calls`, a page of the Deals bucket drawn inside
 * `InvestorDealsRoutes`' shell, which carries the crumb "Deals ‹ Round calls",
 * the title and the line. Moved here from `pages/founder/RoundCallPage.jsx`,
 * where `RoundCallIndex` still serves a founder's `?project_id` list.
 *
 * Each row names the company and shows the investor's own response, or
 * "No response recorded". Its states: Coming soon while calls are switched
 * off (503 round_calls_disabled), verification required (403), the empty
 * explanation, and Unreadable with Try again. The words and rules are
 * `roundCallsModel.js`'s.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { roundCallsApi } from '../../lib/api/roundCalls';
import { useCallRead, moneyCents } from '../founder/roundCallParts';
import {
  FILTERS, NEEDS_ANSWER, NOT_A_PAYMENT, STATE_CHIP, callHref, closeWords, companyOf, filterCounts,
  filterHref, filterOf, instrumentName, isNew, listState, matchesFilter, responseLines, sortCalls, stateOf,
} from './roundCallsModel';

const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-hairline px-3 text-[13px] font-semibold text-axal-ink hover:bg-violet-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-violet-950';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] bg-violet-700 px-4 text-[13px] font-semibold text-white hover:bg-violet-800';
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function StateChip({ call }) {
  const chip = STATE_CHIP[stateOf(call)];
  if (!chip) return <span className="text-[12px] italic text-axal-muted" data-testid="round-call-chip">Status not recorded</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 py-0.5 text-[12px] font-semibold dark:border-gray-700" data-testid="round-call-chip">
      <i aria-hidden="true" className="not-italic">{chip.glyph}</i>{chip.word}
    </span>
  );
}

function Response({ call }) {
  const { none, lines } = responseLines(call, moneyCents);
  if (none) return <p className="m-0 text-[12.5px] italic text-axal-muted dark:text-gray-400" data-testid="round-call-response">{lines[0]}</p>;
  return (
    <ul className="m-0 list-none space-y-0.5 p-0 text-[12.5px]" data-testid="round-call-response">
      {lines.map((line, i) => <li key={line} className={i === 0 && line.startsWith('Indicated') ? 'font-semibold' : ''}>{line}</li>)}
    </ul>
  );
}

function Company({ call }) {
  const company = companyOf(call);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <b data-testid="round-call-company">{company || 'Company not recorded'}</b>
      {isNew(call) && <span className="rounded border border-violet-300 px-1.5 text-[11px] font-semibold text-violet-800 dark:border-violet-700 dark:text-violet-300" title="Not opened yet">New</span>}
    </span>
  );
}

function Close({ call, today }) {
  const { text, note } = closeWords(call, today);
  return <span className="flex flex-col text-[12px] text-axal-muted dark:text-gray-400"><span>{text}</span>{note && <span>{note}</span>}</span>;
}

function Filters({ search, counts, current }) {
  const item = (f) => (
    <Link key={f.key} to={filterHref(search, f.key)} aria-current={current === f.key ? 'page' : undefined} data-testid={`round-calls-filter-${f.key}`}
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-[13px] ${current === f.key ? 'border-violet-400 bg-violet-50 font-semibold dark:border-violet-600 dark:bg-violet-950' : 'border-axal-hairline dark:border-gray-700'}`}>
      {f.label} <span className="font-mono tabular-nums">{counts[f.key]}</span>
    </Link>
  );
  return (
    <nav aria-label="Filter round calls" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {FILTERS.map(item)}{item(NEEDS_ANSWER)}
    </nav>
  );
}

/** DCA16: the table from 768px; DCA21a: whole-card targets below it. */
export function RoundCallRows({ calls, today = todayUtc() }) {
  return (
    <>
      <div className={`${CARD} hidden overflow-x-auto md:block`}>
        <table className="w-full text-left text-[13px]" data-testid="round-calls-table">
          <thead className="text-[11.5px] text-axal-muted dark:text-gray-400">
            <tr><th className="p-3">Company · call · instrument</th><th className="p-3">Target</th><th className="p-3">Status · close date</th><th className="p-3">My response</th><th className="p-3"><span className="sr-only">Action</span></th></tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call.uid} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid="round-call-row">
                <td className="p-3"><Company call={call} /><span className="block">{call.name} · {instrumentName(call.instrument)}</span></td>
                <td className="p-3 font-mono tabular-nums">{moneyCents(call.amount_cents)}<span className="block font-sans text-[11.5px] text-axal-muted dark:text-gray-400">Minimum cheque {moneyCents(call.minimum_cheque_cents)}</span></td>
                <td className="p-3"><span className="flex flex-col gap-1"><StateChip call={call} /><Close call={call} today={today} /></span></td>
                <td className="p-3"><Response call={call} /></td>
                <td className="p-3 text-right"><Link className={BUTTON} to={callHref(call)} aria-label={`Open the call: ${companyOf(call) || 'company not recorded'} ${call.name}`}>Open the call</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden" data-testid="round-calls-cards">
        {calls.map((call) => (
          <li key={call.uid}>
            <Link to={callHref(call)} className={`${CARD} flex min-h-[44px] flex-col gap-1.5 p-4 text-axal-ink dark:text-gray-100`}
              aria-label={`Open the call: ${companyOf(call) || 'company not recorded'} ${call.name}`} data-testid="round-call-card">
              <Company call={call} />
              <span className="text-[13px]">{call.name} · {instrumentName(call.instrument)} · <span className="font-mono tabular-nums">{moneyCents(call.amount_cents)}</span></span>
              <span className="flex flex-wrap items-center gap-2"><StateChip call={call} /><Close call={call} today={today} /></span>
              <Response call={call} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Notice({ glyph, title, children, action, alert = false, testid }) {
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4 sm:flex-row sm:items-start`} role={alert ? 'alert' : undefined} data-testid={testid}>
      <span aria-hidden="true" className="text-[16px] font-bold">{glyph}</span>
      <div className="flex-1 space-y-1"><p className="m-0 font-semibold">{title}</p>{children && <p className="m-0 text-[13px] text-axal-muted dark:text-gray-400">{children}</p>}</div>
      {action}
    </section>
  );
}

/** DCA17: no call sent yet. */
function Empty() {
  return (
    <section className={`${CARD} space-y-3 p-5`} data-testid="round-calls-empty">
      <p className="m-0 text-[11.5px] font-semibold uppercase tracking-wide text-axal-muted">No round calls yet</p>
      <h2 className="m-0 text-[17px] font-bold">No founder has sent you a round call yet.</h2>
      <ol className="m-0 space-y-1 pl-5 text-[13px]">
        <li>A founder sends private terms to investors they chose and to investors who match the round.</li>
        <li>You read the terms and the frozen deck, ask questions and indicate an amount.</li>
        <li>{NOT_A_PAYMENT}</li>
      </ol>
      <Link className={PRIMARY} to="/deals">Browse Deal flow</Link>
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Matching investors stay nameless to the founder until they respond.</p>
    </section>
  );
}

/** The list as the read left it; `read` is `useCallRead`'s. */
export function RoundCallListBody({ read, search = '', today = todayUtc() }) {
  const state = listState(read);
  if (state === 'loading') return <div aria-busy="true" className="space-y-2" data-testid="round-calls-loading"><p className="sr-only">Reading your round calls</p>{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-[12px] bg-axal-hairline/60 dark:bg-gray-800" />)}</div>;
  if (state === 'off') return (
    <Notice glyph="○" title="Coming soon. Round calls are not enabled on Axal yet." testid="round-calls-off"
      action={<Link className={BUTTON} to="/deals">Browse Deal flow</Link>}>
      A round call is private terms a founder sends to investors. You read the terms and the deck, ask questions and indicate an amount.
    </Notice>
  );
  if (state === 'verify') return (
    <Notice glyph="⦸" title="Round calls are for verified investors." testid="round-calls-verify" alert
      action={<Link className={BUTTON} to="/kyc">Finish verification</Link>}>
      Axal’s team approves your verification.
    </Notice>
  );
  if (state === 'unreadable') return (
    <Notice glyph="!" title="Your round calls could not be read." testid="round-calls-unreadable" alert
      action={<button type="button" className={BUTTON} onClick={read.retry}>Try again</button>}>
      That is not the same as having none.
    </Notice>
  );
  if (state === 'refused') return <Notice glyph="⦸" title="This request to read round calls was refused." testid="round-calls-refused" alert />;
  if (state === 'empty') return <Empty />;
  const calls = read.data.items;
  const filter = filterOf(search);
  const shown = sortCalls(calls.filter((c) => matchesFilter(c, filter)));
  return (
    <div className="space-y-3">
      <Filters search={search} counts={filterCounts(calls)} current={filter} />
      {shown.length
        ? <RoundCallRows calls={shown} today={today} />
        : <p className="text-[13px]" data-testid="round-calls-none-match">No call matches this filter. <Link className="underline" to={filterHref(search, 'all')}>Show all</Link></p>}
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">{shown.length} of {calls.length} · Sorted by close date, soonest first; Closed last, most recent first. {NOT_A_PAYMENT}</p>
    </div>
  );
}

export default function RoundCallIndex() {
  const { search } = useLocation();
  const read = useCallRead(() => roundCallsApi.investorList(), []);
  return (
    <div className="space-y-3" data-testid="investor-round-calls">
      <RoundCallListBody read={read} search={search} />
    </div>
  );
}
