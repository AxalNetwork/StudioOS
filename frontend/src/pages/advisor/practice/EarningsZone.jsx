import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import { NothingYet, Pill, Unrecorded, ZoneBody, ZoneHeading, money } from '../expertise/kit';

/**
 * Practice · Earnings — the roll-up over what Sessions records.
 *
 * EVERY FIGURE IS A SUM OF ROWS AN ADVISOR ENTERED. Nothing here is a forecast,
 * a projection, a run-rate or an estimate. If a number appears on this page,
 * an advisor typed the amount it came from.
 *
 * `unpriced_count` IS REPORTED, NOT HIDDEN, and that is the important one. A
 * total that quietly ignored the sessions nobody has priced would be a smaller
 * number presented as a complete one — the most plausible way a money page
 * lies. The worker returns the count for exactly this reason and the page
 * leads with it whenever it is non-zero.
 *
 * AXAL SETTLES NOTHING. The endpoint returns `settlement: 'none'` and this page
 * says so out loud rather than leaving a reader to assume a money page implies
 * a money rail. There is no payment provider, no invoice, no payout, and no
 * obligation on Axal — migration 175 deliberately retired the payout ledger and
 * this does not reopen it.
 */

const ROW = {
  billed: ['Billed', 'warn', 'Priced and owed to you. Nothing has been collected yet.'],
  collected: ['Collected', 'ok', 'You have been paid.'],
  written_off: ['Written off', 'danger', 'You decided not to pursue it.'],
  unpriced: ['Unpriced', 'neutral', 'Sessions with no amount recorded. Not counted in any total above.'],
};

function Figure({ label, cents, hint, strong = false }) {
  return (
    <Card variant={strong ? 'accent' : 'plain'} padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{label}</div>
      <div className={`mt-1 tabular-nums font-extrabold ${strong ? 'text-[22px]' : 'text-[18px]'}`}>
        {/* A roll-up over zero rows is a real zero — the advisor has recorded
            nothing collected. That is different from Sessions, where a NULL
            price means "not answered"; here the sum is a fact. */}
        {money(cents) ?? <Unrecorded />}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-axal-ink-3">{hint}</p>}
    </Card>
  );
}

export default function EarningsZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const data = await api.getMyAdvisorEarnings();
      setState({ loading: false, error: '', data });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your earnings could not be read.', data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = state.data;
  const nothingRecorded = d
    && !d.billed_cents && !d.collected_cents && !d.written_off_cents && !d.unpriced_count;

  const empty = (
    <NothingYet
      title="Nothing recorded yet"
      body="Once you price a session under Sessions, it appears here. This page only ever sums amounts you entered yourself."
      action={<Link to="/practice/sessions" className="text-[12px] text-emerald-700 underline">Price your sessions →</Link>}
    />
  );

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="What the practice has earned"
        blurb="Summed from the sessions you priced. Axal records these figures and settles nothing — there is no invoice, no payout and no payment provider behind this page."
        action={d?.unpriced_count > 0 ? <Pill tone="warn">{d.unpriced_count} unpriced</Pill> : null}
      />

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={Boolean(nothingRecorded)} empty={empty}>
        {d && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Figure strong label="Collected" cents={d.collected_cents}
                hint="Money you have actually been paid." />
              <Figure label="Outstanding" cents={d.outstanding_cents}
                hint="Priced and billed, not yet collected." />
              <Figure label="Written off" cents={d.written_off_cents}
                hint="Priced, then decided against pursuing." />
            </div>

            {d.unpriced_count > 0 && (
              <Card variant="dashed" padding="md" className="mt-3">
                <h3 className="text-sm font-extrabold tracking-tight">
                  {d.unpriced_count} session{d.unpriced_count === 1 ? '' : 's'} carr
                  {d.unpriced_count === 1 ? 'ies' : 'y'} no amount
                </h3>
                <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">
                  They are counted in none of the totals above, and this line exists so that
                  absence is visible rather than silently shrinking the numbers.{' '}
                  <Link to="/practice/sessions" className="text-emerald-700 underline">Price them →</Link>
                </p>
              </Card>
            )}

            <Card padding="none" className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-left dark:border-gray-700">
                    <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">State</th>
                    <th className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Sessions</th>
                    <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.by_state || []).map((row) => {
                    const [label, tone, hint] = ROW[row.state] || [row.state, 'neutral', ''];
                    return (
                      <tr key={row.state} className="border-b border-axal-hairline/60 last:border-0 dark:border-gray-800">
                        <td className="px-4 py-2.5">
                          <Pill tone={tone}>{label}</Pill>
                          <div className="mt-1 text-[11px] text-axal-ink-3">{hint}</div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{row.bookings}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          {/* An unpriced row's total is meaningless by
                              definition — the sessions in it have no amount. */}
                          {row.state === 'unpriced' ? <Unrecorded>—</Unrecorded> : money(row.total_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">
              Amounts are in {d.currency || 'USD'} and are your own record. Axal does not invoice
              your clients, does not take a cut, and holds no money on your behalf.
            </p>
          </>
        )}
      </ZoneBody>
    </div>
  );
}
